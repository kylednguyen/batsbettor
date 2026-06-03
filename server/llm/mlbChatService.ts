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

const SYSTEM_PROMPT = `You are BattersBetter, an MLB analyst built into a live win-probability app.

Answer like a sharp, concise baseball analyst. Reason using the factors that actually drive MLB outcomes, but ONLY when they are present in BASEBALL CONTEXT:
- starting pitcher matchup (ERA, FIP, K/9)
- bullpen fatigue and availability (recent pitch load, back-to-back arms)
- recent team form (last 10/30 games, run differential)
- live game state (inning, score, base/out state, leverage)
- odds and implied (no-vig) probability, and the model-vs-market edge
- lineup strength, platoon/handedness, and Statcast quality (xwOBA, barrel rate, etc.) WHEN provided

Division of labor:
- The ML model computes the win probability and projected score. You explain and contextualize them — you never compute, re-estimate, or guess probabilities yourself.
- Use the RETRIEVED BASEBALL CONCEPTS only to explain what a term means or why a factor matters, never as a source of game-specific numbers.

Strict rules (no hallucinations):
- Use ONLY the figures in BASEBALL CONTEXT. Never invent or approximate values.
- Never invent: injuries, odds, player stats, pitcher names, live scores, Statcast/Savant metrics, weather, or lineups.
- If the data needed to answer is not in BASEBALL CONTEXT, do not guess. Say: "I do not have enough data for that yet. I would need [specific missing data]." and list it under Missing data.
- This is an analytics/portfolio project, not betting advice.

Always respond in EXACTLY this format:

Direct answer:
<1-2 sentences that directly answer the question>

Why:
- <reason tied to a specific number/fact from BASEBALL CONTEXT>
- <reason 2>
- <reason 3 if useful>

Confidence:
<Low | Medium | High>

Missing data:
- <data that would improve the answer, or "None">`

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

  // 1. Fetch the grounded ML prediction for the game in context.
  let prediction: Prediction | null = null
  if (gameContext?.gamePk) {
    try {
      prediction = await getPredictionForGame(gameContext.gamePk)
    } catch (_error) {
      prediction = null
    }
  }

  // 2. Build the structured baseball context (+ data availability inventory).
  const { text: contextBlock } = buildBaseballContext(prediction, gameContext)

  // 3. Retrieve relevant baseball concepts using an expanded, intent-aware query.
  const retrieved = retrieve(buildRetrievalQuery(message), 5)

  // 4. Assemble the prompt.
  const userPrompt = [
    `USER QUESTION:\n${message}`,
    `BASEBALL CONTEXT (the only source of game-specific numbers):\n${contextBlock}`,
    retrieved.length
      ? `RETRIEVED BASEBALL CONCEPTS (definitions only, no game numbers):\n${formatRetrieved(retrieved)}`
      : '',
    'Answer using the required format. Ground every number in BASEBALL CONTEXT. If you lack the data, say so under Missing data instead of guessing.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const answer = await callLlm(SYSTEM_PROMPT, userPrompt)

  return {
    answer,
    prediction,
    sources: retrieved.map((d) => d.title),
  }
}
