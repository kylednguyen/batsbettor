// MLB chat service: the LLM explanation layer.
//
// Architecture (unchanged):
//   ML model   -> computes the win probability and projected score
//   structured -> supplies the exact numbers (the BASEBALL CONTEXT block)
//   RAG        -> supplies correct baseball concepts/definitions
//   LLM        -> reasons like an analyst over the above; never invents data
//
// The LLM provider is behind a seam (`callLlm`): Anthropic by default, or a
// fully local Ollama model (set LLM_PROVIDER=ollama).

import Anthropic from '@anthropic-ai/sdk'
import { getPredictionForGame, type Prediction } from '../predictionService.js'
import { retrieve, type RetrievedDoc } from './rag.js'
import { detectIntent, type ChatIntent } from './intentRouter.js'
import {
  getTodayCards,
  buildScoreboardText,
  findMatchingCards,
  buildGameSummary,
  findPlayerLines,
  getPlayerStats,
  buildLeadersContext,
} from './mlbContext.js'
import { getEasternDateString } from '../dateUtils.js'
import { getLiveScoreCardsByDate } from '../mlbStatsService.js'
import { predictGame as predictWithTrainedModel } from '../model/predict.js'
import type { ScoreCard } from '../../src/types.js'

const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase()
const ANTHROPIC_MODEL = process.env.CHAT_MODEL || 'claude-haiku-4-5-20251001'
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b'
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 8192)
const CHAT_TEMPERATURE = Number(process.env.CHAT_TEMPERATURE || 0.3)
// Groq: free, hosted, OpenAI-compatible. ~70B quality at no cost.
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const GROQ_HOST = process.env.GROQ_HOST || 'https://api.groq.com/openai/v1'
// Google Gemini: free hosted tier.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest'
const GEMINI_HOST = process.env.GEMINI_HOST || 'https://generativelanguage.googleapis.com/v1beta'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export function isLlmConfigured(): boolean {
  if (LLM_PROVIDER === 'ollama') return true
  if (LLM_PROVIDER === 'groq') return Boolean(GROQ_API_KEY)
  if (LLM_PROVIDER === 'gemini') return Boolean(GEMINI_API_KEY)
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

// Data the app does NOT currently fetch — the assistant must not invent these.
const UNAVAILABLE_DATA = [
  'Statcast/Baseball Savant batter metrics (xwOBA, xERA, barrel rate, hard-hit rate, chase rate, whiff rate)',
  'handedness (platoon) splits',
  'confirmed starting lineups and batters due up',
  'injuries and roster moves',
  'weather and park factors',
  'live in-game odds movement (only pregame/current moneyline is available)',
  'individual player props and game logs',
]

const SYSTEM_PROMPT = `You are BatsBet, a live MLB assistant. You are a general baseball game assistant with betting/model intelligence layered on top — NOT only a betting bot.

Answer the user's baseball question FIRST. Add model/betting context only when it's relevant or asked for. Never force a betting answer onto a plain baseball question.

The request has a DETECTED INTENT and grounded data sections. Use them:
- SCOREBOARD → list today's games with score + status (live inning or Final). Keep it a clean list.
- PLAYER (e.g. "what did Judge do today?") → give the player's stat line and key events from PLAYER STAT LINES. For hitters lead with AB/H/HR/RBI/BB/K and total bases; for pitchers IP/H/ER/BB/K and the decision.
- GAME SUMMARY → final/live score, top performers, key scoring plays, from GAME SUMMARY.
- MODEL → give BOTH, clearly separated: (1) Most likely winner (highest model win probability) and (2) Best value bet (largest positive edge vs the book's vig-free probability). They can be different teams; if so say e.g. "KC is more likely to win, but MIN is the better value at +378." Never say "model leans MIN" when MIN is only the value side.
- ODDS → odds, implied probability, the model's fair odds, and whether the price looks good, with a one-line why.
- EXPLANATION → concise bullets; separate baseball reasons from market reasons.
- PROPS → player props are not modeled yet; say so plainly and offer the player's recent line if available.
- LEADERS / MVP / CY YOUNG → rank the candidates by WAR from STAT LEADERS (WAR is the standard award basis). Name the front-runner and 2-3 challengers, each with a one-line why (WAR, plus wRC+/wOBA for hitters). Note WAR is the basis and that real voting also weighs team success/narrative. Project a likely winner but frame it as a projection, not a lock.

Style:
- Be direct and scannable. Prefer short lines, bullets, or a compact list. Avoid long paragraphs.
- Use ONLY numbers present in the provided data. Never invent scores, stats, odds, injuries, lineups, or Statcast metrics.
- If the needed data isn't provided, say exactly what's missing in one short line — don't guess.
- If live data and the model disagree, say so plainly (e.g. "the scoreboard favors KC, but the value is on MIN because the price is inflated").
- You CANNOT forecast an individual player's future (e.g. "will Ohtani homer tomorrow") — only the team model projects games. If asked, say so and offer the player's recent form instead.
- Never say "lock", "guaranteed", or "free money". This is analytics, not betting advice.`

export interface ChatRequest {
  message: string
  gameContext?: ScoreCard | null
}

export interface ChatResponse {
  answer: string
  prediction?: Prediction | null
  sources?: string[]
}

function pct(value: number | null | undefined): string {
  if (value == null) return 'n/a'
  return `${(value * 100).toFixed(1)}%`
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`
}

// Build a clean, labeled baseball context object from everything the app knows
// about this game, plus an explicit inventory of what IS and IS NOT available.
function buildBaseballContext(
  prediction: Prediction | null,
  gameContext: ScoreCard | null | undefined
): { text: string; available: string[] } {
  const lines: string[] = []
  const available: string[] = []

  if (!prediction && !gameContext) {
    lines.push('No game is selected. Live game specifics require the user to select a game in the app.')
    return { text: lines.join('\n'), available }
  }

  // Prefer the full model prediction; fall back to the lighter scorecard.
  if (prediction) {
    const p = prediction
    lines.push('## Game')
    lines.push(`Matchup: ${p.awayTeam ?? p.awayAbbreviation} (away) @ ${p.homeTeam ?? p.homeAbbreviation} (home)`)
    lines.push(`Status: ${p.status ?? 'unknown'}`)
    if (p.statusCode === 'L') {
      lines.push(`Live state: ${p.half ?? ''} ${p.inningOrdinal ?? ''}, ${p.outs ?? 0} out(s), ${p.baseState}`)
    }
    lines.push(`Score: ${p.score}`)
    available.push('live game state', 'score')

    lines.push('')
    lines.push('## Model output (authoritative — use these numbers)')
    lines.push(`Win probability: ${p.homeAbbreviation} ${pct(p.model.homeWinProbability)}, ${p.awayAbbreviation} ${pct(p.model.awayWinProbability)}`)
    lines.push(`Projected final: ${p.homeAbbreviation} ${p.model.projectedHomeRuns}, ${p.awayAbbreviation} ${p.model.projectedAwayRuns} (total ${p.model.projectedTotalRuns})`)
    lines.push(`Model fair odds: ${p.homeAbbreviation} ${p.model.fairHomeMoneylineDisplay}, ${p.awayAbbreviation} ${p.model.fairAwayMoneylineDisplay}`)
    lines.push(`Confidence: ${p.confidence} | Pregame prior source: ${p.priorSource}`)
    available.push('model win probability', 'projected score', 'fair odds', 'confidence')

    if (p.homeForm && p.awayForm) {
      lines.push('')
      lines.push('## Recent team form (last 30 games)')
      lines.push(`${p.homeAbbreviation}: ${p.homeForm.record}, run diff ${signed(p.homeForm.runDiffPerGame)}/game`)
      lines.push(`${p.awayAbbreviation}: ${p.awayForm.record}, run diff ${signed(p.awayForm.runDiffPerGame)}/game`)
      available.push('recent team form')
    }

    const sp = p.startingPitchers
    if (sp?.home || sp?.away) {
      lines.push('')
      lines.push('## Probable starters (season stats)')
      const fmt = (x: typeof sp.home, abbr: string) =>
        x
          ? `${abbr} ${x.name}: ${x.era ?? '–'} ERA, ${x.fip ?? '–'} FIP, ${x.k9 ?? '–'} K/9, ${x.bb9 ?? '–'} BB/9 (${x.inningsPitched} IP)`
          : `${abbr}: not posted`
      lines.push(fmt(sp.home, p.homeAbbreviation))
      lines.push(fmt(sp.away, p.awayAbbreviation))
      if (sp.home && sp.away) available.push('probable starters (ERA/FIP/K9)')
    }

    const bp = p.bullpen
    if (bp?.home || bp?.away) {
      lines.push('')
      lines.push('## Bullpen rest / fatigue (last 3 days)')
      const fmt = (x: typeof bp.home, abbr: string) =>
        x
          ? `${abbr}: ${x.pitchesLast3Days} reliever pitches, ${x.relieversUsedLast3Days} relievers used, ${x.backToBackArms} on back-to-back days (fatigue ${x.fatigueScore})`
          : `${abbr}: n/a`
      lines.push(fmt(bp.home, p.homeAbbreviation))
      lines.push(fmt(bp.away, p.awayAbbreviation))
      if (bp.home && bp.away) available.push('bullpen usage/fatigue')
    }

    if (p.market) {
      lines.push('')
      lines.push(`## Sportsbook odds (${p.market.provider ?? 'market'})`)
      lines.push(`Moneyline: ${p.homeAbbreviation} ${p.market.homeMoneylineDisplay ?? 'n/a'}, ${p.awayAbbreviation} ${p.market.awayMoneylineDisplay ?? 'n/a'}`)
      if (p.market.homeNoVigProbability != null) {
        lines.push(`No-vig implied: ${p.homeAbbreviation} ${pct(p.market.homeNoVigProbability)}, ${p.awayAbbreviation} ${pct(p.market.awayNoVigProbability)}`)
      }
      if (p.edge) {
        lines.push(`Model vs market edge: ${p.homeAbbreviation} ${signed(p.edge.homeProbabilityEdge)} pts, ${p.awayAbbreviation} ${signed(p.edge.awayProbabilityEdge)} pts`)
      }
      available.push('sportsbook odds', 'no-vig probability', 'model-vs-market edge')
    }

    if (p.matchupAdjustment?.applied) {
      lines.push('')
      lines.push(`## Prior adjustment (no market odds, so starter/bullpen nudged the prior, home pts): starter ${signed(p.matchupAdjustment.starterEdgePts)}, bullpen ${signed(p.matchupAdjustment.bullpenEdgePts)}`)
    }

    if (p.currentBatter || p.currentPitcher) {
      lines.push('')
      lines.push(`## Current at-bat: ${p.currentBatter ?? 'unknown'} batting vs ${p.currentPitcher ?? 'unknown'} pitching`)
      available.push('current batter/pitcher')
    }

    if (p.recentScoringPlays.length) {
      lines.push('')
      lines.push('## Scoring plays (play-by-play, earliest to latest)')
      p.recentScoringPlays.forEach((s) => lines.push(`- ${s}`))
      available.push('scoring plays / play-by-play')
    }

    if (p.lastPlay) {
      lines.push('')
      lines.push(`## Most recent play: ${p.lastPlay}`)
      available.push('last play')
    }

    if (p.drivers.length) {
      lines.push('')
      lines.push('## Model key drivers')
      p.drivers.forEach((d) => lines.push(`- ${d}`))
    }
  } else if (gameContext) {
    const g = gameContext
    lines.push('## Game (no live model prediction available)')
    lines.push(`Matchup: ${g.awayTeam ?? g.awayAbbreviation} @ ${g.homeTeam ?? g.homeAbbreviation}`)
    lines.push(`Status: ${g.status ?? 'unknown'}${g.inningState ? ` (${g.inningState})` : ''}`)
    lines.push(`Score: ${g.score ?? 'n/a'}`)
    if (g.homeRecord || g.awayRecord) {
      lines.push(`Records: ${g.homeAbbreviation} ${g.homeRecord ?? '?'}, ${g.awayAbbreviation} ${g.awayRecord ?? '?'}`)
      available.push('team records')
    }
    if (g.baseState || g.count || g.outs != null) {
      lines.push(`Live: ${g.baseState ?? ''}${g.count ? `, count ${g.count}` : ''}${g.outs != null ? `, ${g.outs} out(s)` : ''}`)
      available.push('live game state')
    }
    if (g.homeMoneylineDisplay || g.awayMoneylineDisplay) {
      lines.push(`Odds (${g.oddsProvider ?? 'market'}): ${g.homeAbbreviation} ${g.homeMoneylineDisplay ?? 'n/a'}, ${g.awayAbbreviation} ${g.awayMoneylineDisplay ?? 'n/a'}`)
      available.push('sportsbook odds')
    }
    available.push('score', 'teams')
  }

  // Explicit inventory so the model knows the boundaries of its knowledge.
  lines.push('')
  lines.push('## Data availability')
  lines.push(`AVAILABLE: ${available.length ? [...new Set(available)].join('; ') : 'none'}`)
  lines.push(`NOT AVAILABLE in this app (do not invent): ${UNAVAILABLE_DATA.join('; ')}`)

  return { text: lines.join('\n'), available }
}

