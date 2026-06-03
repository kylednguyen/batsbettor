export function OddsCard() {
  return (
    <article className="insight-card blue-card">
      <p className="section-label">Odds translation</p>
      <div className="metric-row">
        <span>Book odds</span>
        <strong>Yankees -175</strong>
      </div>
      <div className="metric-row">
        <span>No-vig probability</span>
        <strong>62.2%</strong>
      </div>
      <div className="metric-row">
        <span>Model fair odds</span>
        <strong>Yankees -214</strong>
      </div>
    </article>
  )
}
