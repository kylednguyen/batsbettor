// Offline training pipeline for the pregame win-probability model.
//
// Pulls historical MLB schedules (final scores) from MLB StatsAPI, reconstructs
// each team's rolling last-30-game form at the moment of every game (no
// leakage), builds training rows, fits a logistic regression by gradient
// descent, evaluates it on a time-based holdout, and writes the tuned
// coefficients to models/pregame_win_prob.json for the server to load.
//
// Usage:
//   npm run train:winprob -- 2023-04-01 2024-10-01
//   (defaults to roughly the last two completed seasons)
//
// Data source: MLB StatsAPI. Baseball Reference is a viable alternative source
// for the same recent-form inputs, but StatsAPI is used here because it returns
// final scores in bulk without scraping or rate-limit walls.

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getScheduleRange } from '../server/mlbStatsService.js'
import { summarizeForm, type TeamGameResult, type TeamForm } from '../server/teamForm.js'
import { buildPregameFeatures, PREGAME_FEATURE_NAMES } from '../server/pregameModel.js'

const MIN_PRIOR_GAMES = 15 // require enough history before using a team's form

interface HistGame {
  date: string
  homeId: number
  awayId: number
  homeScore: number
  awayScore: number
  homeWin: number
}

interface TrainingRow {
  date: string
  features: number[]
  label: number
}

