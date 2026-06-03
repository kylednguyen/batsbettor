// Prediction service: parse the live MLB feed into a game state, run the
// win-probability / projected-score model, translate the market moneyline, and
// assemble a single grounded prediction object with plain-English drivers.

import { getGameFeed, getOddsForMatchup, type OddsEntry } from './mlbStatsService.js'
import { getDraftKingsOddsForMatchup } from './draftkingsService.js'
import { getTeamForm, type TeamForm } from './teamForm.js'
import { predictPregameHomeWinProb } from './pregameModel.js'
import { predictXgbHomeWinProb } from './xgbModel.js'
import { getProbableStarters, type PitcherProfile } from './pitcherService.js'
import { getBullpenStatus, type BullpenStatus } from './bullpenService.js'
import {
  americanToImpliedProb,
  impliedProbToAmerican,
  formatAmerican,
  translateMoneyline,
} from './oddsMath.js'
import {
  computeWinProbability,
  type GameState,
  type HalfInning,
} from './winProbability.js'

export interface ParsedGameState extends GameState {
  homeTeam: string | null
  awayTeam: string | null
  homeTeamId: number | null
  awayTeamId: number | null
  homeAbbreviation: string
  awayAbbreviation: string
  inningOrdinal: string | null
  baseState: string
  scoreDisplay: string
}

export interface PredictionModel {
  homeWinProbability: number
  awayWinProbability: number
  projectedHomeRuns: number
  projectedAwayRuns: number
  projectedTotalRuns: number
  projectedRunDiff: number
  fairHomeMoneyline: number
  fairAwayMoneyline: number
  fairHomeMoneylineDisplay: string
  fairAwayMoneylineDisplay: string
}

export interface PredictionMarket {
  provider: string | null
  homeMoneyline: number | null
  awayMoneyline: number | null
  homeMoneylineDisplay: string | null
  awayMoneylineDisplay: string | null
  homeNoVigProbability: number | null
  awayNoVigProbability: number | null
  bookHold: number | null
}

export interface PredictionEdge {
  homeProbabilityEdge: number // percentage points (model - market)
  awayProbabilityEdge: number
}

export interface TeamFormSummary {
  record: string // e.g. "18-12" over the form window
  winPct: number
  runDiffPerGame: number
}

// Play-by-play context extracted from the live feed (already fetched).
export interface PlayContext {
  recentScoringPlays: string[]
  lastPlay: string | null
  currentBatter: string | null
  currentPitcher: string | null
}

export interface MatchupPitchers {
  home: PitcherProfile | null
  away: PitcherProfile | null
}

export interface MatchupBullpens {
  home: BullpenStatus | null
  away: BullpenStatus | null
}

// How the starter/bullpen pipeline nudged the pregame prior (percentage points,
// from the home team's perspective). Zero when the market prior is used.
export interface MatchupAdjustment {
  starterEdgePts: number
  bullpenEdgePts: number
  applied: boolean
}

export interface Prediction {
  gamePk: number
  homeTeam: string | null
  awayTeam: string | null
  homeAbbreviation: string
  awayAbbreviation: string
  status: string | null
  statusCode: string | null
  inning: number | null
  inningOrdinal: string | null
  half: HalfInning | null
  outs: number | null
  baseState: string
  score: string
  homeScore: number | null
  awayScore: number | null
  model: PredictionModel
  market: PredictionMarket | null
  edge: PredictionEdge | null
  homeForm: TeamFormSummary | null
  awayForm: TeamFormSummary | null
  startingPitchers: MatchupPitchers | null
  bullpen: MatchupBullpens | null
  matchupAdjustment: MatchupAdjustment | null
  recentScoringPlays: string[]
  lastPlay: string | null
  currentBatter: string | null
  currentPitcher: string | null
  priorSource: 'market' | 'form-model' | 'home-field'
  confidence: 'Low' | 'Medium' | 'High'
  drivers: string[]
  warnings: string[]
  modelVersion: string
}

const MODEL_VERSION = 'analytic-live-v1'

function isTruthy(value: unknown): boolean {
  return Boolean(value)
}

