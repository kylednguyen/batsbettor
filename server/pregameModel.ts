// Pregame win-probability model.
//
// Loads coefficients produced by the offline training pipeline
// (scripts/train_win_prob.ts) and turns two teams' recent-form snapshots into a
// home win probability. This is the "tuned" model: a logistic regression fit on
// historical games using last-30-game form, replacing the static home-field
// constant in the analytic prior. If no trained model file is present, callers
// fall back to the home-field baseline.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { TeamForm } from './teamForm.js'

export interface PregameModel {
  featureNames: string[]
  intercept: number
  coef: number[]
  mean: number[]
  std: number[]
  trainedAt?: string
  metrics?: Record<string, number>
  trainingGames?: number
}

// Feature vector — MUST stay in sync with the training pipeline (TS export +
// ml/train_xgb.py). Order matters: index i maps to "f{i}" in the XGBoost dump.
export const PREGAME_FEATURE_NAMES = [
  'homeWinPct',
  'homeRunDiffAvg',
  'homeWinPct10',
  'homeRunDiffAvg10',
  'awayWinPct',
  'awayRunDiffAvg',
  'awayWinPct10',
  'awayRunDiffAvg10',
]

export function buildPregameFeatures(homeForm: TeamForm, awayForm: TeamForm): number[] {
  return [
    homeForm.winPct,
    homeForm.runDiffAvg,
    homeForm.winPct10,
    homeForm.runDiffAvg10,
    awayForm.winPct,
    awayForm.runDiffAvg,
    awayForm.winPct10,
    awayForm.runDiffAvg10,
  ]
}

const MODEL_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'models', 'pregame_win_prob.json')

let cachedModel: PregameModel | null | undefined

function loadModel(): PregameModel | null {
  if (cachedModel !== undefined) return cachedModel
  try {
    const raw = readFileSync(MODEL_PATH, 'utf8')
    cachedModel = JSON.parse(raw) as PregameModel
  } catch (_error) {
    cachedModel = null
  }
  return cachedModel
}

export function hasPregameModel(): boolean {
  return loadModel() !== null
}

export function getPregameModelInfo(): PregameModel | null {
  return loadModel()
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

// Predict the home win probability from both teams' recent form, or null if no
// trained model is available.
export function predictPregameHomeWinProb(
  homeForm: TeamForm,
  awayForm: TeamForm
): number | null {
  const model = loadModel()
  if (!model) return null

  const features = buildPregameFeatures(homeForm, awayForm)
  // Guard against a stale model file trained on a different feature set.
  if (model.coef.length !== features.length) return null
  let z = model.intercept
  for (let i = 0; i < features.length; i += 1) {
    const std = model.std[i] || 1
    const standardized = (features[i] - model.mean[i]) / std
    z += model.coef[i] * standardized
  }
  const p = sigmoid(z)
  return Math.min(Math.max(p, 0.02), 0.98)
}
