import React, { useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { EditPencil, Flash, GraphUp, Dollar, Xmark, NavArrowLeft, NavArrowRight } from 'iconoir-react'
import { MiniBaseballDiamond } from './components/BaseballDiamond'
import { SidebarGameItemSkeleton, GamePanelSkeleton } from './components/Skeleton'
import { ChatInput } from './components/ChatInput'
import { ChatWindow } from './components/ChatWindow'
import { SelectedGamePanel } from './components/SelectedGamePanel'
import { getGameFeed, getScoreCardsByDate, getTodayScoreCardSummary, sendChatMessage } from './api/client'
import { API_BASE_URL } from './api/config'

import type { ScoreCard, ScoreBox, ChatMessage } from './types'
import type { SelectedCardLike } from './components/SelectedGamePanel'

function getEasternDateString(date = new Date()): string {
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

function buildFeaturedScoreBox(cards: ScoreCard[]): ScoreBox | null {
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

function formatGameRow(card: ScoreCard): string {
  return `${card.awayAbbreviation} @ ${card.homeAbbreviation} ${card.awayScore ?? '-'} - ${card.homeScore ?? '-'}`
}

function formatSidebarGameMeta(card: ScoreCard): string {
  if (card.statusCode === 'P') {
    return card.homeMoneylineDisplay ? `${card.homeAbbreviation} ${card.homeMoneylineDisplay}` : '--'
  }
  return `${card.awayScore ?? '-'} - ${card.homeScore ?? '-'}`
}

function shiftEasternDate(baseDateString: string, deltaDays: number): string {
  const [year, month, day] = baseDateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + deltaDays)
  const nextYear = date.getUTCFullYear()
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0')
  const nextDay = String(date.getUTCDate()).padStart(2, '0')
  return `${nextYear}-${nextMonth}-${nextDay}`
}

function formatSidebarDateLabel(dateString: string, todayString: string): string {
  if (dateString === todayString) return 'Today'
  const date = new Date(`${dateString}T12:00:00`)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
}

const navItems: NavItem[] = [
  { id: 'new', label: 'New chat', icon: <EditPencil width={16} height={16} /> },
  { id: 'live', label: 'Live games', icon: <Flash width={16} height={16} /> },
  { id: 'edges', label: 'Top edges', icon: <GraphUp width={16} height={16} /> },
  { id: 'odds', label: 'Odds', icon: <Dollar width={16} height={16} /> },
]

const quickPrompts: string[] = [
  "What games are live right now?",
  "Which games have the biggest model vs book gap?",
  "What's the win probability for the Yankees?",
  "Give me the projected final score for the Dodgers game.",
  "Translate the fair odds for tonight's slate.",
]

export default function App() {
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [scoreBox, setScoreBox] = useState<ScoreBox | null>(null)
  const [scoreCards, setScoreCards] = useState<ScoreCard[]>([])
  const [selectedGamePk, setSelectedGamePk] = useState<number | null>(null)
  const [selectedGameCard, setSelectedGameCard] = useState<ScoreCard | null>(null)
  const [selectedGameFeed, setSelectedGameFeed] = useState<Record<string, unknown> | null>(null)
  const [selectedGameLoading, setSelectedGameLoading] = useState(false)
  const [scoreError, setScoreError] = useState('')
  const [activeChatId, setActiveChatId] = useState('new-chat')
  const [isSidebarGamesExpanded, setIsSidebarGamesExpanded] = useState(false)
  const [sidebarDateOffset, setSidebarDateOffset] = useState(0)
  const [sidebarDateCards, setSidebarDateCards] = useState<ScoreCard[]>([])
  const [sidebarDateLoading, setSidebarDateLoading] = useState(false)
  const [slateLoading, setSlateLoading] = useState(true)
  const today = getEasternDateString()
  const socketRef = useRef<Socket | null>(null)
  const selectedGamePkRef = useRef<number | null>(null)
  const previousSubscribedGameRef = useRef<number | null>(null)
  const sidebarDateScrollRef = useRef<HTMLDivElement | null>(null)

  const sortedScoreCards = useMemo(
    () =>
      [...scoreCards].sort((left, right) => {
        const priority: Record<string, number> = { L: 0, P: 1, F: 2 }
        const leftPriority = priority[left.statusCode ?? ''] ?? 3
        const rightPriority = priority[right.statusCode ?? ''] ?? 3
        if (leftPriority !== rightPriority) return leftPriority - rightPriority
        return new Date(left.gameDate ?? '').getTime() - new Date(right.gameDate ?? '').getTime()
      }),
    [scoreCards]
  )

  const selectedCard =
    sortedScoreCards.find((card) => card.gamePk === selectedGamePk) ??
    sidebarDateCards.find((card) => card.gamePk === selectedGamePk) ??
    selectedGameCard ??
    null

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
        setSlateLoading(true)
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
        if (!cancelled) setScoreError((error as Error).message)
      } finally {
        if (!cancelled) setSlateLoading(false)
      }
    }

    loadLiveSlate()
    return () => { cancelled = true }
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
        if (!cancelled) setSidebarDateCards([])
      } finally {
        if (!cancelled) setSidebarDateLoading(false)
      }
    }

    loadSidebarDateCards()
    return () => { cancelled = true }
  }, [isSidebarGamesExpanded, sidebarActiveDate, sidebarDateOffset, sortedScoreCards])

  useEffect(() => {
    if (!isSidebarGamesExpanded) return

    const frame = requestAnimationFrame(() => {
      const activeButton = sidebarDateScrollRef.current?.querySelector?.(
        `[data-date-offset="${sidebarDateOffset}"]`
      ) as HTMLElement | null

      if (activeButton?.scrollIntoView) {
        activeButton.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
      }
    })

    return () => cancelAnimationFrame(frame)
  }, [isSidebarGamesExpanded, sidebarDateOffset])

  useEffect(() => {
    const socket = io(API_BASE_URL || '/', {
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

    socket.on('scoreboard:update', (payload: { cards?: ScoreCard[]; scoreBox?: ScoreBox | null }) => {
      setScoreError('')
      setScoreCards(payload.cards ?? [])
      setScoreBox(payload.scoreBox ?? buildFeaturedScoreBox(payload.cards ?? []))
      setSelectedGameCard((current) => {
        if (!current) return current
        return payload.cards?.find((card) => card.gamePk === current.gamePk) ?? current
      })
    })

    socket.on('game:update', ({ gamePk, feed }: { gamePk: number; feed: Record<string, unknown> }) => {
      if (!gamePk || gamePk !== selectedGamePkRef.current) return
      setSelectedGameFeed(feed)
      setSelectedGameLoading(false)
    })

    socket.on('connect_error', (error: Error) => {
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
          setSelectedGameFeed(payload as Record<string, unknown>)
          setSelectedGameCard((current) => current ?? selectedCard ?? null)
        }
      } catch (_error) {
        if (!cancelled) setSelectedGameFeed(null)
      } finally {
        if (!cancelled) setSelectedGameLoading(false)
      }
    }

    loadSelectedGameFeed()
    return () => { cancelled = true }
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

  function handleSelectGame(card: ScoreCard) {
    setSelectedGamePk(card.gamePk)
    setSelectedGameCard(card)
  }

  function handleNewChat() {
    setActiveChatId('new-chat')
    setPrompt('')
    setMessages([])
    setSelectedGamePk(null)
    setSelectedGameCard(null)
  }


  async function handleSendMessage(message: string) {
    const userMessage: ChatMessage = { role: 'user', body: message }
    setMessages((prev) => [...prev, userMessage])
    setChatLoading(true)

    try {
      const reply = await sendChatMessage(message, selectedCard ?? null)
      setMessages((prev) => [...prev, reply])
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Something went wrong'
      setMessages((prev) => [...prev, { role: 'assistant', body: `Error: ${errMsg}` }])
    } finally {
      setChatLoading(false)
    }
  }

  function handleSelectSidebarDate(nextOffset: number) {
    setSidebarDateOffset(nextOffset)
  }

  return (
    <main className="chatgame-shell">
      <aside className="chatgame-sidebar">
        <div className="chatgame-sidebar__header">
          <span className="sidebar-logo">BatsBet</span>
        </div>

        <div className="chatgame-sidebar__scroll">
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <button
                className={`sidebar-nav-item${item.id === 'new' && isNewChat ? ' sidebar-nav-item--active' : ''}`}
                key={item.id}
                onClick={() => {
                  if (item.id === 'new') { handleNewChat(); return }
                  if (item.id === 'live') setPrompt('What games are live right now?')
                  if (item.id === 'edges') setPrompt('Which games have the biggest model vs book gap right now?')
                  if (item.id === 'odds') setPrompt("Translate tonight's MLB moneylines into fair odds.")
                }}
                type="button"
              >
                <span className="sidebar-nav-item__icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

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
                <button className="sidebar-date-arrow" onClick={() => handleSelectSidebarDate(Math.max(sidebarDateOffset - 1, -4))} type="button"><NavArrowLeft width={14} height={14} /></button>
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
                <button className="sidebar-date-arrow" onClick={() => handleSelectSidebarDate(Math.min(sidebarDateOffset + 1, 4))} type="button"><NavArrowRight width={14} height={14} /></button>
              </div>
            ) : null}
            <div className="sidebar-section-list">
              {(slateLoading || sidebarDateLoading) && visibleSidebarCards.length === 0
                ? Array.from({ length: 5 }).map((_, i) => <SidebarGameItemSkeleton key={i} />)
                : null}
              {visibleSidebarCards.map((card) => (
                <button
                  className={`sidebar-game-item${card.gamePk === selectedCard?.gamePk ? ' active' : ''}${card.statusCode === 'L' ? ' sidebar-game-item--live' : ''}`}
                  key={card.gamePk}
                  onClick={() => handleSelectGame(card)}
                  title={formatGameRow(card)}
                  type="button"
                >
                  <span className="sidebar-game-item__matchup">
                    <span className="sidebar-game-item__teams">
                      {card.awayAbbreviation} @ {card.homeAbbreviation}
                    </span>
                    {card.statusCode === 'L' ? (
                      <span className="sidebar-game-item__live-row">
                        <span className="sidebar-game-item__inning">
                          {card.inningState === 'Top' || card.inningState === 'Middle' ? '▲' : '▼'}
                          {card.inning}
                        </span>
                        <MiniBaseballDiamond baseState={card.baseState} />
                        {card.outs != null && (
                          <span className="sidebar-game-item__outs">
                            {card.outs} {card.outs === 1 ? 'out' : 'outs'}
                          </span>
                        )}
                      </span>
                    ) : null}
                  </span>
                  <span className="sidebar-game-item__score">
                    {formatSidebarGameMeta(card)}
                  </span>
                </button>
              ))}
              {(isSidebarGamesExpanded ? sidebarDateCards.length === 0 : sortedScoreCards.length === 0) && !slateLoading && !sidebarDateLoading && (
                <div className="sidebar-empty-row">
                  {scoreError || 'No games yet.'}
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="sidebar-section-title">Quick Prompts</h2>
            <div className="sidebar-section-list">
              {quickPrompts.map((p) => (
                <button className="sidebar-chat-item" key={p} onClick={() => setPrompt(p)} title={p} type="button">
                  {p}
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="sidebar-account">
          <div className="sidebar-avatar">KN</div>
          <div className="sidebar-account__meta">
            <strong>Kyle Nguyen</strong>
          </div>
        </div>
      </aside>

      <section className="chatgame-main">
        {!selectedCard ? (
          <div className="chat-home-screen">
            {messages.length === 0 && !chatLoading ? (
              <>
                <h1>How can I help, Kyle?</h1>
                <div className="chat-home-screen__composer">
                  <ChatInput minimal prompt={prompt} setPrompt={setPrompt} onSubmit={handleSendMessage} disabled={chatLoading} />
                  <div className="quick-prompts-row">
                    {quickPrompts.map((p) => (
                      <button
                        className="quick-prompt-chip"
                        key={p}
                        onClick={() => setPrompt(p)}
                        type="button"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="chat-thread-shell">
                <ChatWindow messages={messages} loading={chatLoading} />
                <ChatInput prompt={prompt} setPrompt={setPrompt} onSubmit={handleSendMessage} disabled={chatLoading} />
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
                <Xmark width={18} height={18} />
              </button>
            </div>

            {selectedGameLoading && !selectedGameFeed
              ? <GamePanelSkeleton />
              : (
                <SelectedGamePanel
                  gameFeed={selectedGameFeed}
                  loading={selectedGameLoading}
                  scoreError={scoreError}
                  selectedCard={(selectedCard ?? scoreBox) as SelectedCardLike}
                  today={today}
                />
              )
            }

            <div className="floating-chat-panel">
              <ChatWindow messages={messages} loading={chatLoading} />
              <ChatInput prompt={prompt} setPrompt={setPrompt} onSubmit={handleSendMessage} disabled={chatLoading} />
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