function monthRanges(startDate: string, endDate: string): Array<{ start: string; end: string }> {
  const ranges: Array<{ start: string; end: string }> = []
  const [sy, sm] = startDate.split('-').map(Number)
  const cursor = new Date(Date.UTC(sy, sm - 1, 1))
  const end = new Date(`${endDate}T00:00:00Z`)
  while (cursor <= end) {
    const y = cursor.getUTCFullYear()
    const m = cursor.getUTCMonth()
    const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
    const last = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
    ranges.push({
      start: start < startDate ? startDate : start,
      end: last > endDate ? endDate : last,
    })
    cursor.setUTCMonth(m + 1)
  }
  return ranges
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectGames(schedule: any): HistGame[] {
  const games: HistGame[] = []
  for (const dateEntry of schedule?.dates ?? []) {
    for (const game of dateEntry?.games ?? []) {
      const code = game?.status?.abstractGameCode ?? game?.status?.codedGameState
      if (code !== 'F') continue
      const home = game?.teams?.home
      const away = game?.teams?.away
      const homeId = home?.team?.id
      const awayId = away?.team?.id
      if (!homeId || !awayId) continue
      if (typeof home?.score !== 'number' || typeof away?.score !== 'number') continue
      if (home.score === away.score) continue // skip ties (rare/suspended)
      games.push({
        date: String(game?.gameDate ?? dateEntry?.date ?? '').slice(0, 10),
        homeId,
        awayId,
        homeScore: home.score,
        awayScore: away.score,
        homeWin: home.score > away.score ? 1 : 0,
      })
    }
  }
  return games
}

async function fetchHistory(startDate: string, endDate: string): Promise<HistGame[]> {
  const all: HistGame[] = []
  for (const range of monthRanges(startDate, endDate)) {
    process.stdout.write(`  fetching ${range.start} .. ${range.end} ... `)
    try {
      const schedule = await getScheduleRange({ startDate: range.start, endDate: range.end })
      const games = collectGames(schedule)
      all.push(...games)
      console.log(`${games.length} games`)
    } catch (error) {
      console.log(`failed (${(error as Error).message})`)
    }
  }
  all.sort((a, b) => a.date.localeCompare(b.date))
  return all
}

// Walk games chronologically, emitting a training row from each team's prior
// form, then updating both teams' rolling histories with the result.
function buildTrainingRows(games: HistGame[]): TrainingRow[] {
  const history = new Map<number, TeamGameResult[]>()
  const rows: TrainingRow[] = []

  const formOf = (teamId: number): TeamForm => summarizeForm(history.get(teamId) ?? [])
  const record = (teamId: number, result: TeamGameResult) => {
    const list = history.get(teamId) ?? []
    list.push(result)
    history.set(teamId, list.slice(-30))
  }

  for (const game of games) {
    const homePrior = history.get(game.homeId)?.length ?? 0
    const awayPrior = history.get(game.awayId)?.length ?? 0

    if (homePrior >= MIN_PRIOR_GAMES && awayPrior >= MIN_PRIOR_GAMES) {
      rows.push({
        date: game.date,
        features: buildPregameFeatures(formOf(game.homeId), formOf(game.awayId)),
        label: game.homeWin,
      })
    }

    record(game.homeId, {
      date: game.date,
      runsFor: game.homeScore,
      runsAgainst: game.awayScore,
      win: game.homeWin === 1,
    })
    record(game.awayId, {
      date: game.date,
      runsFor: game.awayScore,
      runsAgainst: game.homeScore,
      win: game.homeWin === 0,
    })
  }

  return rows
}

function standardize(rows: TrainingRow[], dim: number) {
  const mean = new Array(dim).fill(0)
  const std = new Array(dim).fill(0)
  for (const row of rows) for (let i = 0; i < dim; i += 1) mean[i] += row.features[i]
  for (let i = 0; i < dim; i += 1) mean[i] /= rows.length
  for (const row of rows) for (let i = 0; i < dim; i += 1) std[i] += (row.features[i] - mean[i]) ** 2
  for (let i = 0; i < dim; i += 1) std[i] = Math.sqrt(std[i] / rows.length) || 1
  return { mean, std }
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

function trainLogistic(
  X: number[][],
  y: number[],
  { iters = 4000, lr = 0.3, l2 = 1e-4 } = {}
): { intercept: number; coef: number[] } {
  const n = X.length
  const d = X[0].length
  const w = new Array(d).fill(0)
  let b = 0

  for (let iter = 0; iter < iters; iter += 1) {
    const dw = new Array(d).fill(0)
    let db = 0
    for (let i = 0; i < n; i += 1) {
      let z = b
      for (let j = 0; j < d; j += 1) z += w[j] * X[i][j]
      const err = sigmoid(z) - y[i]
      db += err
      for (let j = 0; j < d; j += 1) dw[j] += err * X[i][j]
    }
    b -= lr * (db / n)
    for (let j = 0; j < d; j += 1) w[j] -= lr * (dw[j] / n + l2 * w[j])
  }
  return { intercept: b, coef: w }
}

function logLoss(yTrue: number[], yProb: number[]): number {
  const eps = 1e-15
  let sum = 0
  for (let i = 0; i < yTrue.length; i += 1) {
    const p = Math.min(Math.max(yProb[i], eps), 1 - eps)
    sum += yTrue[i] * Math.log(p) + (1 - yTrue[i]) * Math.log(1 - p)
  }
  return -sum / yTrue.length
}

function brier(yTrue: number[], yProb: number[]): number {
  let sum = 0
  for (let i = 0; i < yTrue.length; i += 1) sum += (yProb[i] - yTrue[i]) ** 2
  return sum / yTrue.length
}

function accuracy(yTrue: number[], yProb: number[]): number {
  let correct = 0
  for (let i = 0; i < yTrue.length; i += 1) if ((yProb[i] >= 0.5 ? 1 : 0) === yTrue[i]) correct += 1
  return correct / yTrue.length
}

function rocAuc(yTrue: number[], yProb: number[]): number {
  const pairs = yProb.map((p, i) => ({ p, y: yTrue[i] }))
  pairs.sort((a, b) => a.p - b.p)
  let rankSum = 0
  for (let i = 0; i < pairs.length; i += 1) if (pairs[i].y === 1) rankSum += i + 1
  const pos = yTrue.reduce((a, b) => a + b, 0)
  const neg = yTrue.length - pos
  if (pos === 0 || neg === 0) return 0.5
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg)
}

function round(n: number, places = 4): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}

