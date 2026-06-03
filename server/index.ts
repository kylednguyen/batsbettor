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
