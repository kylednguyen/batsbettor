import Anthropic from '@anthropic-ai/sdk'
import type { ScoreCard } from '../src/types.js'
import { predictGame } from './model/predict.js'
import type { ScoreCard as ServerScoreCard } from './mlbStatsService.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are BattersBetter, an MLB analytics assistant. You help users understand live game states, win probabilities, sportsbook odds, and model-vs-market differences.

When answering:
- Be concise and direct
- Use plain English a baseball fan can understand
- If you don't have live data for a specific game, say so clearly
- Format numbers cleanly (e.g. "68.1%" not "0.681")
- If a game context is provided, use it to ground your answer

You are NOT a betting advisor. This is a sports analytics and machine learning portfolio project.`

export interface ChatRequest {
  message: string
  gameContext?: ScoreCard | null
}

export interface ChatResponse {
  answer: string
}

export async function handleChat(request: ChatRequest): Promise<ChatResponse> {
  const { message, gameContext } = request

  let contextBlock = ''
  if (gameContext) {
    contextBlock = `\n\nCurrent game context:\n${JSON.stringify(gameContext, null, 2)}`
    try {
      const prediction = predictGame(gameContext as unknown as ServerScoreCard)
      if (prediction) {
        contextBlock += `\n\nModel prediction (version ${prediction.modelVersion}):\n${JSON.stringify(prediction, null, 2)}\nNote: homeProbabilityEdge is the model probability minus the no-vig book probability. Probabilities are decimals (0.62 = 62%).`
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
