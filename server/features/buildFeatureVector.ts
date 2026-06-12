import type { ScoreCard } from '../mlbStatsService.js'
import { translateMoneyline } from '../utils/oddsMath.js'

// The single source of truth for model features. Both the ingestion writer
// (training rows) and live inference call this function, so training/serving
// skew is structurally impossible. The Python training job never recomputes
// features — it only reads rows this function produced.
//
// Adding a feature: add it here, accumulate new snapshots, retrain. The
// artifact's `features` list is validated against FEATURE_NAMES at load time.

export const FEATURE_NAMES = [
  'home_no_vig_prob',
  'home_team_win_pct',
  'away_team_win_pct',
] as const

export interface FeatureVector {
  featureNames: string[]
  values: number[]
  features: Record<string, number>
}

function parseWinPct(record: string | null): number | null {
  if (!record) return null
  const match = record.match(/^(\d+)-(\d+)$/)
  if (!match) return null
  const wins = Number(match[1])
  const losses = Number(match[2])
  const games = wins + losses
  if (games === 0) return 0.5
  return wins / games
}

export function buildFeatureVector(card: ScoreCard): FeatureVector | null {
  if (card.homeMoneyline === null || card.awayMoneyline === null) return null

  const { homeNoVig } = translateMoneyline(card.homeMoneyline, card.awayMoneyline)
  const features: Record<string, number> = {
    home_no_vig_prob: homeNoVig,
    home_team_win_pct: parseWinPct(card.homeRecord) ?? 0.5,
    away_team_win_pct: parseWinPct(card.awayRecord) ?? 0.5,
  }

  const featureNames = [...FEATURE_NAMES]
  return {
    featureNames,
    values: featureNames.map((name) => features[name]),
    features,
  }
}