function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function describeBaseState(state: GameState): string {
  const bases: string[] = []
  if (state.onFirst) bases.push('1st')
  if (state.onSecond) bases.push('2nd')
  if (state.onThird) bases.push('3rd')
  return bases.length > 0 ? bases.join(', ') : 'Bases empty'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseGameStateFromFeed(feed: Record<string, any>): ParsedGameState {
  const gameData = feed?.gameData ?? {}
  const liveData = feed?.liveData ?? {}
  const linescore = liveData?.linescore ?? {}
  const offense = linescore?.offense ?? {}
  const teams = gameData?.teams ?? {}

  const statusCode: string | null = gameData?.status?.abstractGameCode ?? null
  const rawHalf: string | null = linescore?.inningHalf ?? null
  const half: HalfInning | null =
    rawHalf === 'Top' ? 'Top' : rawHalf === 'Bottom' ? 'Bottom' : null

  const homeAbbreviation: string = teams?.home?.abbreviation ?? teams?.home?.name ?? 'HOME'
  const awayAbbreviation: string = teams?.away?.abbreviation ?? teams?.away?.name ?? 'AWAY'
  const homeScore: number | null = linescore?.teams?.home?.runs ?? null
  const awayScore: number | null = linescore?.teams?.away?.runs ?? null
  const inning: number | null =
    typeof linescore?.currentInning === 'number' ? linescore.currentInning : null

  const state: ParsedGameState = {
    statusCode,
    inning,
    half,
    outs: typeof linescore?.outs === 'number' ? linescore.outs : null,
    homeScore,
    awayScore,
    onFirst: isTruthy(offense?.first),
    onSecond: isTruthy(offense?.second),
    onThird: isTruthy(offense?.third),
    homeTeam: teams?.home?.name ?? null,
    awayTeam: teams?.away?.name ?? null,
    homeTeamId: typeof teams?.home?.id === 'number' ? teams.home.id : null,
    awayTeamId: typeof teams?.away?.id === 'number' ? teams.away.id : null,
    homeAbbreviation,
    awayAbbreviation,
    inningOrdinal: inning ? ordinal(inning) : null,
    baseState: '',
    scoreDisplay: '',
  }

  state.baseState = describeBaseState(state)
  state.scoreDisplay =
    awayScore == null || homeScore == null
      ? 'Score unavailable'
      : `${awayAbbreviation} ${awayScore} - ${homeAbbreviation} ${homeScore}`

  return state
}

// Extract play-by-play context from the already-fetched live feed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePlaysFromFeed(feed: Record<string, any>, state: ParsedGameState): PlayContext {
  const plays = feed?.liveData?.plays ?? {}
  const allPlays: any[] = plays?.allPlays ?? []
  const scoringIdx: number[] = plays?.scoringPlays ?? []

  const recentScoringPlays = scoringIdx
    .slice(-6)
    .map((i) => {
      const p = allPlays[i]
      const desc = p?.result?.description?.trim()
      if (!desc) return null
      const inning = p?.about?.inning
      const half = p?.about?.halfInning === 'top' ? 'Top' : 'Bot'
      const away = p?.result?.awayScore
      const home = p?.result?.homeScore
      const score =
        away != null && home != null
          ? ` [${state.awayAbbreviation} ${away}-${home} ${state.homeAbbreviation}]`
          : ''
      return `${half} ${inning ?? '?'}: ${desc}${score}`
    })
    .filter((s): s is string => Boolean(s))

  const lastWithDesc = [...allPlays].reverse().find((p) => p?.result?.description)
  const lastPlay = lastWithDesc?.result?.description?.trim() ?? null

  const matchup = plays?.currentPlay?.matchup
  const isLive = state.statusCode === 'L'
  return {
    recentScoringPlays,
    lastPlay,
    currentBatter: isLive ? matchup?.batter?.fullName ?? null : null,
    currentPitcher: isLive ? matchup?.pitcher?.fullName ?? null : null,
  }
}

function buildMarket(odds: OddsEntry | null): PredictionMarket | null {
  if (!odds || odds.homeMoneyline == null || odds.awayMoneyline == null) {
    if (!odds) return null
    return {
      provider: odds.provider,
      homeMoneyline: odds.homeMoneyline,
      awayMoneyline: odds.awayMoneyline,
      homeMoneylineDisplay: odds.homeMoneylineDisplay,
      awayMoneylineDisplay: odds.awayMoneylineDisplay,
      homeNoVigProbability: null,
      awayNoVigProbability: null,
      bookHold: null,
    }
  }

  const translation = translateMoneyline(odds.homeMoneyline, odds.awayMoneyline)
  return {
    provider: odds.provider,
    homeMoneyline: odds.homeMoneyline,
    awayMoneyline: odds.awayMoneyline,
    homeMoneylineDisplay: odds.homeMoneylineDisplay,
    awayMoneylineDisplay: odds.awayMoneylineDisplay,
    homeNoVigProbability: translation.homeNoVig,
    awayNoVigProbability: translation.awayNoVig,
    bookHold: translation.bookHold,
  }
}

