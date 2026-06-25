import { Fragment, useEffect, useMemo, useState } from 'react'
import { Flash, GraphUp, Dollar } from 'iconoir-react'
import { getPrediction } from '../api/client'
import type { ScoreCard, Prediction } from '../types'
import { MiniBaseballDiamond } from './BaseballDiamond'
import { LiveGridSkeleton, DashTableSkeleton } from './Skeleton'

// ---------------------------------------------------------------------------
// Shared data hook: fetch the analytic prediction for every game on the slate
// in parallel so the Top Edges and Odds tables can rank/compare across games.
// ---------------------------------------------------------------------------

export interface SlatePredictions {
  byGame: Record<number, Prediction>
  loading: boolean
}

export function useSlatePredictions(cards: ScoreCard[]): SlatePredictions {
  const [byGame, setByGame] = useState<Record<number, Prediction>>({})
  const [loading, setLoading] = useState(false)
  const gamePks = useMemo(() => cards.map((c) => c.gamePk).join(','), [cards])

  useEffect(() => {
    let cancelled = false
    const pks = gamePks ? gamePks.split(',').map(Number) : []
    if (pks.length === 0) {
      setByGame({})
      return
    }
    setLoading(true)
    Promise.allSettled(pks.map((pk) => getPrediction(pk))).then((results) => {
      if (cancelled) return
      const next: Record<number, Prediction> = {}
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) next[pks[i]] = r.value
      })
      setByGame(next)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [gamePks])

  return { byGame, loading }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const pct = (value: number | null | undefined): string =>
  value == null ? '—' : `${(value * 100).toFixed(1)}%`

const signedPts = (value: number | null | undefined): string => {
  if (value == null) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '' : ''
  return `${sign}${value.toFixed(1)} pts`
}

function statusLabel(card: ScoreCard): { text: string; tone: 'live' | 'final' | 'soon' } {
  if (card.statusCode === 'L') return { text: card.inning ? `${card.inningState ?? ''} ${card.inning}`.trim() : 'Live', tone: 'live' }
  if (card.statusCode === 'F') return { text: 'Final', tone: 'final' }
  const time = card.gameDate
    ? new Date(card.gameDate).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
    : ''
  return { text: time || 'Scheduled', tone: 'soon' }
}

// The best value side for a game: larger absolute model-vs-book edge.
interface BestEdge {
  side: 'home' | 'away'
  team: string
  edgePts: number // signed, positive = model favors this side over the book
  modelProb: number
  marketProb: number | null
  fairOdds: string
  bookOdds: string | null
}

function bestEdge(card: ScoreCard, p: Prediction): BestEdge | null {
  if (!p.edge) return null
  const home: BestEdge = {
    side: 'home',
    team: card.homeAbbreviation ?? p.homeAbbreviation,
    edgePts: p.edge.homeProbabilityEdge,
    modelProb: p.model.homeWinProbability,
    marketProb: p.market?.homeNoVigProbability ?? null,
    fairOdds: p.model.fairHomeMoneylineDisplay,
    bookOdds: p.market?.homeMoneylineDisplay ?? null,
  }
  const away: BestEdge = {
    side: 'away',
    team: card.awayAbbreviation ?? p.awayAbbreviation,
    edgePts: p.edge.awayProbabilityEdge,
    modelProb: p.model.awayWinProbability,
    marketProb: p.market?.awayNoVigProbability ?? null,
    fairOdds: p.model.fairAwayMoneylineDisplay,
    bookOdds: p.market?.awayMoneylineDisplay ?? null,
  }
  return home.edgePts >= away.edgePts ? home : away
}

// Surname only, for compact starter lines.
const lastName = (full?: string | null): string => (full ? full.split(' ').slice(-1)[0] : '—')

// "Liberatore vs Prielipp" from the probable starters (MLB StatsAPI), or null.
function startersLine(p: Prediction): string | null {
  const sp = p.startingPitchers
  if (!sp || (!sp.home && !sp.away)) return null
  return `${lastName(sp.away?.name)} vs ${lastName(sp.home?.name)}`
}

// Projected final score from the run-expectancy model, e.g. "4.5–4.5".
const projLine = (p: Prediction): string =>
  `${p.model.projectedAwayRuns.toFixed(1)}–${p.model.projectedHomeRuns.toFixed(1)}`

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

function DashHeader({
  icon,
  title,
  subtitle,
  stats,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  stats: { label: string; value: string }[]
}) {
  return (
    <header className="dash-header">
      <div className="dash-header__lead">
        <span className="dash-header__icon">{icon}</span>
        <div>
          <h1 className="dash-header__title">{title}</h1>
          <p className="dash-header__sub">{subtitle}</p>
        </div>
      </div>
      <div className="dash-stat-strip">
        {stats.map((s) => (
          <div className="dash-stat" key={s.label}>
            <span className="dash-stat__value">{s.value}</span>
            <span className="dash-stat__label">{s.label}</span>
          </div>
        ))}
      </div>
    </header>
  )
}

function EdgeBar({ edgePts }: { edgePts: number }) {
  // Map ±10 pts to full width; positive = green (value), negative = muted.
  const magnitude = Math.min(Math.abs(edgePts) / 10, 1)
  const positive = edgePts > 0.05
  return (
    <div className="edge-bar" title={signedPts(edgePts)}>
      <div
        className={`edge-bar__fill${positive ? ' edge-bar__fill--pos' : ''}`}
        style={{ width: `${Math.max(magnitude * 100, 4)}%` }}
      />
    </div>
  )
}

// Confidence chip: a value-conviction % from the model-vs-book discrepancy,
// tiered for colour. Shows "—" when there's no book line to compare against.
function confTier(pct: number): 'low' | 'medium' | 'high' {
  if (pct >= 60) return 'high'
  if (pct >= 30) return 'medium'
  return 'low'
}

function ConfChip({ p }: { p: Prediction }) {
  if (p.confidencePct == null) {
    return <span className="conf-chip conf-chip--low" title="No book line to compare against">—</span>
  }
  return (
    <span className={`conf-chip conf-chip--${confTier(p.confidencePct)}`} title="Edge confidence (model fair line vs book)">
      {p.confidencePct}%
    </span>
  )
}

// ---------------------------------------------------------------------------
// 1) Live Games — a card grid
// ---------------------------------------------------------------------------

export function LiveGamesDashboard({
  cards,
  predictions,
  loading,
  onSelect,
}: {
  cards: ScoreCard[]
  predictions: Record<number, Prediction>
  loading: boolean
  onSelect: (card: ScoreCard) => void
}) {
  const liveCount = cards.filter((c) => c.statusCode === 'L').length
  const finalCount = cards.filter((c) => c.statusCode === 'F').length

  return (
    <div className="dash">
      <DashHeader
        icon={<Flash width={20} height={20} />}
        title="Live Games"
        subtitle="Every game on today's slate — live score, inning, base state, and odds."
        stats={[
          { label: 'Games', value: String(cards.length) },
          { label: 'Live now', value: String(liveCount) },
          { label: 'Final', value: String(finalCount) },
        ]}
      />

      {cards.length === 0 ? (
        loading ? (
          <LiveGridSkeleton />
        ) : (
          <div className="dash-empty">No games on the slate yet.</div>
        )
      ) : (
        <div className="live-grid">
          {cards.map((card) => {
            // Same elements as the sidebar game item, expanded into a card:
            // matchup, live state (dot + inning + base diamond + outs) / Final /
            // odds, and the scoreline (with lead highlight) or first-pitch time.
            const isLive = card.statusCode === 'L'
            const isFinal = card.statusCode === 'F'
            const hasScore = isLive || isFinal
            const awayLeads = hasScore && card.awayScore != null && card.homeScore != null && card.awayScore > card.homeScore
            const homeLeads = hasScore && card.awayScore != null && card.homeScore != null && card.homeScore > card.awayScore
            const inningArrow = card.inningState === 'Top' || card.inningState === 'Middle' ? '▲' : '▼'
            const time = statusLabel(card).text
            return (
              <button className="live-card lgc" key={card.gamePk} onClick={() => onSelect(card)} type="button">
                <div className="lgc-head">
                  <span className="lgc-teams">
                    {card.awayAbbreviation} <span className="lgc-at">@</span> {card.homeAbbreviation}
                  </span>
                  {hasScore ? (
                    <span className="lgc-score">
                      <span className={awayLeads ? 'lead' : ''}>{card.awayScore ?? '-'}</span>
                      <span className="lgc-dash">–</span>
                      <span className={homeLeads ? 'lead' : ''}>{card.homeScore ?? '-'}</span>
                    </span>
                  ) : (
                    <span className="lgc-time">{time}</span>
                  )}
                </div>

                <div className="lgc-sub">
                  {isLive ? (
                    <>
                      <span className="live-dot" aria-hidden="true" />
                      <span className="lgc-inning">{inningArrow}{card.inning}</span>
                      <MiniBaseballDiamond baseState={card.baseState ?? 'Bases empty'} />
                      {card.outs != null && <span className="lgc-outs">{card.outs} out</span>}
                    </>
                  ) : isFinal ? (
                    <span className="lgc-final">Final</span>
                  ) : card.homeMoneylineDisplay || card.awayMoneylineDisplay ? (
                    <span className="lgc-odds">
                      {card.awayAbbreviation} {card.awayMoneylineDisplay ?? '—'}
                      <span className="lgc-odds-sep">·</span>
                      {card.homeAbbreviation} {card.homeMoneylineDisplay ?? '—'}
                    </span>
                  ) : card.awayRecord || card.homeRecord ? (
                    <span className="lgc-odds">
                      {card.awayAbbreviation} {card.awayRecord ?? '—'}
                      <span className="lgc-odds-sep">·</span>
                      {card.homeAbbreviation} {card.homeRecord ?? '—'}
                    </span>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2) Top Edges — ranked table
// ---------------------------------------------------------------------------

export function TopEdgesDashboard({
  cards,
  predictions,
  loading,
  onSelect,
}: {
  cards: ScoreCard[]
  predictions: Record<number, Prediction>
  loading: boolean
  onSelect: (card: ScoreCard) => void
}) {
  const rows = useMemo(() => {
    return cards
      .map((card) => {
        const p = predictions[card.gamePk]
        const edge = p ? bestEdge(card, p) : null
        return edge ? { card, p: p as Prediction, edge } : null
      })
      .filter((r): r is { card: ScoreCard; p: Prediction; edge: BestEdge } => r !== null)
      .sort((a, b) => b.edge.edgePts - a.edge.edgePts)
  }, [cards, predictions])

  const positiveCount = rows.filter((r) => r.edge.edgePts > 0.05).length
  const topEdge = rows[0]?.edge.edgePts ?? null

  return (
    <div className="dash">
      <DashHeader
        icon={<GraphUp width={20} height={20} />}
        title="Top Edges"
        subtitle="Games ranked by the model's vig-free probability edge over the sportsbook line."
        stats={[
          { label: 'Priced games', value: String(rows.length) },
          { label: 'Positive edges', value: String(positiveCount) },
          { label: 'Biggest edge', value: topEdge != null ? signedPts(topEdge) : '—' },
        ]}
      />

      {rows.length === 0 ? (
        loading ? (
          <DashTableSkeleton cols={8} />
        ) : (
          <div className="dash-empty">No market odds available to compare against yet.</div>
        )
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Matchup</th>
                <th>Best value</th>
                <th className="num">Model</th>
                <th className="num">Market</th>
                <th className="edge-col">Edge</th>
                <th className="num">Proj</th>
                <th className="sp-col">Starters</th>
                <th className="num">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ card, p, edge }) => (
                <tr key={card.gamePk} onClick={() => onSelect(card)} className="dash-row">
                  <td className="matchup-cell">
                    <span className="matchup-cell__teams">{card.awayAbbreviation} @ {card.homeAbbreviation}</span>
                    <span className="matchup-cell__status">{statusLabel(card).text}</span>
                  </td>
                  <td><span className="value-pill">{edge.team}</span></td>
                  <td className="num">{pct(edge.modelProb)}</td>
                  <td className="num">{pct(edge.marketProb)}</td>
                  <td className="edge-col">
                    <div className="edge-cell">
                      <EdgeBar edgePts={edge.edgePts} />
                      <span className={`edge-cell__val${edge.edgePts > 0.05 ? ' edge-cell__val--pos' : ''}`}>{signedPts(edge.edgePts)}</span>
                    </div>
                  </td>
                  <td className="num" title="Projected total runs">{p.model.projectedTotalRuns.toFixed(1)}</td>
                  <td className="sp-col">{startersLine(p) ?? '—'}</td>
                  <td className="num"><ConfChip p={p} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 3) Odds — book vs model table (both sides per game)
// ---------------------------------------------------------------------------

export function OddsDashboard({
  cards,
  predictions,
  loading,
  onSelect,
}: {
  cards: ScoreCard[]
  predictions: Record<number, Prediction>
  loading: boolean
  onSelect: (card: ScoreCard) => void
}) {
  const priced = cards.filter((c) => predictions[c.gamePk]?.market?.homeMoneyline != null)
  const provider = priced.map((c) => predictions[c.gamePk]?.market?.provider).find(Boolean) ?? 'book'
  const avgHold = useMemo(() => {
    const holds = priced.map((c) => predictions[c.gamePk]?.market?.bookHold).filter((h): h is number => h != null)
    return holds.length ? `${((holds.reduce((a, b) => a + b, 0) / holds.length) * 100).toFixed(1)}%` : '—'
  }, [priced, predictions])

  return (
    <div className="dash">
      <DashHeader
        icon={<Dollar width={20} height={20} />}
        title="Odds Board"
        subtitle="Sportsbook moneylines converted to implied and vig-free probabilities, beside the model's fair price."
        stats={[
          { label: 'Priced games', value: String(priced.length) },
          { label: 'Source', value: String(provider) },
          { label: 'Avg hold', value: avgHold },
        ]}
      />

      {priced.length === 0 ? (
        loading ? (
          <DashTableSkeleton cols={7} />
        ) : (
          <div className="dash-empty">No sportsbook odds available yet.</div>
        )
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table odds-table">
            <thead>
              <tr>
                <th>Game</th>
                <th>Team</th>
                <th className="num">Book</th>
                <th className="num">Implied</th>
                <th className="num">No-vig</th>
                <th className="num">Model</th>
                <th className="num">Fair</th>
              </tr>
            </thead>
            <tbody>
              {priced.map((card) => {
                const p = predictions[card.gamePk]
                const m = p.market!
                const homeImplied = m.homeMoneyline != null ? americanToImplied(m.homeMoneyline) : null
                const awayImplied = m.awayMoneyline != null ? americanToImplied(m.awayMoneyline) : null
                const hold = m.bookHold != null ? `${(m.bookHold * 100).toFixed(1)}%` : '—'
                return (
                  <Fragment key={card.gamePk}>
                    <tr onClick={() => onSelect(card)} className="dash-row dash-row--group-top">
                      <td rowSpan={2} className="matchup-cell matchup-cell--span">
                        <span className="matchup-cell__teams">{card.awayAbbreviation} @ {card.homeAbbreviation}</span>
                        <span className="matchup-cell__status">{statusLabel(card).text}</span>
                        <span className="matchup-cell__hold">hold {hold}</span>
                      </td>
                      <OddsSideCells
                        team={card.awayAbbreviation ?? p.awayAbbreviation}
                        book={m.awayMoneylineDisplay}
                        implied={awayImplied}
                        noVig={m.awayNoVigProbability}
                        model={p.model.awayWinProbability}
                        fair={p.model.fairAwayMoneylineDisplay}
                      />
                    </tr>
                    <tr onClick={() => onSelect(card)} className="dash-row dash-row--group-bottom">
                      <OddsSideCells
                        team={card.homeAbbreviation ?? p.homeAbbreviation}
                        book={m.homeMoneylineDisplay}
                        implied={homeImplied}
                        noVig={m.homeNoVigProbability}
                        model={p.model.homeWinProbability}
                        fair={p.model.fairHomeMoneylineDisplay}
                      />
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// The per-team cells of an odds row (the game cell with rowSpan is emitted by
// the parent). Model probability is tinted green when it beats the book's
// vig-free number for that side.
function OddsSideCells({
  team,
  book,
  implied,
  noVig,
  model,
  fair,
}: {
  team: string
  book: string | null
  implied: number | null
  noVig: number | null
  model: number
  fair: string
}) {
  const edge = noVig != null ? model - noVig : null
  return (
    <>
      <td className="team-cell">{team}</td>
      <td className="num">{book ?? '—'}</td>
      <td className="num">{pct(implied)}</td>
      <td className="num">{pct(noVig)}</td>
      <td className={`num${edge != null && edge > 0.005 ? ' num--pos' : ''}`}>{pct(model)}</td>
      <td className="num">{fair}</td>
    </>
  )
}

function americanToImplied(odds: number): number {
  return odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100)
}
