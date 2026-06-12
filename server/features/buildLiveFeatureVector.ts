import type { ScoreCard } from '../mlbStatsService.js'

// Single source of truth for LIVE-STATE model features, mirroring
// buildFeatureVector.ts for the pregame model. Both live ingestion
// (in-game snapshots) and the historical backfill script
// (scripts/backfill-live-training.ts) call this, so rows trained on past
// results and rows scored live are built by the same code.
//
// No market odds in here on purpose: historical play-by-play feeds carry no
// odds, and the live model must be trainable purely from past game results.

export const LIVE_FEATURE_NAMES = [
  'inning',
  'is_top_inning',
  'outs',
  'run_diff',
  'total_runs',
  'on_first',
  'on_second',
  'on_third',
  'home_team_win_pct',
  'away_team_win_pct',
] as const

export interface LiveGameState {
  inning: number
  isTopInning: boolean
  outs: number
  homeScore: number
  awayScore: number
  onFirst: boolean
  onSecond: boolean
  onThird: boolean
  homeWinPct: number
  awayWinPct: number
}

export interface LiveFeatureVector {
  featureNames: string[]
  values: number[]
  features: Record<string, number>
}

export function parseWinPct(record: string | null): number | null {
  if (!record) return null
  const match = record.match(/^(\d+)-(\d+)$/)
  if (!match) return null
  const wins = Number(match[1])
  const losses = Number(match[2])
  const games = wins + losses
  if (games === 0) return 0.5
  return wins / games
}

export function buildLiveFeatureVector(state: LiveGameState): LiveFeatureVector {
  const features: Record<string, number> = {
    inning: state.inning,
    is_top_inning: state.isTopInning ? 1 : 0,
    outs: state.outs,
    run_diff: state.homeScore - state.awayScore,
    total_runs: state.homeScore + state.awayScore,
    on_first: state.onFirst ? 1 : 0,
    on_second: state.onSecond ? 1 : 0,
    on_third: state.onThird ? 1 : 0,
    home_team_win_pct: state.homeWinPct,
    away_team_win_pct: state.awayWinPct,
  }

  const featureNames = [...LIVE_FEATURE_NAMES]
  return {
    featureNames,
    values: featureNames.map((name) => features[name]),
    features,
  }
}

// Adapt a live ScoreCard (the shape the scoreboard tick produces) into a
// LiveGameState. Returns null when the card lacks live state.
export function liveStateFromScoreCard(card: ScoreCard): LiveGameState | null {
  if (card.statusCode !== 'L') return null
  if (card.homeScore === null || card.awayScore === null) return null

  const inningMatch = card.inning?.match(/^(\d+)/) ?? null
  if (!inningMatch) return null

  const baseState = card.baseState ?? ''

  return {
    inning: Number(inningMatch[1]),
    isTopInning: (card.inningState ?? '').toLowerCase().startsWith('top'),
    outs: card.outs ?? 0,
    homeScore: card.homeScore,
    awayScore: card.awayScore,
    onFirst: baseState.includes('1st'),
    onSecond: baseState.includes('2nd'),
    onThird: baseState.includes('3rd'),
    homeWinPct: parseWinPct(card.homeRecord) ?? 0.5,
    awayWinPct: parseWinPct(card.awayRecord) ?? 0.5,
  }
}
