import type { ScoreCard } from '../types'
import { MiniBaseballDiamond } from './BaseballDiamond'

interface LiveScoreCardProps {
  card: ScoreCard
  compact?: boolean
  active?: boolean
  onSelect?: () => void
  minimal?: boolean
}

export function LiveScoreCard({ card, compact = false, active = false, onSelect, minimal = false }: LiveScoreCardProps) {
  const isLive = card.statusCode === 'L'
  const isFinal = card.statusCode === 'F'
  const hasVisibleBaseState = isLive && card.baseState && card.baseState !== 'Bases empty'
  const footerStatus =
    hasVisibleBaseState
      ? card.baseState
      : card.statusCode === 'F'
        ? 'Final'
        : card.statusCode === 'P'
          ? card.status
          : null

  const footerMeta =
    card.count ??
    (card.gameDate
      ? new Date(card.gameDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '--')

  const cardClassName = [
    'live-score-card',
    compact ? 'live-score-card--compact' : '',
    active ? 'live-score-card--active' : '',
    isLive ? 'live-score-card--live' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (minimal) {
    return (
      <button
        className={`live-score-card live-score-card--minimal${active ? ' live-score-card--active' : ''}${isLive ? ' live-score-card--live' : ''}`}
        onClick={onSelect}
        title={`${card.awayAbbreviation} @ ${card.homeAbbreviation}`}
        type="button"
      >
        <span className="live-score-card__minimal-top">
          <span>{card.awayAbbreviation}</span>
          <strong>{card.awayScore ?? '-'}</strong>
        </span>
        <span className="live-score-card__minimal-meta">
          {isFinal ? 'Final' : card.inningState || card.status}
        </span>
        <span className="live-score-card__minimal-top">
          <span>{card.homeAbbreviation}</span>
          <strong>{card.homeScore ?? '-'}</strong>
        </span>
      </button>
    )
  }

  return (
    <button className={cardClassName} onClick={onSelect} type="button">
      {!isFinal ? (
        <div className="live-score-card__topline">
          <span className={`scorebug-dot${isLive ? ' scorebug-dot--live' : ''}`} />
          <span className="live-score-card__state">{card.inningState || card.status}</span>
        </div>
      ) : null}

      <div className="live-score-card__teams">
        <div className="live-score-card__team-row">
          <span className="live-score-card__team-label">
            <span className="live-score-card__abbr">{card.awayAbbreviation}</span>
            {card.awayRecord ? <small>{card.awayRecord}</small> : null}
          </span>
          <strong>{card.awayScore ?? '-'}</strong>
        </div>
        <div className="live-score-card__team-row">
          <span className="live-score-card__team-label">
            <span className="live-score-card__abbr">{card.homeAbbreviation}</span>
            {card.homeRecord ? <small>{card.homeRecord}</small> : null}
          </span>
          <strong>{card.homeScore ?? '-'}</strong>
        </div>
      </div>

      <div className="live-score-card__footer">
        <span className="live-score-card__footer-left">
          {isLive ? <MiniBaseballDiamond baseState={card.baseState} /> : null}
          {footerStatus ? <span>{footerStatus}</span> : null}
        </span>
        <span>{footerMeta}</span>
      </div>
    </button>
  )
}
