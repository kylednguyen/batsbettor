const MLB_STATS_ORIGIN = 'https://statsapi.mlb.com'

function getEasternDateString(date = new Date()): string {
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

function buildUrl(path: string, query: Record<string, string | number | boolean | undefined | null> = {}): URL {
  const url = new URL(path, MLB_STATS_ORIGIN)
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  return url
}

async function fetchJson(url: URL): Promise<unknown> {
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

export interface ScheduleByDateOptions {
  date: string
  sportId?: number
  gameType?: string
}

export interface GameFeedOptions {
  gamePk: number
}

export interface FlatGame {
  gamePk: number
  gameDate: string | null
  status: string | null
  homeTeam: string | null
  awayTeam: string | null
}

export class MlbStatsClient {
  async getScheduleByDate({ date, sportId = 1, gameType = 'R' }: ScheduleByDateOptions): Promise<unknown> {
    const url = buildUrl('/api/v1/schedule', { sportId, gameType, date })
    return fetchJson(url)
  }

  async getGameFeed({ gamePk }: GameFeedOptions): Promise<unknown> {
    const url = buildUrl(`/api/v1.1/game/${gamePk}/feed/live`)
    return fetchJson(url)
  }

  async getTodaySchedule(): Promise<unknown> {
    const today = getEasternDateString()
    return this.getScheduleByDate({ date: today })
  }
}

export function flattenGamesFromSchedule(schedulePayload: unknown): FlatGame[] {
  const payload = schedulePayload as {
    dates?: Array<{ games?: Array<{
      gamePk: number
      gameDate: string
      status?: { detailedState?: string; abstractGameState?: string }
      teams?: {
        home?: { team?: { name?: string } }
        away?: { team?: { name?: string } }
      }
    }> }>
  } | null

  return (payload?.dates ?? []).flatMap((dateEntry) =>
    (dateEntry.games ?? []).map((game) => ({
      gamePk: game.gamePk,
      gameDate: game.gameDate,
      status: game.status?.detailedState ?? game.status?.abstractGameState ?? null,
      homeTeam: game.teams?.home?.team?.name ?? null,
      awayTeam: game.teams?.away?.team?.name ?? null,
    }))
  )
}