function decideConfidence(
  state: ParsedGameState,
  fractionComplete: number,
  hasMarket: boolean
): 'Low' | 'Medium' | 'High' {
  if (state.statusCode === 'F') return 'High'
  if (state.statusCode === 'L') {
    if (fractionComplete > 0.66) return 'High'
    if (fractionComplete > 0.33) return 'Medium'
    return hasMarket ? 'Medium' : 'Low'
  }
  // Pregame.
  return hasMarket ? 'Medium' : 'Low'
}

function buildDrivers(
  state: ParsedGameState,
  model: PredictionModel,
  edge: PredictionEdge | null,
  homeForm: TeamForm | null,
  awayForm: TeamForm | null,
  pitchers: MatchupPitchers | null,
  bullpens: MatchupBullpens | null
): string[] {
  const drivers: string[] = []
  const homeScore = state.homeScore ?? 0
  const awayScore = state.awayScore ?? 0
  const lead = homeScore - awayScore
  const favored =
    model.homeWinProbability >= 0.5 ? state.homeAbbreviation : state.awayAbbreviation
  const favoredProb = Math.max(model.homeWinProbability, model.awayWinProbability)

  if (state.statusCode === 'L' && state.inningOrdinal && state.half) {
    if (lead !== 0) {
      const leader = lead > 0 ? state.homeAbbreviation : state.awayAbbreviation
      drivers.push(
        `${leader} lead by ${Math.abs(lead)} in the ${state.half.toLowerCase()} of the ${state.inningOrdinal}.`
      )
    } else {
      drivers.push(`Tied game in the ${state.half.toLowerCase()} of the ${state.inningOrdinal}.`)
    }
    if (state.onFirst || state.onSecond || state.onThird) {
      const battingTeam =
        state.half === 'Top' ? state.awayAbbreviation : state.homeAbbreviation
      drivers.push(`${battingTeam} batting with runners on ${state.baseState.toLowerCase()}.`)
    }
  } else if (state.statusCode === 'P') {
    drivers.push('Game has not started; estimate anchors to the pregame market and home-field edge.')
  }

  if (homeForm && awayForm && homeForm.games > 0 && awayForm.games > 0) {
    const fmt = (f: TeamForm) =>
      `${f.recordLabel} (${f.runDiffAvg >= 0 ? '+' : ''}${f.runDiffAvg.toFixed(1)} run diff/gm)`
    drivers.push(
      `Recent form (last ${Math.max(homeForm.games, awayForm.games)}): ${state.homeAbbreviation} ${fmt(homeForm)}, ${state.awayAbbreviation} ${fmt(awayForm)}.`
    )
  }

  if (pitchers?.home && pitchers?.away) {
    drivers.push(
      `Probable starters: ${state.homeAbbreviation} ${pitchers.home.name} (${pitchers.home.era ?? '–'} ERA), ${state.awayAbbreviation} ${pitchers.away.name} (${pitchers.away.era ?? '–'} ERA).`
    )
  }

  if (bullpens?.home && bullpens?.away) {
    const tired =
      bullpens.home.fatigueScore > bullpens.away.fatigueScore
        ? { side: state.homeAbbreviation, s: bullpens.home }
        : { side: state.awayAbbreviation, s: bullpens.away }
    if (tired.s.backToBackArms > 0 || tired.s.pitchesLast3Days >= 200) {
      drivers.push(
        `${tired.side} bullpen is the more taxed: ${tired.s.pitchesLast3Days} reliever pitches over the last 3 days${tired.s.backToBackArms > 0 ? `, ${tired.s.backToBackArms} arm(s) on back-to-back days` : ''}.`
      )
    }
  }

  drivers.push(`Model favors ${favored} at ${(favoredProb * 100).toFixed(1)}% to win.`)

  if (edge) {
    const homeEdge = edge.homeProbabilityEdge
    if (Math.abs(homeEdge) >= 1) {
      const side = homeEdge > 0 ? state.homeAbbreviation : state.awayAbbreviation
      drivers.push(
        `Model is ${Math.abs(homeEdge).toFixed(1)} pts higher than the market on ${side}.`
      )
    } else {
      drivers.push('Model and market are closely aligned (no meaningful edge).')
    }
  }

  return drivers
}

