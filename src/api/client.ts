import type { ScoreCard, ScoreBox, MlbFeedPayload, ChatMessage } from '../types'
import { apiUrl } from './config'

interface ApiErrorPayload {
  error: string
}

type ApiPayload = Record<string, unknown> | ApiErrorPayload

async function readApiPayload(response: Response): Promise<ApiPayload> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json() as Promise<ApiPayload>
  }

  const text = await response.text()
  return {
    error: text.includes('<!DOCTYPE')
      ? 'Backend unavailable. Start `npm run dev:server` to load live MLB data.'
      : text || 'Unexpected API response',
  }
}

export interface TodayScoreCardSummaryPayload {
  date: string
  scoreBox: ScoreBox | null
  message?: string
}

export interface ScoreCardsByDatePayload {
  date: string
  oddsProvider: string | null
  totalGames: number
  gamesInProgress: number
  cards: ScoreCard[]
}

export interface ChatApiResponse {
  answer: string
}

export async function sendChatMessage(
  message: string,
  gameContext?: ScoreCard | null
): Promise<ChatMessage> {
  const response = await fetch(apiUrl('/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, gameContext: gameContext ?? null }),
  })
  const payload = await readApiPayload(response)
  if (!response.ok) {
    throw new Error((payload as ApiErrorPayload).error || 'Chat request failed')
  }
  const { answer } = payload as unknown as ChatApiResponse
  return { role: 'assistant', body: answer }
}

export async function getTodayScoreCardSummary(): Promise<TodayScoreCardSummaryPayload> {
  const response = await fetch(apiUrl('/api/mlb/today-score'))
  const payload = await readApiPayload(response)
  if (!response.ok) {
    throw new Error((payload as ApiErrorPayload).error || 'Failed to load featured score card')
  }
  return payload as unknown as TodayScoreCardSummaryPayload
}

export async function getScoreCardsByDate(date?: string): Promise<ScoreCardsByDatePayload> {
  const search = new URLSearchParams()
  if (date) search.set('date', date)

  const response = await fetch(apiUrl(`/api/mlb/scorecards${search.size ? `?${search}` : ''}`))
  const payload = await readApiPayload(response)
  if (!response.ok) {
    throw new Error((payload as ApiErrorPayload).error || 'Failed to load score cards')
  }
  return payload as unknown as ScoreCardsByDatePayload
}

export async function getGameFeed(gamePk: number): Promise<MlbFeedPayload> {
  const response = await fetch(apiUrl(`/api/mlb/game/${gamePk}/live`))
  const payload = await readApiPayload(response)
  if (!response.ok) {
    throw new Error((payload as ApiErrorPayload).error || 'Failed to load game feed')
  }
  return payload as MlbFeedPayload
}
