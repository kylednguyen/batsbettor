// Team recent-form feature: summarize a club's results over its last N games.
//
// Pure helpers shared by the runtime service and the offline training pipeline,
// plus a runtime fetcher that pulls a team's recent schedule from MLB StatsAPI.
// Recent form (win rate and run differential over the last ~30 games) is a
// strong, explainable pregame signal and the input to the trained pregame
// win-probability model.

import { getScheduleRange } from './mlbStatsService.js'

export const FORM_WINDOW = 30

export interface TeamGameResult {
  date: string
  runsFor: number
  runsAgainst: number
  win: boolean
}

export interface TeamForm {
  games: number
  wins: number
  losses: number
  winPct: number
  runsForAvg: number
  runsAgainstAvg: number
  runDiffAvg: number
  // Short-window (last 10) splits — captures recent hot/cold streaks.
  winPct10: number
  runDiffAvg10: number
  recordLabel: string
}

// Summarize the most recent `window` results into a form snapshot.
export function summarizeForm(results: TeamGameResult[], window = FORM_WINDOW): TeamForm {
  const recent = results.slice(-window)
  const games = recent.length
  if (games === 0) {
    return {
      games: 0,
      wins: 0,
      losses: 0,
      winPct: 0.5,
      runsForAvg: 4.4,
      runsAgainstAvg: 4.4,
      runDiffAvg: 0,
      winPct10: 0.5,
      runDiffAvg10: 0,
      recordLabel: '0-0',
    }
  }

  let wins = 0
  let runsFor = 0
  let runsAgainst = 0
  for (const r of recent) {
    if (r.win) wins += 1
    runsFor += r.runsFor
    runsAgainst += r.runsAgainst
  }
  const losses = games - wins

  // Last-10 split (or as many as available).
  const last10 = recent.slice(-10)
  let wins10 = 0
  let runDiff10 = 0
  for (const r of last10) {
    if (r.win) wins10 += 1
    runDiff10 += r.runsFor - r.runsAgainst
  }

  return {
    games,
    wins,
    losses,
    winPct: wins / games,
    runsForAvg: runsFor / games,
    runsAgainstAvg: runsAgainst / games,
    runDiffAvg: (runsFor - runsAgainst) / games,
    winPct10: wins10 / last10.length,
    runDiffAvg10: runDiff10 / last10.length,
    recordLabel: `${wins}-${losses}`,
  }
}

function shiftDate(dateString: string, deltaDays: number): string {
  const [y, m, d] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
}

// Extract a team's completed-game results (most recent last) from a schedule
// payload, strictly before `beforeDate` to avoid leakage.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTeamResults(schedule: any, teamId: number, beforeDate: string): TeamGameResult[] {
  const results: TeamGameResult[] = []
  for (const dateEntry of schedule?.dates ?? []) {
    for (const game of dateEntry?.games ?? []) {
      const code = game?.status?.abstractGameCode ?? game?.status?.codedGameState
      if (code !== 'F') continue
      const gameDate = String(game?.gameDate ?? dateEntry?.date ?? '').slice(0, 10)
      if (!gameDate || gameDate >= beforeDate) continue

      const home = game?.teams?.home
      const away = game?.teams?.away
      const isHome = home?.team?.id === teamId
      const isAway = away?.team?.id === teamId
      if (!isHome && !isAway) continue

      const self = isHome ? home : away
      const opp = isHome ? away : home
      if (typeof self?.score !== 'number' || typeof opp?.score !== 'number') continue

      results.push({
        date: gameDate,
        runsFor: self.score,
        runsAgainst: opp.score,
        win: self.score > opp.score,
      })
    }
  }
  results.sort((a, b) => a.date.localeCompare(b.date))
  return results
}

// Per-team runtime cache (form changes at most once per game).
const formCache = new Map<number, { fetchedAt: number; form: TeamForm }>()
const FORM_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

export async function getTeamForm(
  teamId: number,
  asOfDate: string = new Date().toISOString().slice(0, 10)
): Promise<TeamForm | null> {
  if (!teamId) return null

  const cached = formCache.get(teamId)
  if (cached && Date.now() - cached.fetchedAt < FORM_CACHE_TTL_MS) {
    return cached.form
  }

  try {
    // Pull ~60 days back to comfortably cover the last 30 games.
    const schedule = await getScheduleRange({
      startDate: shiftDate(asOfDate, -60),
      endDate: asOfDate,
      teamId,
    })
    const results = extractTeamResults(schedule, teamId, shiftDate(asOfDate, 1))
    if (results.length === 0) return null
    const form = summarizeForm(results)
    formCache.set(teamId, { fetchedAt: Date.now(), form })
    return form
  } catch (_error) {
    return null
  }
}
