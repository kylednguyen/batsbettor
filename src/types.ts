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

export interface ChatMessage {
  role: 'user' | 'assistant'
  tag: string
  title: string
  body: string
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
