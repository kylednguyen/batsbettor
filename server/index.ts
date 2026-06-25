import 'dotenv/config' // load .env before any module reads process.env
import cors from 'cors'
import express, { Request, Response } from 'express'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { getEasternDateString } from './dateUtils.js'
import { createLiveUpdateHub } from './liveUpdateHub.js'
import { handleChat } from './chat.js'
import { isLlmConfigured } from './llm/mlbChatService.js'
import { getPredictionForGame } from './predictionService.js'
import {
  buildFeaturedGameSummary,
  flattenGamesFromSchedule,
  getGameFeed,
  getLiveScoreCardsByDate,
  getMlbOddsByDate,
  getScheduleByDate,
} from './mlbStatsService.js'
import { predictGame, getActiveModelVersion } from './model/predict.js'
import { runBacktest } from './model/backtest.js'
import { formatAmericanOdds, translateMoneyline, translateProbability } from './utils/oddsMath.js'

const app = express()
const port = Number(process.env.PORT || 8787)
const httpServer = createServer(app)
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
})

const liveUpdateHub = createLiveUpdateHub({ io })

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const causeMessage =
    error.cause && typeof error.cause === 'object' && 'message' in error.cause
      ? ` (${(error.cause as { message: string }).message})`
      : ''
  return `${error.message}${causeMessage}`
}

app.use(cors())
app.use(express.json())

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'mlbpredict-backend' })
})

app.get('/api/mlb/schedule', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || getEasternDateString()
    const payload = await getScheduleByDate({ date })
    const games = flattenGamesFromSchedule(payload)
    res.json({
      date,
      totalGames: games.length,
      gamesInProgress: (payload as { totalGamesInProgress?: number })?.totalGamesInProgress ?? 0,
      games,
    })
  } catch (error) {
    res.status(502).json({ error: formatError(error) })
  }
})

app.get('/api/mlb/game/:gamePk/live', async (req: Request, res: Response) => {
  try {
    const gamePk = Number(req.params.gamePk)
    if (!Number.isFinite(gamePk)) {
      return res.status(400).json({ error: 'Invalid gamePk' })
    }
    const payload = await getGameFeed({ gamePk })
    return res.json(payload)
  } catch (error) {
    return res.status(502).json({ error: formatError(error) })
  }
})

app.get('/api/mlb/today-score', async (_req: Request, res: Response) => {
  try {
    const date = getEasternDateString()
    const payload = await getLiveScoreCardsByDate({ date })
    const selected = buildFeaturedGameSummary(payload.cards)

    if (!selected) {
      return res.json({ date, message: 'No games available for today', scoreBox: null })
    }

    return res.json({ date, scoreBox: selected })
  } catch (error) {
    return res.status(502).json({ error: formatError(error) })
  }
})

app.get('/api/mlb/scorecards', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || getEasternDateString()
    const payload = await getLiveScoreCardsByDate({ date })
    return res.json(payload)
  } catch (error) {
    return res.status(502).json({ error: formatError(error) })
  }
})

app.get('/api/mlb/odds', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || getEasternDateString()
    const payload = await getMlbOddsByDate({ date })
    return res.json(payload)
  } catch (error) {
    return res.status(502).json({ error: formatError(error) })
  }
})

app.get('/api/predict/:gamePk', async (req: Request, res: Response) => {
  try {
    const gamePk = Number(req.params.gamePk)
    if (!Number.isFinite(gamePk)) {
      return res.status(400).json({ error: 'Invalid gamePk' })
    }
    const prediction = await getPredictionForGame(gamePk)
    return res.json(prediction)
  } catch (error) {
    return res.status(502).json({ error: formatError(error) })
  }
})

// Trained-artifact model prediction (model/predict.ts), distinct from the
// analytic prediction service above.
app.get('/api/model/predict/:gamePk', async (req: Request, res: Response) => {
  try {
    const gamePk = Number(req.params.gamePk)
    if (!Number.isFinite(gamePk)) {
      return res.status(400).json({ error: 'Invalid gamePk' })
    }
    const date = (req.query.date as string) || getEasternDateString()
    const payload = await getLiveScoreCardsByDate({ date })
    const card = payload.cards.find((c) => c.gamePk === gamePk)
    if (!card) {
      return res.status(404).json({ error: `Game ${gamePk} not found for ${date}` })
    }
    const prediction = predictGame(card)
    if (!prediction) {
      return res.json({ gamePk, matchup: card.matchup, prediction: null, reason: 'No odds available yet' })
    }
    return res.json({ gamePk, matchup: card.matchup, prediction })
  } catch (error) {
    return res.status(502).json({ error: formatError(error) })
  }
})

