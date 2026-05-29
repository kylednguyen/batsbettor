async function readApiPayload(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json()
  }

  const text = await response.text()
  return {
    error: text.includes('<!DOCTYPE')
      ? 'Backend unavailable. Start `npm run dev:server` to load live MLB data.'
      : text || 'Unexpected API response',
  }
}

export async function sendChatMessage(message) {
  return {
    ok: true,
    message,
    note: 'Replace this stub with POST /api/chat when the backend is ready.',
  }
}

export async function getTodayScoreCardSummary() {
  const response = await fetch('/api/mlb/today-score')
  const payload = await readApiPayload(response)
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to load featured score card')
  }
  return payload
}

export async function getScoreCardsByDate(date) {
  const search = new URLSearchParams()
  if (date) search.set('date', date)

  const response = await fetch(`/api/mlb/scorecards${search.size ? `?${search}` : ''}`)
  const payload = await readApiPayload(response)
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to load score cards')
  }
  return payload
}

export async function getGameFeed(gamePk) {
  const response = await fetch(`/api/mlb/game/${gamePk}/live`)
  const payload = await readApiPayload(response)
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to load game feed')
  }
  return payload
}
