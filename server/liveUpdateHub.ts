import type { Server as SocketIOServer, Socket } from 'socket.io'
import { getEasternDateString } from './dateUtils.js'
import { buildFeaturedGameSummary, getGameFeed, getLiveScoreCardsByDate, type ScoreCard, type ScoreBox } from './mlbStatsService.js'

const SCOREBOARD_INTERVAL_MS = 15_000
const FINAL_GAME_INTERVAL_MS = 180_000
const ACTIVE_GAME_INTERVAL_MS = 15_000
const GAME_ROOM_PREFIX = 'game:'

interface ScoreboardPayload {
  date: string
  oddsProvider: string | null
  totalGames: number
  gamesInProgress: number
  cards: ScoreCard[]
  scoreBox: ScoreBox | null
}

interface GameEventPayload {
  gamePk: number
  feed: unknown
}

interface ScoreboardCache {
  date: string | null
  hash: string | null
  payload: ScoreboardPayload | null
}

interface GameCache {
  hash: string
  payload: GameEventPayload
  statusCode: string | null
  lastFetchedAt: number
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value)
}

function getGameRoom(gamePk: number): string {
  return `${GAME_ROOM_PREFIX}${gamePk}`
}

function parseGamePkFromRoom(roomName: string): number | null {
  if (!roomName.startsWith(GAME_ROOM_PREFIX)) return null
  const gamePk = Number(roomName.slice(GAME_ROOM_PREFIX.length))
  return Number.isFinite(gamePk) ? gamePk : null
}

function shouldRefreshGame(statusCode: string | null, lastFetchedAt: number | undefined): boolean {
  if (!lastFetchedAt) return true
  const interval = statusCode === 'F' ? FINAL_GAME_INTERVAL_MS : ACTIVE_GAME_INTERVAL_MS
  return Date.now() - lastFetchedAt >= interval
}

export function createLiveUpdateHub({ io }: { io: SocketIOServer }) {
  const scoreboardCache: ScoreboardCache = {
    date: null,
    hash: null,
    payload: null,
  }

  const gameCaches = new Map<number, GameCache>()
  let tickTimer: ReturnType<typeof setInterval> | null = null
  let isTicking = false

  async function fetchScoreboard({ forceEmit = false } = {}): Promise<ScoreboardPayload> {
    const date = getEasternDateString()
    const payload = await getLiveScoreCardsByDate({ date })
    const eventPayload: ScoreboardPayload = {
      ...payload,
      scoreBox: buildFeaturedGameSummary(payload.cards),
    }
    const nextHash = safeStringify(eventPayload)
    const changed = nextHash !== scoreboardCache.hash

    scoreboardCache.date = date
    scoreboardCache.payload = eventPayload
    scoreboardCache.hash = nextHash

    if (changed || forceEmit) {
      io.emit('scoreboard:update', eventPayload)
    }

    return eventPayload
  }

  function getSubscribedGamePks(): number[] {
    const rooms = io.sockets.adapter.rooms
    const connectedSockets = io.sockets.sockets
    const gamePks: number[] = []

    rooms.forEach((_value, roomName) => {
      if (connectedSockets.has(roomName)) return
      const gamePk = parseGamePkFromRoom(roomName)
      if (gamePk) gamePks.push(gamePk)
    })

    return gamePks
  }

  async function fetchGameUpdate(gamePk: number, { forceEmit = false, emitToSocket = null }: { forceEmit?: boolean; emitToSocket?: Socket | null } = {}): Promise<GameEventPayload | null> {
    const scoreboardCard =
      scoreboardCache.payload?.cards?.find((card) => card.gamePk === gamePk) ?? null
    const statusCode = scoreboardCard?.statusCode ?? null
    const cache = gameCaches.get(gamePk)

    if (!forceEmit && !shouldRefreshGame(statusCode, cache?.lastFetchedAt)) {
      if (emitToSocket && cache?.payload) {
        emitToSocket.emit('game:update', cache.payload)
      }
      return cache?.payload ?? null
    }

    try {
      const feed = await getGameFeed({ gamePk })
      const eventPayload: GameEventPayload = { gamePk, feed }
      const nextHash = safeStringify(eventPayload)
      const changed = nextHash !== cache?.hash

      gameCaches.set(gamePk, {
        hash: nextHash,
        payload: eventPayload,
        statusCode,
        lastFetchedAt: Date.now(),
      })

      if (emitToSocket) {
        emitToSocket.emit('game:update', eventPayload)
      } else if (changed || forceEmit) {
        io.to(getGameRoom(gamePk)).emit('game:update', eventPayload)
      }

      return eventPayload
    } catch (error) {
      if (cache) {
        gameCaches.set(gamePk, {
          ...cache,
          statusCode,
          lastFetchedAt: Date.now(),
        })
      }
      console.error(`Live game update failed for ${gamePk}:`, (error as Error).message)
      return null
    }
  }

  async function tick() {
    if (isTicking) return
    isTicking = true

    try {
      await fetchScoreboard()
      const subscribedGamePks = getSubscribedGamePks()
      await Promise.all(subscribedGamePks.map((gamePk) => fetchGameUpdate(gamePk)))
    } catch (error) {
      console.error('Live update tick failed:', (error as Error).message)
    } finally {
      isTicking = false
    }
  }

  function start() {
    if (tickTimer) return
    tick()
    tickTimer = setInterval(() => { tick() }, SCOREBOARD_INTERVAL_MS)
  }

  function stop() {
    if (!tickTimer) return
    clearInterval(tickTimer)
    tickTimer = null
  }

  io.on('connection', (socket: Socket) => {
    socket.emit('live:ready', {
      intervalMs: SCOREBOARD_INTERVAL_MS,
      connectedAt: new Date().toISOString(),
    })

    if (scoreboardCache.payload) {
      socket.emit('scoreboard:update', scoreboardCache.payload)
    }

    socket.on('game:subscribe', async ({ gamePk } = {}) => {
      const nextGamePk = Number(gamePk)
      if (!Number.isFinite(nextGamePk)) return

      socket.join(getGameRoom(nextGamePk))
      await fetchGameUpdate(nextGamePk, { emitToSocket: socket })
    })

    socket.on('game:unsubscribe', ({ gamePk } = {}) => {
      const nextGamePk = Number(gamePk)
      if (!Number.isFinite(nextGamePk)) return
      socket.leave(getGameRoom(nextGamePk))
    })
  })

  return { start, stop }
}
