import Anthropic from '@anthropic-ai/sdk'
import type { ScoreCard } from '../src/types.js'
import { predictGame, type Prediction } from './model/predict.js'
import { buildFeatureVector, FEATURE_NAMES } from './features/buildFeatureVector.js'
import { buildLiveFeatureVector, liveStateFromScoreCard } from './features/buildLiveFeatureVector.js'
import { formatAmericanOdds } from './utils/oddsMath.js'
import type { ScoreCard as ServerScoreCard } from './mlbStatsService.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are BattersBetter, an MLB analytics assistant for a machine learning portfolio project. You explain live game states, win probabilities, and odds in plain English.

CRITICAL — model provenance rules. The prediction context tells you which model produced each number. Respect it:

1. If model_source is "market-baseline" (version devig-*): the win probability IS the sportsbook's own de-vigged probability. It is NOT an independent model opinion. Never present it as "our model thinks..." and NEVER claim a model-vs-book edge (the edge is zero by construction). Describe it as "the market-implied probability with the bookmaker's margin removed."

2. If model_source is "trained" (version lr-* or lr-live-*): this is our logistic regression. Say what it was trained on (the listed features) when explaining WHY. Its probability can legitimately differ from the book — only then is an "edge" meaningful, and even then frame large edges skeptically: the market is a strong baseline, so big disagreements usually mean the model is missing something.

3. Only discuss outputs the system actually produces: win probability and fair-odds translation. We have NO score projection model, NO totals model, NO player props. If asked for a projected final score or anything not in the context, say it isn't modeled yet rather than estimating one.

4. When explaining a trained prediction, ground the explanation ONLY in the feature values provided (e.g. run differential, inning, base runners, team records). Do not invent reasons like bullpen fatigue, injuries, or momentum — that data is not in the model.

Formatting:
- Probabilities as percentages with one decimal ("68.1%", never "0.681")
- American odds with their sign ("-150", "+130")
- Lead with the direct answer, then at most 2-3 sentences of explanation
- State clearly when data is missing instead of filling gaps

You are NOT a betting advisor.`

export interface ChatRequest {
  message: string
  gameContext?: ScoreCard | null
}

export interface ChatResponse {
  answer: string
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function describePrediction(card: ServerScoreCard, prediction: Prediction): string {
  const isBaseline = prediction.modelVersion.startsWith('devig')
  const isLiveModel = prediction.modelVersion.startsWith('lr-live')

  const lines: string[] = [
    `model_version: ${prediction.modelVersion}`,
    `model_source: ${isBaseline ? 'market-baseline' : 'trained'}`,
    `home_win_probability: ${pct(prediction.homeWinProbability)}`,
    `away_win_probability: ${pct(prediction.awayWinProbability)}`,
    `fair_odds_from_that_probability: home ${formatAmericanOdds(prediction.fairHomeMoneyline)}, away ${formatAmericanOdds(prediction.fairAwayMoneyline)}`,
  ]

  if (prediction.homeNoVigProbability !== null && prediction.awayNoVigProbability !== null) {
    lines.push(`book_no_vig_probability: home ${pct(prediction.homeNoVigProbability)}, away ${pct(prediction.awayNoVigProbability)}`)
  }

  if (isBaseline) {
    lines.push('edge: none by construction — this probability IS the de-vigged book probability')
  } else if (prediction.homeProbabilityEdge !== null) {
    lines.push(`model_vs_book_edge_home: ${(prediction.homeProbabilityEdge * 100).toFixed(1)} percentage points`)
  }

  // Surface the exact inputs the trained model saw, so explanations stay
  // grounded in real features instead of invented narratives.
  if (!isBaseline) {
    if (isLiveModel) {
      const state = liveStateFromScoreCard(card)
      if (state) {
        const vector = buildLiveFeatureVector(state)
        lines.push(`trained_on_features: ${JSON.stringify(vector.features)}`)
      }
    } else {
      const vector = buildFeatureVector(card)
      if (vector) {
        lines.push(`trained_on_features: ${JSON.stringify(vector.features)}`)
      } else {
        lines.push(`trained_on_features: ${FEATURE_NAMES.join(', ')} (values unavailable)`)
      }
    }
  }

  return lines.join('\n')
}

function describeGame(card: ServerScoreCard): string {
  const lines: string[] = [`matchup: ${card.matchup}`, `status: ${card.status ?? 'unknown'}`]
  if (card.score) lines.push(`score: ${card.score}`)
  if (card.inningState) lines.push(`inning: ${card.inningState}`)
  if (card.outs !== null && card.outs !== undefined) lines.push(`outs: ${card.outs}`)
  if (card.count) lines.push(`count: ${card.count}`)
  if (card.baseState) lines.push(`base_state: ${card.baseState}`)
  if (card.awayRecord || card.homeRecord) {
    lines.push(`records: away ${card.awayRecord ?? '?'}, home ${card.homeRecord ?? '?'}`)
  }
  if (card.homeMoneylineDisplay && card.awayMoneylineDisplay) {
    lines.push(`book_moneyline (${card.oddsProvider ?? 'book'}): home ${card.homeMoneylineDisplay}, away ${card.awayMoneylineDisplay}`)
  } else {
    lines.push('book_moneyline: not available')
  }
  return lines.join('\n')
}

export async function handleChat(request: ChatRequest): Promise<ChatResponse> {
  const { message, gameContext } = request

  let contextBlock = ''
  if (gameContext) {
    const card = gameContext as unknown as ServerScoreCard
    contextBlock = `\n\n--- Game context ---\n${describeGame(card)}`
    try {
      const prediction = predictGame(card)
      if (prediction) {
        contextBlock += `\n\n--- Prediction context ---\n${describePrediction(card, prediction)}`
      } else {
        contextBlock += '\n\n--- Prediction context ---\nNo prediction available (no odds posted yet and no live model state).'
      }
    } catch (_error) {
      // Prediction is best-effort context; chat should still answer without it.
    }
  }

  const userContent = `${message}${contextBlock}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  })

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')

  return { answer: text }
}
