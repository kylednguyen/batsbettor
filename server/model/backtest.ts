import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSupabase } from '../db/supabase.js'
import { validateArtifact, type ModelArtifact } from './artifact.js'

// Phase 3 backtest: re-score historical feature snapshots under every available
// model artifact (and reference baselines) and report calibration-style metrics
// per version. Because every prediction is scored from the SAME persisted
// feature rows, versions stay directly comparable — apples to apples on
// identical games (the leakage/skew rules already hold for the stored rows).

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = path.resolve(__dirname, '../../models')

const EPS = 1e-15
const CALIBRATION_BINS = 10
const DEFAULT_LIMIT = 20_000

export interface BacktestMetrics {
  modelVersion: string
  cohort: 'pregame' | 'live'
  n: number
  logLoss: number
  brier: number
  accuracy: number
  // Skill vs the uniform 0.5 baseline (1 - logLoss/ln2). >0 means informative.
  logLossSkill: number
}

export interface CalibrationBin {
  bucket: string // e.g. "0.4-0.5"
  n: number
  meanPredicted: number
  observedFrequency: number
}

export interface BacktestVersionReport extends BacktestMetrics {
  calibration: CalibrationBin[]
}

export interface BacktestReport {
  generatedAt: string
  totalSnapshots: number
  cohorts: {
    pregame: number
    live: number
  }
  versions: BacktestVersionReport[]
}

interface LabeledSnapshot {
  cohort: 'pregame' | 'live'
  homeWin: 0 | 1
  values: Map<string, number>
}

// --- scoring -------------------------------------------------------------

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

// Score one snapshot with an LR artifact. Returns null when the snapshot does
// not carry every feature the artifact needs (so the model is N/A for that row).
function scoreArtifact(model: ModelArtifact, values: Map<string, number>): number | null {
  let z = model.intercept
  for (let i = 0; i < model.features.length; i += 1) {
    const name = model.features[i]
    const raw = values.get(name)
    if (raw === undefined) return null
    const std = model.scaler.std[i] || 1
    z += model.coef[i] * ((raw - model.scaler.mean[i]) / std)
  }
  return sigmoid(z)
}

// --- metrics -------------------------------------------------------------

function clampProb(p: number): number {
  return Math.min(Math.max(p, EPS), 1 - EPS)
}

function singleLogLoss(p: number, y: number): number {
  const c = clampProb(p)
  return -(y * Math.log(c) + (1 - y) * Math.log(1 - c))
}

function computeMetrics(
  modelVersion: string,
  cohort: 'pregame' | 'live',
  scored: { p: number; y: number }[]
): BacktestVersionReport {
  const n = scored.length
  let logLossSum = 0
  let brierSum = 0
  let correct = 0

  const binTotals = new Array(CALIBRATION_BINS).fill(0)
  const binPredSum = new Array(CALIBRATION_BINS).fill(0)
  const binPosSum = new Array(CALIBRATION_BINS).fill(0)

  for (const { p, y } of scored) {
    logLossSum += singleLogLoss(p, y)
    brierSum += (p - y) ** 2
    if ((p >= 0.5 ? 1 : 0) === y) correct += 1

    const bin = Math.min(CALIBRATION_BINS - 1, Math.floor(p * CALIBRATION_BINS))
    binTotals[bin] += 1
    binPredSum[bin] += p
    binPosSum[bin] += y
  }

  const logLoss = n ? logLossSum / n : 0
  const calibration: CalibrationBin[] = []
  for (let b = 0; b < CALIBRATION_BINS; b += 1) {
    if (binTotals[b] === 0) continue
    const lo = (b / CALIBRATION_BINS).toFixed(1)
    const hi = ((b + 1) / CALIBRATION_BINS).toFixed(1)
    calibration.push({
      bucket: `${lo}-${hi}`,
      n: binTotals[b],
      meanPredicted: binPredSum[b] / binTotals[b],
      observedFrequency: binPosSum[b] / binTotals[b],
    })
  }

  return {
    modelVersion,
    cohort,
    n,
    logLoss,
    brier: n ? brierSum / n : 0,
    accuracy: n ? correct / n : 0,
    logLossSkill: n ? 1 - logLoss / Math.LN2 : 0,
    calibration,
  }
}

// --- artifact discovery --------------------------------------------------

// Every JSON in models/ that satisfies the LR artifact contract is a candidate.
// Files in other shapes (XGB export, legacy formats) fail validation and are
// skipped. De-duplicated by model_version so latest/dated twins collapse.
function loadComparableArtifacts(): ModelArtifact[] {
  if (!fs.existsSync(MODELS_DIR)) return []
  const byVersion = new Map<string, ModelArtifact>()
  for (const file of fs.readdirSync(MODELS_DIR)) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, file), 'utf-8'))
      const artifact = validateArtifact(raw)
      if (!byVersion.has(artifact.model_version)) byVersion.set(artifact.model_version, artifact)
    } catch {
      // Not an LR artifact in the current contract — skip.
    }
  }
  return [...byVersion.values()]
}