export function buildPrediction({
  gamePk,
  state,
  odds,
  detailedStatus,
  homeForm = null,
  awayForm = null,
  homeStarter = null,
  awayStarter = null,
  homeBullpen = null,
  awayBullpen = null,
  plays = null,
}: {
  gamePk: number
  state: ParsedGameState
  odds: OddsEntry | null
  detailedStatus: string | null
  homeForm?: TeamForm | null
  awayForm?: TeamForm | null
  homeStarter?: PitcherProfile | null
  awayStarter?: PitcherProfile | null
  homeBullpen?: BullpenStatus | null
  awayBullpen?: BullpenStatus | null
  plays?: PlayContext | null
}): Prediction {
  const market = buildMarket(odds)

  // Resolve the pregame prior, in order of preference:
  //   1. market no-vig probability (sharpest signal when odds exist)
  //   2. trained form model (last-30-game form -> win prob)
  //   3. static home-field baseline
  const marketProb =
    market && market.homeMoneyline != null && market.awayMoneyline != null
      ? translateMoneyline(market.homeMoneyline, market.awayMoneyline).homeNoVig
      : null
  // Trained pregame model: prefer XGBoost, fall back to the logistic baseline.
  const formProb =
    homeForm && awayForm
      ? predictXgbHomeWinProb(homeForm, awayForm) ??
        predictPregameHomeWinProb(homeForm, awayForm)
      : null

  const priorSource: Prediction['priorSource'] =
    marketProb != null ? 'market' : formProb != null ? 'form-model' : 'home-field'

  // Starter + bullpen adjustment to the prior. Skipped when the market prior is
  // used, because betting odds already price in starters and bullpen state
  // (adjusting would double-count). Bounded and explainable.
  let starterEdgePts = 0
  let bullpenEdgePts = 0
  if (homeStarter && awayStarter) {
    // Home starter allowing fewer expected runs => positive (favors home).
    starterEdgePts = clampNum(
      0.025 * (awayStarter.expectedRA9 - homeStarter.expectedRA9),
      -0.08,
      0.08
    )
  }
  if (homeBullpen && awayBullpen) {
    // Away bullpen more fatigued => positive (favors home).
    bullpenEdgePts = clampNum(
      0.0005 * (awayBullpen.fatigueScore - homeBullpen.fatigueScore),
      -0.04,
      0.04
    )
  }
  const adjustmentApplied = priorSource !== 'market'
  const basePrior = marketProb ?? formProb ?? 0.54
  const pregameHomeProb = adjustmentApplied
    ? clampNum(basePrior + starterEdgePts + bullpenEdgePts, 0.05, 0.95)
    : basePrior

  const wp = computeWinProbability(state, pregameHomeProb)

  // Clamp away from 0/1 (decided games) so fair-odds conversion stays defined.
  const clampProb = (p: number) => Math.min(Math.max(p, 0.001), 0.999)
  const fairHome = impliedProbToAmerican(clampProb(wp.homeWinProbability))
  const fairAway = impliedProbToAmerican(clampProb(wp.awayWinProbability))

  const model: PredictionModel = {
    homeWinProbability: wp.homeWinProbability,
    awayWinProbability: wp.awayWinProbability,
    projectedHomeRuns: wp.projectedHomeRuns,
    projectedAwayRuns: wp.projectedAwayRuns,
    projectedTotalRuns: wp.projectedTotalRuns,
    projectedRunDiff: wp.projectedRunDiff,
    fairHomeMoneyline: fairHome,
    fairAwayMoneyline: fairAway,
    fairHomeMoneylineDisplay: formatAmerican(fairHome),
    fairAwayMoneylineDisplay: formatAmerican(fairAway),
  }

  let edge: PredictionEdge | null = null
  if (market?.homeNoVigProbability != null && market.awayNoVigProbability != null) {
    edge = {
      homeProbabilityEdge: round1(
        (wp.homeWinProbability - market.homeNoVigProbability) * 100
      ),
      awayProbabilityEdge: round1(
        (wp.awayWinProbability - market.awayNoVigProbability) * 100
      ),
    }
  }

  const startingPitchers: MatchupPitchers | null =
    homeStarter || awayStarter ? { home: homeStarter, away: awayStarter } : null
  const bullpen: MatchupBullpens | null =
    homeBullpen || awayBullpen ? { home: homeBullpen, away: awayBullpen } : null
  const matchupAdjustment: MatchupAdjustment = {
    starterEdgePts: round1(starterEdgePts * 100),
    bullpenEdgePts: round1(bullpenEdgePts * 100),
    applied: adjustmentApplied && (starterEdgePts !== 0 || bullpenEdgePts !== 0),
  }

  const warnings: string[] = []
  if (!market) {
    warnings.push('No sportsbook odds available; fair odds and edge are model-only.')
  }
  if (state.statusCode === 'P' && !(homeStarter && awayStarter)) {
    warnings.push('Probable starters not yet posted for this game.')
  }
  if (adjustmentApplied && matchupAdjustment.applied) {
    warnings.push(
      'No market odds, so the prior is nudged by starter quality and bullpen rest; treat as a rough estimate.'
    )
  }
  warnings.push('Win probability is an analytic estimate, not betting advice.')

  const toFormSummary = (form: TeamForm | null): TeamFormSummary | null =>
    form && form.games > 0
      ? {
          record: form.recordLabel,
          winPct: round1(form.winPct * 100) / 100,
          runDiffPerGame: round1(form.runDiffAvg),
        }
      : null

  return {
    gamePk,
    homeTeam: state.homeTeam,
    awayTeam: state.awayTeam,
    homeAbbreviation: state.homeAbbreviation,
    awayAbbreviation: state.awayAbbreviation,
    status: detailedStatus,
    statusCode: state.statusCode,
    inning: state.inning,
    inningOrdinal: state.inningOrdinal,
    half: state.half,
    outs: state.outs,
    baseState: state.baseState,
    score: state.scoreDisplay,
    homeScore: state.homeScore,
    awayScore: state.awayScore,
    model,
    market,
    edge,
    homeForm: toFormSummary(homeForm),
    awayForm: toFormSummary(awayForm),
    startingPitchers,
    bullpen,
    matchupAdjustment,
    recentScoringPlays: plays?.recentScoringPlays ?? [],
    lastPlay: plays?.lastPlay ?? null,
    currentBatter: plays?.currentBatter ?? null,
    currentPitcher: plays?.currentPitcher ?? null,
    priorSource,
    confidence: decideConfidence(state, wp.fractionComplete, Boolean(market)),
    drivers: buildDrivers(state, model, edge, homeForm, awayForm, startingPitchers, bullpen),
    warnings,
    modelVersion: MODEL_VERSION,
  }
}

