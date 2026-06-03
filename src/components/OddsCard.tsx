import type { Prediction } from '../types'

function pct(value: number | null): string {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`
}

export function OddsCard({ prediction }: { prediction: Prediction }) {
  const { market, model, homeAbbreviation } = prediction

  return (
    <article className="insight-card blue-card">
      <p className="section-label">Odds translation</p>
      <div className="metric-row">
        <span>Book odds</span>
        <strong>
          {market?.homeMoneylineDisplay
            ? `${homeAbbreviation} ${market.homeMoneylineDisplay}`
            : 'No market'}
        </strong>
      </div>
      <div className="metric-row">
        <span>No-vig probability</span>
        <strong>{pct(market?.homeNoVigProbability ?? null)}</strong>
      </div>
      <div className="metric-row">
        <span>Model fair odds</span>
        <strong>
          {homeAbbreviation} {model.fairHomeMoneylineDisplay}
        </strong>
      </div>
    </article>
  )
}
