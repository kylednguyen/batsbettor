import type { Prediction } from '../types'

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} pts`
}

export function EdgeCard({ prediction }: { prediction: Prediction }) {
  const { edge, homeAbbreviation, awayAbbreviation, confidence } = prediction

  if (!edge) {
    return (
      <article className="insight-card edge-card">
        <p className="section-label">Model vs book edge</p>
        <div className="metric-row">
          <span>Edge</span>
          <strong>No market</strong>
        </div>
        <p>No sportsbook odds available for this game, so model-vs-market edge can't be computed.</p>
      </article>
    )
  }

  const homeFavored = edge.homeProbabilityEdge >= edge.awayProbabilityEdge
  const leanTeam = homeFavored ? homeAbbreviation : awayAbbreviation
  const leanValue = homeFavored ? edge.homeProbabilityEdge : edge.awayProbabilityEdge

  return (
    <article className="insight-card edge-card">
      <p className="section-label">Model vs book edge</p>
      <div className="metric-row">
        <span>{homeAbbreviation}</span>
        <strong>{signed(edge.homeProbabilityEdge)}</strong>
      </div>
      <div className="metric-row">
        <span>{awayAbbreviation}</span>
        <strong>{signed(edge.awayProbabilityEdge)}</strong>
      </div>
      <p>
        Model leans {leanTeam} by {Math.abs(leanValue).toFixed(1)} pts vs the market. Confidence:{' '}
        {confidence}.
      </p>
    </article>
  )
}