// Expand the retrieval query with concept terms inferred from the question, so
// TF-IDF pulls the right baseball concept docs even when the user's wording
// doesn't match the doc text.
function buildRetrievalQuery(message: string): string {
  const m = message.toLowerCase()
  const extra: string[] = []
  const add = (re: RegExp, terms: string) => {
    if (re.test(m)) extra.push(terms)
  }
  add(/win prob|chance|favored|who.?s winning|win this|likely to win/, 'win probability leverage run expectancy')
  add(/odds|moneyline|money line|fair|vig|juice|implied|edge|value|payout/, 'no-vig implied probability fair odds model market edge american odds')
  add(/pitch|starter|starting|era|fip|mound|ace|rotation/, 'starting pitcher quality era fip pitcher fatigue')
  add(/bullpen|relief|reliever|closer|setup|pen\b/, 'bullpen fatigue availability')
  add(/form|streak|hot|cold|lately|recent|last \d+|momentum/, 'recent team form run differential')
  add(/extra inning|walk.?off|ghost runner|10th|11th|12th/, 'extra innings ghost runner')
  add(/park|weather|wind|rain|temperature|humidity|dome|roof/, 'park weather')
  add(/prop|strikeout|home run|\bhr\b|hits|total bases|batter|hitter|at.?bat/, 'player props statcast lineup platoon')
  add(/xwoba|xera|barrel|hard.?hit|chase|whiff|exit velo|statcast|savant|launch/, 'statcast metrics xwoba barrel hard-hit chase whiff')
  add(/lineup|order|due up|platoon|handed|lefty|righty/, 'lineup strength platoon advantage')
  add(/projected|final score|total runs|over under|run line/, 'projected final score run expectancy')
  add(/why|change|move|moved|swing/, 'win probability leverage')
  return extra.length ? `${message}\n${extra.join(' ')}` : message
}