export async function getPredictionForGame(gamePk: number): Promise<Prediction> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feed = (await getGameFeed({ gamePk })) as Record<string, any>
  const state = parseGameStateFromFeed(feed)
  const detailedStatus: string | null = feed?.gameData?.status?.detailedState ?? null
  const gameDate: string | null = feed?.gameData?.datetime?.dateTime ?? null

  const season: number =
    Number(feed?.gameData?.game?.season) || new Date().getFullYear()

  // Prefer scraping DraftKings for this matchup; fall back to The Odds API if
  // DraftKings is unavailable (geo-block, shape change, or no match). Fetch
  // odds, team form, probable starters, and bullpen state concurrently.
  const matchup = { awayTeam: state.awayTeam, homeTeam: state.homeTeam, gameDate }
  const [odds, homeForm, awayForm, starters, homeBullpen, awayBullpen] = await Promise.all([
    getDraftKingsOddsForMatchup(matchup).then((dk) => dk ?? getOddsForMatchup(matchup)),
    state.homeTeamId ? getTeamForm(state.homeTeamId) : Promise.resolve(null),
    state.awayTeamId ? getTeamForm(state.awayTeamId) : Promise.resolve(null),
    getProbableStarters(feed, season),
    state.homeTeamId ? getBullpenStatus(state.homeTeamId) : Promise.resolve(null),
    state.awayTeamId ? getBullpenStatus(state.awayTeamId) : Promise.resolve(null),
  ])

  return buildPrediction({
    gamePk,
    state,
    odds,
    detailedStatus,
    homeForm,
    awayForm,
    homeStarter: starters.home,
    awayStarter: starters.away,
    homeBullpen,
    awayBullpen,
    plays: parsePlaysFromFeed(feed, state),
  })
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// Re-export so callers can compute implied probabilities without importing
// oddsMath directly.
export { americanToImpliedProb }
