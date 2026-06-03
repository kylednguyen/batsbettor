// XGBoost pregame model inference, in TypeScript.
//
// The model is trained in Python (ml/train_xgb.py) and exported as a flattened
// tree ensemble (models/pregame_win_prob_xgb.json). This module walks those
// trees to reproduce the booster's predictions exactly, so the Node server runs
// inference in-process with no Python service to host — keeping the runtime free
// and dependency-light. Parity with the Python model is checked against the
// `paritySamples` embedded in the export.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { TeamForm } from './teamForm.js'
import { buildPregameFeatures } from './pregameModel.js'

interface LeafNode {
  leaf: number
}
interface SplitNode {
  f: number
  cond: number
  yes: number
  no: number
  missing: number
}
type TreeNode = LeafNode | SplitNode
type Tree = Record<string, TreeNode>

export interface XgbModel {
  modelType: 'xgboost'
  featureNames: string[]
  baseScore: number
  nTrees: number
  trees: Tree[]
  metrics?: Record<string, number>
  importanceGain?: Record<string, number>
  paritySamples?: Array<{ features: number[]; prob: number; dumpProb: number }>
}

const MODEL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'models',
  'pregame_win_prob_xgb.json'
)

let cachedModel: XgbModel | null | undefined

function loadModel(): XgbModel | null {
  if (cachedModel !== undefined) return cachedModel
  try {
    cachedModel = JSON.parse(readFileSync(MODEL_PATH, 'utf8')) as XgbModel
  } catch (_error) {
    cachedModel = null
  }
  return cachedModel
}

export function hasXgbModel(): boolean {
  return loadModel() !== null
}

export function getXgbModelInfo(): XgbModel | null {
  return loadModel()
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

// Walk one tree to its leaf. XGBoost routes value < split_condition to `yes`,
// otherwise `no`; missing values follow the `missing` pointer.
function evalTree(tree: Tree, features: number[]): number {
  let nodeId = 0
  // Guard against malformed trees with a depth cap.
  for (let depth = 0; depth < 64; depth += 1) {
    const node = tree[String(nodeId)]
    if (!node) return 0
    if ('leaf' in node) return node.leaf
    const value = features[node.f]
    if (Number.isNaN(value)) nodeId = node.missing
    else nodeId = value < node.cond ? node.yes : node.no
  }
  return 0
}

// Raw model output for a feature vector: sigmoid(baseMargin + sum of leaves).
export function predictXgbProb(features: number[]): number | null {
  const model = loadModel()
  if (!model) return null
  if (features.length !== model.featureNames.length) return null

  const baseMargin = Math.log(model.baseScore / (1 - model.baseScore))
  let margin = baseMargin
  for (const tree of model.trees) margin += evalTree(tree, features)
  return sigmoid(margin)
}

export function predictXgbHomeWinProb(
  homeForm: TeamForm,
  awayForm: TeamForm
): number | null {
  const p = predictXgbProb(buildPregameFeatures(homeForm, awayForm))
  if (p == null) return null
  return Math.min(Math.max(p, 0.02), 0.98)
}
