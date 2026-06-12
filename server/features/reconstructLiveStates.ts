import { parseWinPct, type LiveGameState } from './buildLiveFeatureVector.js'

// Reconstruct the game state at the START of every at-bat from a historical
// MLB live feed (liveData.plays.allPlays). This is how the live model trains
// on past results: each reconstructed state pairs with the game's final
// home_win label. Only state that existed before the at-bat resolved is used
// — score, outs, and runners are taken from the END of the previous play.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>

export interface ReconstructedState {
  state: LiveGameState
  atBatIndex: number
}

export interface ReconstructedGame {
  gamePk: number
  gameDate: string | null
  homeTeam: string | null
  awayTeam: string | null
  finalHomeScore: number
  finalAwayScore: number
  homeWin: boolean
  states: ReconstructedState[]
}

export function reconstructLiveStates(feed: AnyRecord): ReconstructedGame | null {
  const gameData = feed?.gameData ?? {}
  const gamePk: number | null = gameData?.game?.pk ?? null
  const statusCode: string | null = gameData?.status?.abstractGameCode ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allPlays: any[] = feed?.liveData?.plays?.allPlays ?? []

  if (gamePk === null || statusCode !== 'F' || allPlays.length === 0) return null

  const lastPlay = allPlays[allPlays.length - 1]
  const finalHomeScore: number | null = lastPlay?.result?.homeScore ?? null
  const finalAwayScore: number | null = lastPlay?.result?.awayScore ?? null
  if (finalHomeScore === null || finalAwayScore === null || finalHomeScore === finalAwayScore) {
    return null
  }

  const homeWinPct = parseWinPct(formatRecord(gameData?.teams?.home?.record)) ?? 0.5
  const awayWinPct = parseWinPct(formatRecord(gameData?.teams?.away?.record)) ?? 0.5

  const states: ReconstructedState[] = []

  for (let i = 0; i < allPlays.length; i += 1) {
    const play = allPlays[i]
    const inning: number | null = play?.about?.inning ?? null
    const isTopInning: boolean = Boolean(play?.about?.isTopInning)
    if (inning === null) continue

    const prev = i > 0 ? allPlays[i - 1] : null
    const sameHalfInning =
      prev !== null &&
      prev?.about?.inning === inning &&
      Boolean(prev?.about?.isTopInning) === isTopInning

    const outs = sameHalfInning ? Math.min(prev?.count?.outs ?? 0, 2) : 0
    const homeScore = prev?.result?.homeScore ?? 0
    const awayScore = prev?.result?.awayScore ?? 0
    const onFirst = sameHalfInning ? Boolean(prev?.matchup?.postOnFirst) : false
    const onSecond = sameHalfInning ? Boolean(prev?.matchup?.postOnSecond) : false
    const onThird = sameHalfInning ? Boolean(prev?.matchup?.postOnThird) : false

    states.push({
      atBatIndex: play?.about?.atBatIndex ?? i,
      state: {
        inning,
        isTopInning,
        outs,
        homeScore,
        awayScore,
        onFirst,
        onSecond,
        onThird,
        homeWinPct,
        awayWinPct,
      },
    })
  }

  if (states.length === 0) return null

  return {
    gamePk,
    gameDate: gameData?.datetime?.officialDate ?? null,
    homeTeam: gameData?.teams?.home?.name ?? null,
    awayTeam: gameData?.teams?.away?.name ?? null,
    finalHomeScore,
    finalAwayScore,
    homeWin: finalHomeScore > finalAwayScore,
    states,
  }
}

function formatRecord(record: { wins?: number; losses?: number } | null | undefined): string | null {
  const wins = record?.wins
  const losses = record?.losses
  if (wins === null || wins === undefined || losses === null || losses === undefined) return null
  return `${wins}-${losses}`
}
