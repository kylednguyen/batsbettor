import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { ChatInput } from './components/ChatInput'
import { ChatWindow } from './components/ChatWindow'
import { SelectedGamePanel } from './components/SelectedGamePanel'
import { getGameFeed, getScoreCardsByDate, getTodayScoreCardSummary } from './api/client'
import { chatMessages, sidebarChats } from './data/mockData'

function getEasternDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${lookup.year}-${lookup.month}-${lookup.day}`
}

function buildFeaturedScoreBox(cards) {
  const featured =
    cards.find((card) => card.statusCode === 'L') ??
    cards.find((card) => card.statusCode === 'P') ??
    cards[0] ??
    null

  if (!featured) return null

  return {
    gamePk: featured.gamePk,
    matchup: featured.matchup,
    status: featured.inningState ?? featured.status,
    score: featured.score,
    baseState: featured.baseState,
    count: featured.count,
    outs: featured.outs,
  }
}

function formatGameRow(card) {
  return `${card.awayAbbreviation} @ ${card.homeAbbreviation} ${card.awayScore ?? '-'} - ${card.homeScore ?? '-'}`
}

function formatSidebarGameMeta(card) {
  if (card.statusCode === 'P') {
    return card.homeMoneylineDisplay ? `${card.homeAbbreviation} ${card.homeMoneylineDisplay}` : '--'
  }

  return `${card.awayScore ?? '-'} - ${card.homeScore ?? '-'}`
}

function shiftEasternDate(baseDateString, deltaDays) {
  const [year, month, day] = baseDateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + deltaDays)
  const nextYear = date.getUTCFullYear()
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0')
  const nextDay = String(date.getUTCDate()).padStart(2, '0')
  return `${nextYear}-${nextMonth}-${nextDay}`
}

function formatSidebarDateLabel(dateString, todayString) {
  if (dateString === todayString) return 'Today'
  const date = new Date(`${dateString}T12:00:00`)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const navItems = [
  { id: 'new', label: 'New chat', icon: '+' },
  { id: 'search', label: 'Search chats', icon: '?' },
  { id: 'saved', label: 'Projects', icon: '#' },
  { id: 'history', label: 'Library', icon: '=' },
  { id: 'more', label: 'More', icon: '...' },
]

export default function App() {
  const [prompt, setPrompt] = useState('')
  const [scoreBox, setScoreBox] = useState(null)
  const [scoreCards, setScoreCards] = useState([])
  const [selectedGamePk, setSelectedGamePk] = useState(null)
  const [selectedGameCard, setSelectedGameCard] = useState(null)
  const [selectedGameFeed, setSelectedGameFeed] = useState(null)
  const [selectedGameLoading, setSelectedGameLoading] = useState(false)
  const [scoreError, setScoreError] = useState('')
  const [activeChatId, setActiveChatId] = useState(sidebarChats[0]?.id ?? 'new-chat')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isSidebarGamesExpanded, setIsSidebarGamesExpanded] = useState(false)
  const [sidebarDateOffset, setSidebarDateOffset] = useState(0)
  const [sidebarDateCards, setSidebarDateCards] = useState([])
  const [sidebarDateLoading, setSidebarDateLoading] = useState(false)
  const today = getEasternDateString()
  const socketRef = useRef(null)
  const selectedGamePkRef = useRef(null)
  const previousSubscribedGameRef = useRef(null)
  const sidebarDateScrollRef = useRef(null)

  const sortedScoreCards = useMemo(
    () =>
      [...scoreCards].sort((left, right) => {
        const priority = { L: 0, P: 1, F: 2 }
        const leftPriority = priority[left.statusCode] ?? 3
        const rightPriority = priority[right.statusCode] ?? 3
        if (leftPriority !== rightPriority) return leftPriority - rightPriority
        return new Date(left.gameDate).getTime() - new Date(right.gameDate).getTime()
      }),
    [scoreCards]
  )

  const selectedCard =
    sortedScoreCards.find((card) => card.gamePk === selectedGamePk) ??
    sidebarDateCards.find((card) => card.gamePk === selectedGamePk) ??
    selectedGameCard ??
    null

  const pinnedChats = sidebarChats.filter((chat) => chat.pinned)
  const recentChats = sidebarChats.filter((chat) => !chat.pinned)
  const isNewChat = activeChatId === 'new-chat'
  const sidebarActiveDate = shiftEasternDate(today, sidebarDateOffset)
  const dateOptions = Array.from({ length: 9 }, (_, index) => shiftEasternDate(today, index - 4))
  const visibleSidebarCards = isSidebarGamesExpanded ? sidebarDateCards : sortedScoreCards.slice(0, 6)

  useEffect(() => {
    selectedGamePkRef.current = selectedGamePk
  }, [selectedGamePk])

  useEffect(() => {
    let cancelled = false

    async function loadLiveSlate() {
      try {
        setScoreError('')
        const [featuredPayload, slatePayload] = await Promise.all([
          getTodayScoreCardSummary(),
          getScoreCardsByDate(today),
        ])

        if (!cancelled) {
          setScoreBox(featuredPayload.scoreBox)
          setScoreCards(slatePayload.cards ?? [])
          setSelectedGameCard((current) => {
            if (!current) return current
            return slatePayload.cards?.find((card) => card.gamePk === current.gamePk) ?? current
          })
        }
      } catch (error) {
        if (!cancelled) setScoreError(error.message)
      }
    }

    loadLiveSlate()
    return () => {
      cancelled = true
    }
  }, [today])

  useEffect(() => {
    let cancelled = false

    async function loadSidebarDateCards() {
      if (!isSidebarGamesExpanded) {
        setSidebarDateCards(sortedScoreCards)
        return
      }

      try {
        setSidebarDateLoading(true)
        const payload = await getScoreCardsByDate(sidebarActiveDate)
        if (!cancelled) {
          setSidebarDateCards(payload.cards ?? [])
        }
      } catch (_error) {
        if (!cancelled) {
          setSidebarDateCards([])
        }
      } finally {
        if (!cancelled) {
          setSidebarDateLoading(false)
        }
      }
    }

    loadSidebarDateCards()
    return () => {
      cancelled = true
    }
  }, [isSidebarGamesExpanded, sidebarActiveDate, sidebarDateOffset, sortedScoreCards])

  useEffect(() => {
    if (!isSidebarGamesExpanded) return

    const frame = requestAnimationFrame(() => {
      const activeButton = sidebarDateScrollRef.current?.querySelector?.(
        `[data-date-offset="${sidebarDateOffset}"]`
      )

      if (activeButton?.scrollIntoView) {
        activeButton.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
      }
    })

    return () => cancelAnimationFrame(frame)
  }, [isSidebarGamesExpanded, sidebarDateOffset])

  useEffect(() => {
    const socket = io('/', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    })

    socketRef.current = socket

    socket.on('connect', () => {
      const activeGamePk = selectedGamePkRef.current
      if (activeGamePk) {
        socket.emit('game:subscribe', { gamePk: activeGamePk })
        previousSubscribedGameRef.current = activeGamePk
      }
    })

    socket.on('scoreboard:update', (payload) => {
      setScoreError('')
      setScoreCards(payload.cards ?? [])
      setScoreBox(payload.scoreBox ?? buildFeaturedScoreBox(payload.cards ?? []))
      setSelectedGameCard((current) => {
        if (!current) return current
        return payload.cards?.find((card) => card.gamePk === current.gamePk) ?? current
      })
    })

    socket.on('game:update', ({ gamePk, feed }) => {
      if (!gamePk || gamePk !== selectedGamePkRef.current) return
      setSelectedGameFeed(feed)
      setSelectedGameLoading(false)
    })

    socket.on('connect_error', (error) => {
      setScoreError(error.message)
    })

    return () => {
      const currentGamePk = previousSubscribedGameRef.current
      if (currentGamePk) {
        socket.emit('game:unsubscribe', { gamePk: currentGamePk })
      }
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadSelectedGameFeed() {
      if (!selectedGamePk) return

      try {
        setSelectedGameLoading(true)
        setSelectedGameFeed(null)
        const payload = await getGameFeed(selectedGamePk)
        if (!cancelled) {
          setSelectedGameFeed(payload)
          setSelectedGameCard((current) => current ?? selectedCard ?? null)
        }
      } catch (_error) {
        if (!cancelled) {
          setSelectedGameFeed(null)
        }
      } finally {
        if (!cancelled) {
          setSelectedGameLoading(false)
        }
      }
    }

    loadSelectedGameFeed()
    return () => {
      cancelled = true
    }
  }, [selectedGamePk])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket) return

    const previousGamePk = previousSubscribedGameRef.current
    if (previousGamePk && previousGamePk !== selectedGamePk) {
      socket.emit('game:unsubscribe', { gamePk: previousGamePk })
      previousSubscribedGameRef.current = null
    }

    if (!selectedGamePk) return

    socket.emit('game:subscribe', { gamePk: selectedGamePk })
    previousSubscribedGameRef.current = selectedGamePk

    return () => {
      if (socketRef.current && previousSubscribedGameRef.current === selectedGamePk) {
        socketRef.current.emit('game:unsubscribe', { gamePk: selectedGamePk })
        previousSubscribedGameRef.current = null
      }
    }
  }, [selectedGamePk])

  function handleSelectGame(card) {
    setSelectedGamePk(card.gamePk)
    setSelectedGameCard(card)
  }

  function handleNewChat() {
    setActiveChatId('new-chat')
    setPrompt('')
    setSelectedGamePk(null)
    setSelectedGameCard(null)
  }

  function handleSelectSidebarDate(nextOffset) {
    setSidebarDateOffset(nextOffset)
  }

  return (
    <main className={`chatgame-shell${isSidebarCollapsed ? ' chatgame-shell--collapsed' : ''}`}>
      <aside className={`chatgame-sidebar${isSidebarCollapsed ? ' chatgame-sidebar--collapsed' : ''}`}>
        <div className="chatgame-sidebar__header">
          <div className="chatgame-sidebar__brand">
            <div className="brand-mark">MP</div>
            {!isSidebarCollapsed ? <span className="sidebar-logo">BattersBetter</span> : null}
          </div>
          <button
            className="sidebar-toggle"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
            type="button"
          >
            {isSidebarCollapsed ? '>' : '<'}
          </button>
        </div>

        <div className="chatgame-sidebar__scroll">
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <button
                className={`sidebar-nav-item${item.id === 'new' && isNewChat ? ' sidebar-nav-item--active' : ''}`}
                key={item.id}
                onClick={item.id === 'new' ? handleNewChat : undefined}
                type="button"
              >
                <span className="sidebar-nav-item__icon">{item.icon}</span>
                {!isSidebarCollapsed ? <span>{item.label}</span> : null}
              </button>
            ))}
          </nav>

          {!isSidebarCollapsed ? (
            <>
              <section className="today-games-section">
                <div className="sidebar-section-title-row">
                  <h2 className="sidebar-section-title">Today's Games</h2>
                  <button
                    className="sidebar-see-more"
                    onClick={() => {
                      const nextExpanded = !isSidebarGamesExpanded
                      setIsSidebarGamesExpanded(nextExpanded)
                      setSidebarDateOffset(0)
                      setSidebarDateCards(sortedScoreCards)
                    }}
                    type="button"
                  >
                    {isSidebarGamesExpanded ? 'See less' : 'See more'}
                  </button>
                </div>
                {isSidebarGamesExpanded ? (
                  <div className="sidebar-date-browser">
                    <button
                      className="sidebar-date-arrow"
                      onClick={() => handleSelectSidebarDate(Math.max(sidebarDateOffset - 1, -4))}
                      type="button"
                    >
                      ‹
                    </button>
                    <div className="sidebar-date-scroll" ref={sidebarDateScrollRef}>
                      {dateOptions.map((dateString, index) => {
                        const offset = index - 4
                        return (
                          <button
                            className={`sidebar-date-item${sidebarDateOffset === offset ? ' sidebar-date-item--active' : ''}`}
                            data-date-offset={offset}
                            key={dateString}
                            onClick={() => handleSelectSidebarDate(offset)}
                            type="button"
                          >
                            {formatSidebarDateLabel(dateString, today)}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      className="sidebar-date-arrow"
                      onClick={() => handleSelectSidebarDate(Math.min(sidebarDateOffset + 1, 4))}
                      type="button"
                    >
                      ›
                    </button>
                  </div>
                ) : null}
                <div className="sidebar-section-list">
                  {visibleSidebarCards.map((card) => (
                    <button
                      className={`sidebar-game-item${card.gamePk === selectedCard?.gamePk ? ' active' : ''}`}
                      key={card.gamePk}
                      onClick={() => handleSelectGame(card)}
                      title={formatGameRow(card)}
                      type="button"
                    >
                      <span className="sidebar-game-item__teams">
                        {card.awayAbbreviation} @ {card.homeAbbreviation}
                      </span>
                      <span className="sidebar-game-item__score">
                        {formatSidebarGameMeta(card)}
                      </span>
                    </button>
                  ))}
                  {(isSidebarGamesExpanded ? sidebarDateCards.length === 0 : sortedScoreCards.length === 0) ? (
                    <div className="sidebar-empty-row">
                      {sidebarDateLoading ? 'Loading games...' : scoreError || 'No games loaded yet.'}
                    </div>
                  ) : null}
                </div>
              </section>

              <section>
                <h2 className="sidebar-section-title">Pinned Chats</h2>
                <div className="sidebar-section-list">
                  {pinnedChats.map((chat) => (
                    <button
                      className={`sidebar-chat-item${activeChatId === chat.id ? ' active' : ''}`}
                      key={chat.id}
                      onClick={() => {
                        setActiveChatId(chat.id)
                        setSelectedGamePk(null)
                        setSelectedGameCard(null)
                      }}
                      title={chat.title}
                      type="button"
                    >
                      {chat.title}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="sidebar-section-title">Recent Chats</h2>
                <div className="sidebar-section-list">
                  {recentChats.map((chat) => (
                    <button
                      className={`sidebar-chat-item${activeChatId === chat.id ? ' active' : ''}`}
                      key={chat.id}
                      onClick={() => {
                        setActiveChatId(chat.id)
                        setSelectedGamePk(null)
                        setSelectedGameCard(null)
                      }}
                      title={chat.title}
                      type="button"
                    >
                      {chat.title}
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </div>

        <div className="sidebar-account">
          <div className="sidebar-avatar">KN</div>
          {!isSidebarCollapsed ? (
            <>
              <div className="sidebar-account__meta">
                <strong>Kyle Nguyen</strong>
                <span>Plus</span>
              </div>
              <button className="sidebar-account__menu" type="button">
                ...
              </button>
            </>
          ) : null}
        </div>
      </aside>

      <section className="chatgame-main">
        {!selectedCard ? (
          <div className="chat-home-screen">
            {isNewChat ? (
              <>
                <h1>How can I help, Kyle?</h1>
                <div className="chat-home-screen__composer">
                  <ChatInput minimal prompt={prompt} setPrompt={setPrompt} />
                </div>
              </>
            ) : (
              <div className="chat-thread-shell">
                <ChatWindow messages={chatMessages} />
                <ChatInput prompt={prompt} setPrompt={setPrompt} />
              </div>
            )}
          </div>
        ) : (
          <div className="game-log-layout">
            <div className="game-log-layout__header">
              <div>
                <p className="section-label">Live Game Log</p>
                <h1>{selectedCard.matchup}</h1>
              </div>
              <button
                className="game-log-layout__close"
                onClick={() => {
                  setSelectedGamePk(null)
                  setSelectedGameCard(null)
                }}
                type="button"
              >
                Close
              </button>
            </div>

            <SelectedGamePanel
              gameFeed={selectedGameFeed}
              loading={selectedGameLoading}
              scoreError={scoreError}
              selectedCard={selectedCard ?? scoreBox}
              today={today}
            />

            <div className="floating-chat-panel">
              <div className="floating-chat-panel__header">
                <strong>Ask about this game</strong>
              </div>
              <ChatWindow messages={chatMessages} />
              <ChatInput prompt={prompt} setPrompt={setPrompt} />
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
