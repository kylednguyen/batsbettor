import { getEasternDateString } from './dateUtils.js'
import { buildFeaturedGameSummary, getGameFeed, getLiveScoreCardsByDate } from './mlbStatsService.js'

const SCOREBOARD_INTERVAL_MS = 15_000
const FINAL_GAME_INTERVAL_MS = 180_000
const ACTIVE_GAME_INTERVAL_MS = 15_000
const GAME_ROOM_PREFIX = 'game:'

function safeStringify(value) {
  return JSON.stringify(value)
}

function getGameRoom(gamePk) {
  return `${GAME_ROOM_PREFIX}${gamePk}`
}

function parseGamePkFromRoom(roomName) {
  if (!roomName.startsWith(GAME_ROOM_PREFIX)) return null
  const gamePk = Number(roomName.slice(GAME_ROOM_PREFIX.length))
  return Number.isFinite(gamePk) ? gamePk : null
}

function shouldRefreshGame(statusCode, lastFetchedAt) {
  if (!lastFetchedAt) return true
  const interval = statusCode === 'F' ? FINAL_GAME_INTERVAL_MS : ACTIVE_GAME_INTERVAL_MS
  return Date.now() - lastFetchedAt >= interval
}

export function createLiveUpdateHub({ io }) {
  const scoreboardCache = {
    date: null,
    hash: null,
    payload: null,
  }

  const gameCaches = new Map()
  let tickTimer = null
  let isTicking = false

  async function fetchScoreboard({ forceEmit = false } = {}) {
    const date = getEasternDateString()
    const payload = await getLiveScoreCardsByDate({ date })
    const eventPayload = {
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

  function getSubscribedGamePks() {
    const rooms = io.sockets.adapter.rooms
    const connectedSockets = io.sockets.sockets
    const gamePks = []

    rooms.forEach((_value, roomName) => {
      if (connectedSockets.has(roomName)) return
      const gamePk = parseGamePkFromRoom(roomName)
      if (gamePk) gamePks.push(gamePk)
    })

    return gamePks
  }

  async function fetchGameUpdate(gamePk, { forceEmit = false, emitToSocket = null } = {}) {
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
      const eventPayload = { gamePk, feed }
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
      console.error(`Live game update failed for ${gamePk}:`, error.message)
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
      console.error('Live update tick failed:', error.message)
    } finally {
      isTicking = false
    }
  }

  function start() {
    if (tickTimer) return
    tick()
    tickTimer = setInterval(() => {
      tick()
    }, SCOREBOARD_INTERVAL_MS)
  }

  function stop() {
    if (!tickTimer) return
    clearInterval(tickTimer)
    tickTimer = null
  }

  io.on('connection', (socket) => {
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

  return {
    start,
    stop,
  }
}
