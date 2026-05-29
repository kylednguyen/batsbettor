const MLB_STATS_ORIGIN = 'https://statsapi.mlb.com'

function getEasternDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${lookup.year}-${lookup.month}-${lookup.day}`
}

function buildUrl(path, query = {}) {
  const url = new URL(path, MLB_STATS_ORIGIN)
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  return url
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`MLB Stats API ${response.status}: ${errorText}`)
  }
  return response.json()
}

export class MlbStatsClient {
  async getScheduleByDate({ date, sportId = 1, gameType = 'R' }) {
    const url = buildUrl('/api/v1/schedule', { sportId, gameType, date })
    return fetchJson(url)
  }

  async getGameFeed({ gamePk }) {
    const url = buildUrl(`/api/v1.1/game/${gamePk}/feed/live`)
    return fetchJson(url)
  }

  async getTodaySchedule() {
    const today = getEasternDateString()
    return this.getScheduleByDate({ date: today })
  }
}

export function flattenGamesFromSchedule(schedulePayload) {
  return (schedulePayload?.dates ?? []).flatMap((dateEntry) =>
    (dateEntry.games ?? []).map((game) => ({
      gamePk: game.gamePk,
      gameDate: game.gameDate,
      status: game.status?.detailedState ?? game.status?.abstractGameState ?? null,
      homeTeam: game.teams?.home?.team?.name ?? null,
      awayTeam: game.teams?.away?.team?.name ?? null,
    }))
  )
}
