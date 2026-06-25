// Shared domain types for mlbpredict

export type StatusCode = 'L' | 'F' | 'P' | string

export interface ScoreCard {
  gamePk: number
  gameDate: string | null
  matchup: string
  awayTeam: string | null
  homeTeam: string | null
  awayAbbreviation: string | null
  homeAbbreviation: string | null
  awayRecord: string | null
  homeRecord: string | null
  status: string | null
  statusCode: StatusCode | null
  score: string
  awayScore: number | null
  homeScore: number | null
  inning: string | null
  inningState: string | null
  outs: number | null
  count: string | null
  baseState: string | null
  oddsProvider: string | null
  homeMoneyline: number | null
  awayMoneyline: number | null
  homeMoneylineDisplay: string | null
  awayMoneylineDisplay: string | null
  oddsLastUpdate: string | null
  feedError?: string
}

export interface ScoreBox {
  gamePk: number | null
  matchup: string | null
  status: string | null
  score: string | null
  baseState: string | null
  count: string | null
  outs: number | null
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
  homeProbabilityEdge: number
  awayProbabilityEdge: number
}

export interface TeamFormSummary {
  record: string
  winPct: number
  runDiffPerGame: number
}

export interface PitcherProfile {
  id: number
  name: string
  era: number | null
  whip: number | null
  fip: number | null
  k9: number | null
  bb9: number | null
  inningsPitched: number
  gamesStarted: number
  expectedRA9: number
}

export interface BullpenStatus {
  pitchesLast3Days: number
  relieversUsedLast3Days: number
  backToBackArms: number
  gamesConsidered: number
  fatigueScore: number
}

export interface MatchupPitchers {
  home: PitcherProfile | null
  away: PitcherProfile | null
}

export interface MatchupBullpens {
  home: BullpenStatus | null
  away: BullpenStatus | null
}

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
  half: 'Top' | 'Bottom' | null
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
  confidencePct: number | null
  drivers: string[]
  warnings: string[]
  modelVersion: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  body: string
  tag?: string
  title?: string
}

export interface SidebarChat {
  id: string
  title: string
  preview: string
  timestamp: string
  pinned?: boolean
}

export interface LiveGame {
  matchup: string
  status: string
  score: string
}

export interface StatEntry {
  label: string
  value: string | number
}

export interface PitchEvent {
  id: string
  number: number | null
  result: string | null
  pitchType: string | null
  velocity: number | null
  x?: number
  z?: number
}

export interface PitchLocation {
  x: number
  z: number
  pitchType: string | null
  velocity: number | null
}

// Raw MLB Stats API shapes (partial — only what we access)
export interface MlbPerson {
  id?: number
  fullName?: string
}

export interface MlbTeamRecord {
  wins?: number
  losses?: number
}

export interface MlbTeam {
  id?: number
  name?: string
  abbreviation?: string
  record?: MlbTeamRecord
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MlbFeedPayload = Record<string, any>
