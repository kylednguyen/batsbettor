// Explainable live win-probability and projected-score model.
//
// This is an analytic ("white box") model rather than a trained ML pickle.
// It estimates each team's remaining runs from base/out run expectancy plus
// the number of innings each team still bats, models the remaining run
// differential as a normal distribution, and blends the resulting game-state
// win probability with a pregame market prior that decays as the game unfolds.
//
// It is deliberately transparent so the chatbot can explain *why* a number
// moved. It is not betting advice.

const REGULATION_INNINGS = 9
const OUTS_PER_HALF = 3
const OUTS_PER_INNING = OUTS_PER_HALF * 2
const REGULATION_OUTS = REGULATION_INNINGS * OUTS_PER_INNING // 54

// Average runs a team scores per full inning (~4.5 runs / 9 innings).
const RUNS_PER_INNING = 0.5
// Extra innings start with the automatic runner on second base (2020+ rule),
// so a fresh extra half-inning is worth more than a regular one. ~0.9 reflects
// the runner-on-2nd, 0-out run expectancy discounted for walk-off truncation.
const EXTRA_INNING_RUNS = 0.9
// Dispersion factor: run scoring clusters, so variance > mean (Poisson-ish).
const RUN_DISPERSION = 1.35

// 2010s-era run expectancy by base state and outs (expected runs scored in the
// remainder of the current half-inning). Keyed by base occupancy code.
const RUN_EXPECTANCY: Record<string, [number, number, number]> = {
  // bases: [0 outs, 1 out, 2 outs]
  empty: [0.48, 0.25, 0.1],
  '1--': [0.85, 0.5, 0.22],
  '-2-': [1.1, 0.65, 0.31],
  '--3': [1.32, 0.9, 0.36],
  '12-': [1.43, 0.88, 0.42],
  '1-3': [1.75, 1.13, 0.48],
  '-23': [1.92, 1.36, 0.58],
  '123': [2.28, 1.51, 0.76],
}

export type HalfInning = 'Top' | 'Bottom'

export interface GameState {
  statusCode: string | null // 'P' pregame, 'L' live, 'F' final
  inning: number | null // current inning number (1-based)
  half: HalfInning | null
  outs: number | null
  homeScore: number | null
  awayScore: number | null
  onFirst: boolean
  onSecond: boolean
  onThird: boolean
}

export interface WinProbabilityResult {
  homeWinProbability: number
  awayWinProbability: number
  projectedHomeRuns: number
  projectedAwayRuns: number
  projectedTotalRuns: number
  projectedRunDiff: number // home - away
  fractionComplete: number
  marketWeight: number
}

function baseStateCode(state: GameState): string {
  if (!state.onFirst && !state.onSecond && !state.onThird) return 'empty'
  return `${state.onFirst ? '1' : '-'}${state.onSecond ? '2' : '-'}${state.onThird ? '3' : '-'}`
}

function runExpectancy(state: GameState): number {
  const outs = clamp(state.outs ?? 0, 0, 2)
  const row = RUN_EXPECTANCY[baseStateCode(state)] ?? RUN_EXPECTANCY.empty
  return row[outs]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// Standard normal CDF via the Abramowitz & Stegun erf approximation.
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2)
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x >= 0 ? 1 - p : p
}

// Expected remaining runs for each team given the current state.
function expectedRemainingRuns(state: GameState): { home: number; away: number } {
  const inning = state.inning ?? 1
  const half = state.half ?? 'Top'
  const batting = runExpectancy(state)

  // Full innings each team still bats after the current half-inning completes.
  // Count remaining half-innings each team will bat, split into regulation and
  // extra innings (which are scored at a higher rate for the ghost runner).
  const reg = REGULATION_INNINGS
  let homeBattingNow = 0
  let awayBattingNow = 0
  let homeRegHalves = 0
  let homeExtraHalves = 0
  let awayRegHalves = 0
  let awayExtraHalves = 0

  if (half === 'Top') {
    awayBattingNow = batting
    awayRegHalves = Math.max(reg - inning, 0)
    if (inning <= reg) {
      // Home still bats the bottom of this inning plus innings inning+1..9.
      homeRegHalves = reg - inning + 1
    } else {
      // Extra innings: home is guaranteed the bottom of the current inning.
      homeExtraHalves = 1
    }
  } else {
    homeBattingNow = batting
    homeRegHalves = Math.max(reg - inning, 0)
    awayRegHalves = Math.max(reg - inning, 0)
  }

  return {
    home: homeBattingNow + homeRegHalves * RUNS_PER_INNING + homeExtraHalves * EXTRA_INNING_RUNS,
    away: awayBattingNow + awayRegHalves * RUNS_PER_INNING + awayExtraHalves * EXTRA_INNING_RUNS,
  }
}

function outsCompleted(state: GameState): number {
  if (state.inning == null || state.half == null) return 0
  const halfIndex = state.half === 'Top' ? 0 : 1
  return (state.inning - 1) * OUTS_PER_INNING + halfIndex * OUTS_PER_HALF + (state.outs ?? 0)
}

// Pregame prior from the market no-vig home probability, or home-field baseline.
export function computeWinProbability(
  state: GameState,
  pregameHomeProb: number | null
): WinProbabilityResult {
  const homeScore = state.homeScore ?? 0
  const awayScore = state.awayScore ?? 0

  // Decided game: return the realized outcome.
  if (state.statusCode === 'F') {
    const homeWon = homeScore > awayScore
    return {
      homeWinProbability: homeWon ? 1 : 0,
      awayWinProbability: homeWon ? 0 : 1,
      projectedHomeRuns: homeScore,
      projectedAwayRuns: awayScore,
      projectedTotalRuns: homeScore + awayScore,
      projectedRunDiff: homeScore - awayScore,
      fractionComplete: 1,
      marketWeight: 0,
    }
  }

  const rem = expectedRemainingRuns(state)
  const meanFinalDiff = homeScore + rem.home - (awayScore + rem.away)

  // Variance of remaining runs (each team), Poisson-like with dispersion.
  const variance = (rem.home + rem.away) * RUN_DISPERSION
  const sigma = Math.sqrt(Math.max(variance, 1e-6))

  // Game-state win probability: P(final home - away > 0).
  const stateHomeProb = normalCdf(meanFinalDiff / sigma)

  const fractionComplete = clamp(outsCompleted(state) / REGULATION_OUTS, 0, 1)

  // Blend in the pregame prior; its weight decays as the game progresses.
  const homeFieldPrior = 0.54
  const prior = pregameHomeProb ?? homeFieldPrior
  const marketWeight = state.statusCode === 'L' ? 1 - fractionComplete : 1
  const homeWinProbability = clamp(
    marketWeight * prior + (1 - marketWeight) * stateHomeProb,
    0.005,
    0.995
  )

  return {
    homeWinProbability,
    awayWinProbability: 1 - homeWinProbability,
    projectedHomeRuns: round1(homeScore + rem.home),
    projectedAwayRuns: round1(awayScore + rem.away),
    projectedTotalRuns: round1(homeScore + rem.home + awayScore + rem.away),
    projectedRunDiff: round1(meanFinalDiff),
    fractionComplete,
    marketWeight,
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