// --- data load -----------------------------------------------------------

interface SnapshotRow {
  game_pk: number
  is_pregame: boolean
  feature_names: string[]
  feature_values: number[]
}

async function loadLabeledSnapshots(
  cohortFilter: 'pregame' | 'live' | 'all',
  limit: number
): Promise<LabeledSnapshot[]> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing).')

  // Map game_pk -> home_win for every settled game.
  const labels = new Map<number, 0 | 1>()
  {
    const pageSize = 1000
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('games')
        .select('game_pk, home_win')
        .not('home_win', 'is', null)
        .range(from, from + pageSize - 1)
      if (error) throw new Error(`Failed to load game labels: ${error.message}`)
      if (!data || data.length === 0) break
      for (const row of data as { game_pk: number; home_win: boolean }[]) {
        labels.set(row.game_pk, row.home_win ? 1 : 0)
      }
      if (data.length < pageSize) break
    }
  }

  const snapshots: LabeledSnapshot[] = []
  const pageSize = 1000
  for (let from = 0; from < limit; from += pageSize) {
    let query = supabase
      .from('feature_snapshots')
      .select('game_pk, is_pregame, feature_names, feature_values')
      .order('snapshot_id', { ascending: true })
      .range(from, Math.min(from + pageSize, limit) - 1)
    if (cohortFilter === 'pregame') query = query.eq('is_pregame', true)
    if (cohortFilter === 'live') query = query.eq('is_pregame', false)

    const { data, error } = await query
    if (error) throw new Error(`Failed to load feature snapshots: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data as SnapshotRow[]) {
      const homeWin = labels.get(row.game_pk)
      if (homeWin === undefined) continue // unsettled game — no label to score against
      const values = new Map<string, number>()
      row.feature_names.forEach((name, i) => values.set(name, row.feature_values[i]))
      snapshots.push({
        cohort: row.is_pregame ? 'pregame' : 'live',
        homeWin,
        values,
      })
    }
    if (data.length < pageSize) break
  }

  return snapshots
}

// --- public entry --------------------------------------------------------

export async function runBacktest(options?: {
  cohort?: 'pregame' | 'live' | 'all'
  limit?: number
}): Promise<BacktestReport> {
  const cohort = options?.cohort ?? 'all'
  const limit = Math.min(options?.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT)

  const snapshots = await loadLabeledSnapshots(cohort, limit)
  const artifacts = loadComparableArtifacts()

  const pregameCount = snapshots.filter((s) => s.cohort === 'pregame').length
  const liveCount = snapshots.length - pregameCount

  const versions: BacktestVersionReport[] = []

  // Trained artifacts, each scored over the snapshots it has features for.
  for (const artifact of artifacts) {
    for (const c of ['pregame', 'live'] as const) {
      const cohortSnaps = snapshots.filter((s) => s.cohort === c)
      const scored: { p: number; y: number }[] = []
      for (const snap of cohortSnaps) {
        const p = scoreArtifact(artifact, snap.values)
        if (p !== null) scored.push({ p, y: snap.homeWin })
      }
      if (scored.length > 0) versions.push(computeMetrics(artifact.model_version, c, scored))
    }
  }

  // Reference baselines: market no-vig (where snapshots carry it) and uniform.
  for (const c of ['pregame', 'live'] as const) {
    const cohortSnaps = snapshots.filter((s) => s.cohort === c)
    if (cohortSnaps.length === 0) continue

    const marketScored: { p: number; y: number }[] = []
    for (const snap of cohortSnaps) {
      const p = snap.values.get('home_no_vig_prob')
      if (p !== undefined) marketScored.push({ p, y: snap.homeWin })
    }
    if (marketScored.length > 0) versions.push(computeMetrics('baseline-market-novig', c, marketScored))

    versions.push(
      computeMetrics(
        'baseline-uniform-0.5',
        c,
        cohortSnaps.map((s) => ({ p: 0.5, y: s.homeWin }))
      )
    )
  }

  // Best (lowest log loss) first, within each cohort.
  versions.sort((a, b) => (a.cohort === b.cohort ? a.logLoss - b.logLoss : a.cohort.localeCompare(b.cohort)))

  return {
    generatedAt: new Date().toISOString(),
    totalSnapshots: snapshots.length,
    cohorts: { pregame: pregameCount, live: liveCount },
    versions,
  }
}
