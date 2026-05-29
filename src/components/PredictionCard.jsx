export function PredictionCard() {
  return (
    <article className="insight-card red-card">
      <p className="section-label">Live prediction</p>
      <div className="metric-row">
        <span>Win probability</span>
        <strong>Yankees 68.1%</strong>
      </div>
      <div className="metric-row">
        <span>Projected final</span>
        <strong>5.1 - 3.9</strong>
      </div>
      <div className="metric-row">
        <span>Projected total</span>
        <strong>9.0 runs</strong>
      </div>
    </article>
  )
}
