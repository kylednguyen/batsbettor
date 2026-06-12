import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScoreCard } from '../mlbStatsService.js'
import { buildFeatureVector, FEATURE_NAMES } from '../features/buildFeatureVector.js'
import { buildLiveFeatureVector, liveStateFromScoreCard, LIVE_FEATURE_NAMES } from '../features/buildLiveFeatureVector.js'
import { impliedProbToAmerican, translateMoneyline } from '../utils/oddsMath.js'
import { validateArtifact, type ModelArtifact } from './artifact.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = path.resolve(__dirname, '../../models')
const ARTIFACT_REFRESH_MS = 5 * 60_000

const DEVIG_MODEL_VERSION = 'devig-v0'

export interface Prediction {
  modelVersion: string
  homeWinProbability: number
  awayWinProbability: number
  fairHomeMoneyline: number
  fairAwayMoneyline: number
  homeNoVigProbability: number | null
  awayNoVigProbability: number | null
  homeProbabilityEdge: number | null
}

interface ArtifactLoader {
  load(): ModelArtifact | null
}

// Loads an artifact JSON and validates its feature list against the live
// feature builder — the skew tripwire. Fail loudly, never score silently.
function createArtifactLoader(fileName: string, expectedFeatures: readonly string[]): ArtifactLoader {
  const artifactPath = path.join(MODELS_DIR, fileName)
  let artifact: ModelArtifact | null = null
  let lastLoadedAt = 0

  return {
    load(): ModelArtifact | null {
      if (Date.now() - lastLoadedAt < ARTIFACT_REFRESH_MS) return artifact
      lastLoadedAt = Date.now()

      if (!fs.existsSync(artifactPath)) {
        artifact = null
        return null
      }

      const raw = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'))
      const next = validateArtifact(raw)

      if (
        next.features.length !== expectedFeatures.length ||
        next.features.some((name, i) => name !== expectedFeatures[i])
      ) {
        throw new Error(
          `Model artifact ${fileName} features [${next.features.join(', ')}] do not match ` +
            `the live feature builder [${expectedFeatures.join(', ')}]. Retrain before serving.`
        )
      }

      if (artifact?.model_version !== next.model_version) {
        console.log(`Loaded model artifact ${next.model_version} (val_logloss=${next.val_logloss})`)
      }
      artifact = next
      return artifact
    },
  }
}

const pregameLoader = createArtifactLoader('win_prob_latest.json', FEATURE_NAMES)
const liveLoader = createArtifactLoader('win_prob_live_latest.json', LIVE_FEATURE_NAMES)

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function scoreWithArtifact(model: ModelArtifact, values: number[]): number {
  let z = model.intercept
  for (let i = 0; i < values.length; i += 1) {
    const std = model.scaler.std[i] || 1
    const scaled = (values[i] - model.scaler.mean[i]) / std
    z += model.coef[i] * scaled
  }
  return sigmoid(z)
}

export function getActiveModelVersion(): { pregame: string; live: string | null } {
  let pregame = DEVIG_MODEL_VERSION
  let live: string | null = null
  try {
    pregame = pregameLoader.load()?.model_version ?? DEVIG_MODEL_VERSION
  } catch (_error) {
    /* fall through to devig */
  }
  try {
    live = liveLoader.load()?.model_version ?? null
  } catch (_error) {
    live = null
  }
  return { pregame, live }
}

function buildPrediction(modelVersion: string, homeWinProbabilityRaw: number, card: ScoreCard): Prediction {
  // Clamp away from 0/1 so fair-odds conversion stays defined.
  const homeWinProbability = Math.min(Math.max(homeWinProbabilityRaw, 0.001), 0.999)
  const awayWinProbability = 1 - homeWinProbability

  let homeNoVig: number | null = null
  let awayNoVig: number | null = null
  if (card.homeMoneyline !== null && card.awayMoneyline !== null) {
    const translated = translateMoneyline(card.homeMoneyline, card.awayMoneyline)
    homeNoVig = translated.homeNoVig
    awayNoVig = translated.awayNoVig
  }

  return {
    modelVersion,
    homeWinProbability,
    awayWinProbability,
    fairHomeMoneyline: impliedProbToAmerican(homeWinProbability),
    fairAwayMoneyline: impliedProbToAmerican(awayWinProbability),
    homeNoVigProbability: homeNoVig,
    awayNoVigProbability: awayNoVig,
    homeProbabilityEdge: homeNoVig !== null ? homeWinProbability - homeNoVig : null,
  }
}

// Live games use the live-state model trained on past results (reconstructed
// per-at-bat states). Pregame games use the pregame model, falling back to
// the de-vig market probability before the first training run.
export function predictGame(card: ScoreCard): Prediction | null {
  if (card.statusCode === 'L') {
    const state = liveStateFromScoreCard(card)
    if (state) {
      const model = liveLoader.load()
      if (model) {
        const vector = buildLiveFeatureVector(state)
        return buildPrediction(model.model_version, scoreWithArtifact(model, vector.values), card)
      }
    }
    // No live model yet: fall through to the pregame/market path below.
  }

  if (card.homeMoneyline === null || card.awayMoneyline === null) return null

  const { homeNoVig } = translateMoneyline(card.homeMoneyline, card.awayMoneyline)
  const vector = buildFeatureVector(card)

  let modelVersion = DEVIG_MODEL_VERSION
  let probability = homeNoVig

  if (vector) {
    const model = pregameLoader.load()
    if (model) {
      modelVersion = model.model_version
      probability = scoreWithArtifact(model, vector.values)
    }
  }

  return buildPrediction(modelVersion, probability, card)
}
