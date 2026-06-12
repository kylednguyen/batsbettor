import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScoreCard } from '../mlbStatsService.js'
import { buildFeatureVector, FEATURE_NAMES, type FeatureVector } from '../features/buildFeatureVector.js'
import { impliedProbToAmerican, translateMoneyline } from '../utils/oddsMath.js'
import { validateArtifact, type ModelArtifact } from './artifact.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARTIFACT_PATH = path.resolve(__dirname, '../../models/win_prob_latest.json')
const ARTIFACT_REFRESH_MS = 5 * 60_000

const DEVIG_MODEL_VERSION = 'devig-v0'

export interface Prediction {
  modelVersion: string
  homeWinProbability: number
  awayWinProbability: number
  fairHomeMoneyline: number
  fairAwayMoneyline: number
  homeNoVigProbability: number
  awayNoVigProbability: number
  homeProbabilityEdge: number
}

let artifact: ModelArtifact | null = null
let lastLoadedAt = 0

function loadArtifact(): ModelArtifact | null {
  if (Date.now() - lastLoadedAt < ARTIFACT_REFRESH_MS) return artifact
  lastLoadedAt = Date.now()

  if (!fs.existsSync(ARTIFACT_PATH)) {
    artifact = null
    return null
  }

  const raw = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf-8'))
  const next = validateArtifact(raw)

  // Skew tripwire: the artifact must use exactly the features the live
  // builder produces, in the same order. Fail loudly, never score silently.
  const expected = [...FEATURE_NAMES]
  if (
    next.features.length !== expected.length ||
    next.features.some((name, i) => name !== expected[i])
  ) {
    throw new Error(
      `Model artifact features [${next.features.join(', ')}] do not match ` +
        `the live feature builder [${expected.join(', ')}]. Retrain before serving.`
    )
  }

  if (artifact?.model_version !== next.model_version) {
    console.log(`Loaded model artifact ${next.model_version} (val_logloss=${next.val_logloss})`)
  }
  artifact = next
  return artifact
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function scoreWithArtifact(model: ModelArtifact, vector: FeatureVector): number {
  let z = model.intercept
  for (let i = 0; i < vector.values.length; i += 1) {
    const std = model.scaler.std[i] || 1
    const scaled = (vector.values[i] - model.scaler.mean[i]) / std
    z += model.coef[i] * scaled
  }
  return sigmoid(z)
}

export function getActiveModelVersion(): string {
  try {
    return loadArtifact()?.model_version ?? DEVIG_MODEL_VERSION
  } catch (_error) {
    return DEVIG_MODEL_VERSION
  }
}

export function predictGame(card: ScoreCard): Prediction | null {
  if (card.homeMoneyline === null || card.awayMoneyline === null) return null

  const { homeNoVig, awayNoVig } = translateMoneyline(card.homeMoneyline, card.awayMoneyline)
  const vector = buildFeatureVector(card)

  let modelVersion = DEVIG_MODEL_VERSION
  let homeWinProbability = homeNoVig

  if (vector) {
    const model = loadArtifact()
    if (model) {
      modelVersion = model.model_version
      homeWinProbability = scoreWithArtifact(model, vector)
    }
  }

  // Clamp away from 0/1 so fair-odds conversion stays defined.
  homeWinProbability = Math.min(Math.max(homeWinProbability, 0.001), 0.999)
  const awayWinProbability = 1 - homeWinProbability

  return {
    modelVersion,
    homeWinProbability,
    awayWinProbability,
    fairHomeMoneyline: impliedProbToAmerican(homeWinProbability),
    fairAwayMoneyline: impliedProbToAmerican(awayWinProbability),
    homeNoVigProbability: homeNoVig,
    awayNoVigProbability: awayNoVig,
    homeProbabilityEdge: homeWinProbability - homeNoVig,
  }
}