function formatRetrieved(docs: RetrievedDoc[]): string {
  return docs.map((d, i) => `Concept ${i + 1} — ${d.title}: ${d.text}`).join('\n\n')
}

async function callAnthropic(system: string, user: string): Promise<string> {
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    temperature: CHAT_TEMPERATURE,
    system,
    messages: [{ role: 'user', content: user }],
  })
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

// Local, free inference via Ollama's REST API (no extra npm dependency).
async function callOllama(system: string, user: string): Promise<string> {
  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      options: { temperature: CHAT_TEMPERATURE, num_ctx: OLLAMA_NUM_CTX },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Ollama ${response.status}: ${detail}`)
  }
  const data = (await response.json()) as { message?: { content?: string } }
  return data?.message?.content ?? ''
}

// Hosted, free, OpenAI-compatible inference via Groq (no extra npm dependency).
async function callGroq(system: string, user: string): Promise<string> {
  const response = await fetch(`${GROQ_HOST}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: CHAT_TEMPERATURE,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Groq ${response.status}: ${detail}`)
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data?.choices?.[0]?.message?.content ?? ''
}

// Hosted, free, via Google Gemini's generateContent API (no extra npm dependency).
async function callGemini(system: string, user: string): Promise<string> {
  const response = await fetch(`${GEMINI_HOST}/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: CHAT_TEMPERATURE, maxOutputTokens: 2048 },
    }),
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Gemini ${response.status}: ${detail}`)
  }
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  return (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
}

// Provider seam: choose the backend without touching callers.
async function callLlm(system: string, user: string): Promise<string> {
  if (LLM_PROVIDER === 'ollama') return callOllama(system, user)
  if (LLM_PROVIDER === 'groq') return callGroq(system, user)
  if (LLM_PROVIDER === 'gemini') return callGemini(system, user)
  return callAnthropic(system, user)
}

export async function answerMlbQuestion(request: ChatRequest): Promise<ChatResponse> {
  const { message, gameContext } = request
  const date = getEasternDateString()
  const intent = detectIntent(message, Boolean(gameContext?.gamePk))

  // Today's scoreboard is cheap (cached) and useful context for most questions.
  const cards = await getTodayCards(date).catch(() => [])

  // Resolve a game for model/odds/explanation/game-summary intents: the selected
  // game, else the first team mentioned in the message.
  let gamePk = gameContext?.gamePk ?? null
  if (!gamePk && ['model', 'odds', 'explanation', 'game_summary'].includes(intent)) {
    gamePk = findMatchingCards(message, cards)[0]?.gamePk ?? null
  }

  // Grounded model prediction — only for intents that actually need it, so a
  // player/scoreboard question with a game selected stays fast and focused
  // (and doesn't get pulled toward the game's model output).
  const wantsPrediction =
    ['model', 'odds', 'explanation', 'game_summary'].includes(intent) ||
    (intent === 'general' && Boolean(gameContext?.gamePk))
  let prediction: Prediction | null = null
  if (gamePk && wantsPrediction) {
    prediction = await getPredictionForGame(gamePk).catch(() => null)
  }

  const sections: string[] = [`USER QUESTION:\n${message}`, `DETECTED INTENT: ${intent}`]

  // Always give the league scoreboard for grounding (unless purely conceptual).
  sections.push(`TODAY'S GAMES (${date}):\n${buildScoreboardText(cards)}`)

  // Mode-specific data.
  if (intent === 'player') {
    const lower = message.toLowerCase()
    const wantsRange = /week|season|month|last \d+|yesterday|lately|recent|this year|past|stretch|\bwar\b|wrc|woba|\bops\b|\bobp\b/.test(lower)
    let block = ''
    // "today" / unspecified → live box-score line first.
    if (!wantsRange) {
      const lines = await findPlayerLines(message, cards).catch(() => [])
      if (lines.length) block = `PLAYER STAT LINES (today):\n${lines.join('\n')}`
    }
    // Range questions (this week / season / last N games), or no game today.
    if (!block) {
      const stats = await getPlayerStats(message, date).catch(() => null)
      if (stats) block = `PLAYER STATS:\n${stats}`
    }
    sections.push(
      block ||
        "PLAYER STATS: couldn't find that player or the requested range — the name may not be recognized. Ask the user to clarify."
    )
  }

  if (intent === 'game_summary' && gamePk) {
    sections.push(`GAME SUMMARY:\n${await buildGameSummary(gamePk).catch(() => 'unavailable')}`)
  }

  if (intent === 'leaders') {
    sections.push(`STAT LEADERS:\n${await buildLeadersContext(message, date.slice(0, 4)).catch(() => 'unavailable')}`)
  }

  if (prediction) {
    sections.push(`GROUNDED MODEL PREDICTION:\n${buildBaseballContext(prediction, gameContext).text}`)
  }

  // Trained-model probabilities (model/predict.ts artifact), when available —
  // best-effort context alongside the analytic prediction above.
  if (gamePk && wantsPrediction) {
    try {
      const payload = await getLiveScoreCardsByDate({ date })
      const card = payload.cards.find((c) => c.gamePk === gamePk)
      const trained = card ? predictWithTrainedModel(card) : null
      if (trained) {
        sections.push(
          `TRAINED MODEL (version ${trained.modelVersion}):\n` +
            `home win probability ${(trained.homeWinProbability * 100).toFixed(1)}%, ` +
            `fair home moneyline ${trained.fairHomeMoneyline}, ` +
            `book no-vig home probability ${trained.homeNoVigProbability !== null ? (trained.homeNoVigProbability * 100).toFixed(1) + '%' : 'n/a'}, ` +
            `model-vs-book edge ${trained.homeProbabilityEdge !== null ? (trained.homeProbabilityEdge * 100).toFixed(1) + ' pts' : 'n/a'}`
        )
      }
    } catch (_error) {
      // Trained model is optional context; never block the answer on it.
    }
  }

  // Concept docs help explanation / odds / general questions.
  const retrieved =
    ['explanation', 'odds', 'general', 'model'].includes(intent)
      ? retrieve(buildRetrievalQuery(message), 4)
      : []
  if (retrieved.length) {
    sections.push(`BASEBALL CONCEPTS (definitions only, no game numbers):\n${formatRetrieved(retrieved)}`)
  }

  if (intent === 'props') {
    sections.push(
      'PROPS: player prop projections are not built yet. Tell the user plainly; if a player is named and appeared in PLAYER STAT LINES, you may share their line.'
    )
  }

  sections.push(
    'Answer in the right mode for the intent. Lead with the baseball answer; keep it scannable. Use only the numbers above; if something is missing, say so in one line.'
  )

  const answer = await callLlm(SYSTEM_PROMPT, sections.filter(Boolean).join('\n\n'))

  return {
    answer,
    prediction,
    sources: retrieved.map((d) => d.title),
  }
}