// Translate between win probabilities and book-style odds.
//   ?prob=0.62                 → fair American odds for that win probability
//   ?home=-150&away=130        → implied + no-vig probabilities, book hold
//   ?gamePk=123&date=...       → both directions for that game's model prediction
app.get('/api/odds/translate', async (req: Request, res: Response) => {
  try {
    const { prob, home, away, gamePk } = req.query

    if (prob !== undefined) {
      const probability = Number(prob)
      if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
        return res.status(400).json({ error: 'prob must be a number strictly between 0 and 1' })
      }
      return res.json({ translation: translateProbability(probability) })
    }

    if (home !== undefined && away !== undefined) {
      const homeOdds = Number(home)
      const awayOdds = Number(away)
      if (!Number.isFinite(homeOdds) || !Number.isFinite(awayOdds)) {
        return res.status(400).json({ error: 'home and away must be American odds, e.g. home=-150&away=130' })
      }
      const t = translateMoneyline(homeOdds, awayOdds)
      return res.json({
        home: { american: homeOdds, display: formatAmericanOdds(homeOdds), impliedProb: t.homeRawImplied, noVigProb: t.homeNoVig },
        away: { american: awayOdds, display: formatAmericanOdds(awayOdds), impliedProb: t.awayRawImplied, noVigProb: t.awayNoVig },
        bookHoldPercent: t.bookHold * 100,
      })
    }

    if (gamePk !== undefined) {
      const pk = Number(gamePk)
      if (!Number.isFinite(pk)) {
        return res.status(400).json({ error: 'Invalid gamePk' })
      }
      const date = (req.query.date as string) || getEasternDateString()
      const payload = await getLiveScoreCardsByDate({ date })
      const card = payload.cards.find((c) => c.gamePk === pk)
      if (!card) {
        return res.status(404).json({ error: `Game ${pk} not found for ${date}` })
      }
      const prediction = predictGame(card)
      if (!prediction) {
        return res.json({ gamePk: pk, matchup: card.matchup, translation: null, reason: 'No prediction available yet' })
      }
      const book =
        card.homeMoneyline !== null && card.awayMoneyline !== null
          ? translateMoneyline(card.homeMoneyline, card.awayMoneyline)
          : null
      return res.json({
        gamePk: pk,
        matchup: card.matchup,
        modelVersion: prediction.modelVersion,
        home: {
          team: card.homeTeam,
          modelWinProbability: prediction.homeWinProbability,
          fairOdds: translateProbability(prediction.homeWinProbability),
          bookOdds: card.homeMoneylineDisplay,
          bookNoVigProb: book?.homeNoVig ?? null,
          edge: prediction.homeProbabilityEdge,
        },
        away: {
          team: card.awayTeam,
          modelWinProbability: prediction.awayWinProbability,
          fairOdds: translateProbability(prediction.awayWinProbability),
          bookOdds: card.awayMoneylineDisplay,
          bookNoVigProb: book?.awayNoVig ?? null,
          edge: prediction.homeProbabilityEdge !== null ? -prediction.homeProbabilityEdge : null,
        },
        bookHoldPercent: book ? book.bookHold * 100 : null,
      })
    }

    return res.status(400).json({ error: 'Provide ?prob=, ?home=&away=, or ?gamePk=' })
  } catch (error) {
    return res.status(502).json({ error: formatError(error) })
  }
})

app.get('/api/model', (_req: Request, res: Response) => {
  res.json({ models: getActiveModelVersion() })
})

// Phase 3 backtest: re-score persisted feature snapshots under every model
// artifact + reference baselines, ranked by log loss per cohort.
//   ?cohort=pregame|live|all (default all)   ?limit=<max snapshots>
app.get('/api/backtest', async (req: Request, res: Response) => {
  try {
    const cohortParam = String(req.query.cohort ?? 'all')
    const cohort = cohortParam === 'pregame' || cohortParam === 'live' ? cohortParam : 'all'
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      return res.status(400).json({ error: 'limit must be a positive number' })
    }
    const report = await runBacktest({ cohort, limit })
    return res.json(report)
  } catch (error) {
    return res.status(502).json({ error: formatError(error) })
  }
})

app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { message, gameContext } = req.body as { message?: string; gameContext?: unknown }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' })
    }
    if (!isLlmConfigured()) {
      return res.status(503).json({
        error:
          'LLM not configured. Set LLM_PROVIDER to groq (GROQ_API_KEY), gemini (GEMINI_API_KEY), anthropic (ANTHROPIC_API_KEY), or ollama (local).',
      })
    }
    const result = await handleChat({ message: message.trim(), gameContext: gameContext as never })
    return res.json(result)
  } catch (error) {
    return res.status(502).json({ error: formatError(error) })
  }
})

httpServer.listen(port, () => {
  liveUpdateHub.start()
  console.log(`BattersBetter backend listening on http://localhost:${port}`)
})
