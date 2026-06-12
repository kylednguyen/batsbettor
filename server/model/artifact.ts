// A trained model is just data. This is the contract between the Python
// training job (ml/train_win_prob.py) and Node inference (predict.ts).

export interface ModelArtifact {
  model_version: string
  features: string[]
  scaler: {
    mean: number[]
    std: number[]
  }
  coef: number[]
  intercept: number
  trained_at: string
  n_games: number
  val_logloss: number | null
}

export function validateArtifact(raw: unknown): ModelArtifact {
  const artifact = raw as ModelArtifact
  if (!artifact || typeof artifact !== 'object') throw new Error('Model artifact is not an object')
  if (typeof artifact.model_version !== 'string') throw new Error('Model artifact missing model_version')
  if (!Array.isArray(artifact.features)) throw new Error('Model artifact missing features list')
  if (!Array.isArray(artifact.coef) || artifact.coef.length !== artifact.features.length) {
    throw new Error('Model artifact coef length does not match features')
  }
  if (
    !artifact.scaler ||
    artifact.scaler.mean?.length !== artifact.features.length ||
    artifact.scaler.std?.length !== artifact.features.length
  ) {
    throw new Error('Model artifact scaler shape does not match features')
  }
  if (typeof artifact.intercept !== 'number') throw new Error('Model artifact missing intercept')
  return artifact
}