async function main() {
  const [, , startArg, endArg] = process.argv
  const startDate = startArg || '2023-04-01'
  const endDate = endArg || '2024-10-01'

  console.log(`\nTraining pregame win-probability model on ${startDate} .. ${endDate}`)
  console.log('Source: MLB StatsAPI\n')

  console.log('1) Fetching historical schedules')
  const games = await fetchHistory(startDate, endDate)
  console.log(`   total completed games: ${games.length}`)
  if (games.length < 500) {
    console.error('Not enough games to train a useful model. Widen the date range.')
    process.exit(1)
  }

  console.log('2) Building rolling last-30-game form features')
  const rows = buildTrainingRows(games)
  console.log(`   training rows (both teams had >= ${MIN_PRIOR_GAMES} prior games): ${rows.length}`)

  // Export a CSV so the Python XGBoost pipeline can train on the same rows.
  const csvPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'data',
    'processed',
    'pregame_training.csv'
  )
  mkdirSync(dirname(csvPath), { recursive: true })
  const header = ['date', ...PREGAME_FEATURE_NAMES, 'label'].join(',')
  const csvLines = rows.map((r) => [r.date, ...r.features.map((v) => v.toFixed(6)), r.label].join(','))
  writeFileSync(csvPath, [header, ...csvLines].join('\n'))
  console.log(`   wrote training CSV -> ${csvPath}`)

  // Time-based split: earliest 80% train, latest 20% test (no future leakage).
  rows.sort((a, b) => a.date.localeCompare(b.date))
  const splitIdx = Math.floor(rows.length * 0.8)
  const trainRows = rows.slice(0, splitIdx)
  const testRows = rows.slice(splitIdx)
  const dim = PREGAME_FEATURE_NAMES.length

  console.log('3) Standardizing features (fit on train split)')
  const { mean, std } = standardize(trainRows, dim)
  const toMatrix = (rs: TrainingRow[]) =>
    rs.map((r) => r.features.map((v, i) => (v - mean[i]) / std[i]))

  console.log('4) Fitting logistic regression')
  const Xtrain = toMatrix(trainRows)
  const yTrain = trainRows.map((r) => r.label)
  const { intercept, coef } = trainLogistic(Xtrain, yTrain)

  console.log('5) Evaluating on time-based holdout')
  const Xtest = toMatrix(testRows)
  const yTest = testRows.map((r) => r.label)
  const probs = Xtest.map((x) => {
    let z = intercept
    for (let j = 0; j < dim; j += 1) z += coef[j] * x[j]
    return sigmoid(z)
  })

  // Baseline: predict the league-wide home-win rate for every game.
  const baseRate = yTrain.reduce((a, b) => a + b, 0) / yTrain.length
  const baseProbs = yTest.map(() => baseRate)

  const metrics = {
    logLoss: round(logLoss(yTest, probs)),
    brier: round(brier(yTest, probs)),
    accuracy: round(accuracy(yTest, probs)),
    rocAuc: round(rocAuc(yTest, probs)),
    baselineLogLoss: round(logLoss(yTest, baseProbs)),
    baselineAccuracy: round(accuracy(yTest, baseProbs)),
    homeWinRate: round(baseRate),
  }

  console.log('\n   Model vs baseline (test split):')
  console.log(`     log loss : ${metrics.logLoss}  (baseline ${metrics.baselineLogLoss})`)
  console.log(`     brier    : ${metrics.brier}`)
  console.log(`     accuracy : ${metrics.accuracy}  (baseline ${metrics.baselineAccuracy})`)
  console.log(`     roc auc  : ${metrics.rocAuc}`)

  const model = {
    featureNames: PREGAME_FEATURE_NAMES,
    intercept: round(intercept, 6),
    coef: coef.map((c) => round(c, 6)),
    mean: mean.map((m) => round(m, 6)),
    std: std.map((s) => round(s, 6)),
    trainedAt: new Date().toISOString(),
    trainingGames: trainRows.length,
    dateRange: `${startDate}..${endDate}`,
    metrics,
  }

  const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'models', 'pregame_win_prob.json')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(model, null, 2))
  console.log(`\n6) Saved model -> ${outPath}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
