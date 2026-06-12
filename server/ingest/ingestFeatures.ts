import { getSupabase } from '../db/supabase.js'
import type { ScoreCard } from '../mlbStatsService.js'
import { buildFeatureVector } from '../features/buildFeatureVector.js'
import { buildLiveFeatureVector, liveStateFromScoreCard } from '../features/buildLiveFeatureVector.js'
import { predictGame } from '../model/predict.js'

// Games that already have their pregame snapshot (checked against the DB on
// first encounter, then cached here). One pregame row per game is the
// training contract: only features that existed before the outcome.
const snapshotWritten = new Set<number>()
const snapshotChecked = new Set<number>()

async function hasExistingSnapshot(gamePk: number): Promise<boolean> {
  const supabase = getSupabase()
  if (!supabase) return true

  const { data, error } = await supabase
    .from('feature_snapshots')
    .select('snapshot_id')
    .eq('game_pk', gamePk)
    .eq('is_pregame', true)
    .limit(1)

  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}

async function writePrediction(card: ScoreCard, snapshotId: number): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return

  const prediction = predictGame(card)
  if (!prediction) return

  const { error } = await supabase.from('predictions').insert({
    game_pk: card.gamePk,
    snapshot_id: snapshotId,
    model_version: prediction.modelVersion,
    home_win_probability: prediction.homeWinProbability,
    away_win_probability: prediction.awayWinProbability,
    fair_home_moneyline: prediction.fairHomeMoneyline,
    fair_away_moneyline: prediction.fairAwayMoneyline,
    home_no_vig_probability: prediction.homeNoVigProbability,
    away_no_vig_probability: prediction.awayNoVigProbability,
    home_probability_edge: prediction.homeProbabilityEdge,
  })
  if (error) console.error('prediction insert failed:', error.message)
}

// Last written live state per game, so we only persist a snapshot when the
// game state actually changes (new baserunner, out, run, inning).
const lastLiveStateHashByGamePk = new Map<number, string>()

async function ingestLiveSnapshot(card: ScoreCard): Promise<void> {
  const supabase = getSupabase()
  if (!supabase || card.gamePk === null) return

  const state = liveStateFromScoreCard(card)
  if (!state) return

  const hash = JSON.stringify(state)
  if (lastLiveStateHashByGamePk.get(card.gamePk) === hash) return

  const vector = buildLiveFeatureVector(state)
  const { error } = await supabase.from('feature_snapshots').insert({
    game_pk: card.gamePk,
    is_pregame: false,
    feature_names: vector.featureNames,
    feature_values: vector.values,
    features: vector.features,
  })
  if (error) {
    console.error(`live snapshot insert failed for ${card.gamePk}:`, error.message)
    return
  }
  lastLiveStateHashByGamePk.set(card.gamePk, hash)
}

export async function ingestFeatures(cards: ScoreCard[]): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return

  for (const card of cards) {
    if (card.statusCode === 'L') {
      await ingestLiveSnapshot(card)
      continue
    }
    // Pregame only: once the game is live the outcome is leaking into state.
    if (card.gamePk === null || card.statusCode !== 'P') continue
    if (snapshotWritten.has(card.gamePk)) continue

    const vector = buildFeatureVector(card)
    if (!vector) continue // waiting on odds

    try {
      if (!snapshotChecked.has(card.gamePk)) {
        snapshotChecked.add(card.gamePk)
        if (await hasExistingSnapshot(card.gamePk)) {
          snapshotWritten.add(card.gamePk)
          continue
        }
      }

      const { data, error } = await supabase
        .from('feature_snapshots')
        .insert({
          game_pk: card.gamePk,
          is_pregame: true,
          feature_names: vector.featureNames,
          feature_values: vector.values,
          features: vector.features,
        })
        .select('snapshot_id')
        .single()

      if (error) throw new Error(error.message)
      snapshotWritten.add(card.gamePk)

      await writePrediction(card, data.snapshot_id as number)
    } catch (error) {
      console.error(`ingestFeatures failed for ${card.gamePk}:`, (error as Error).message)
      snapshotChecked.delete(card.gamePk)
    }
  }
}
