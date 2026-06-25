import type { Prediction } from '../types'
import { buildModelOutput } from '../modelOutput'
import { ModelInsightsSkeleton } from './Skeleton'

interface ModelInsightsProps {
  prediction: Prediction | null
  loading: boolean
  error?: string
}

// Compact model summary for the Overview tab — links into the full Model tab.
export function ModelTakeaway({
  prediction,
  onViewModel,
}: {
  prediction: Prediction | null
  onViewModel: () => void
}) {
  if (!prediction || prediction.statusCode === 'F') return null
  const { livePrediction, valueBet, summary } = buildModelOutput(prediction)

  return (
    <article className="insight-card model-takeaway">
      <p className="section-label">Model takeaway</p>
      <p className="model-takeaway__headline">{summary.headline}</p>
      <div className="model-takeaway__stats">
        <div>
          <span>Win prob</span>
          <strong>{livePrediction.winProbability}%</strong>
        </div>
        {valueBet ? (
          <div>
            <span>Edge</span>
            <strong className={valueBet.edgePts >= 1 ? 'edge-pos' : ''}>
              {valueBet.edgePts >= 0 ? '+' : ''}
              {valueBet.edgePts} pts
            </strong>
          </div>
        ) : null}
        {valueBet ? (
          <div>
            <span>Status</span>
            <strong>{valueBet.status}</strong>
          </div>
        ) : null}
        {valueBet ? (
          <div>
            <span>Confidence</span>
            <strong>{valueBet.confidence}</strong>
          </div>
        ) : null}
      </div>
      <button className="model-takeaway__btn" onClick={onViewModel} type="button">
        View model details →
      </button>
    </article>
  )
}

export function ModelInsights({ prediction, loading, error }: ModelInsightsProps) {
  if (loading && !prediction) {
    return <ModelInsightsSkeleton />
  }

  if (error && !prediction) {
    return (
      <div className="model-insights">
        <p className="section-label">Model insights</p>
        <p className="model-insights__status">{error}</p>
      </div>
    )
  }

  if (!prediction) return null

  // Concluded games: live win probability / value are no longer meaningful.
  if (prediction.statusCode === 'F') {
    return (
      <div className="model-insights">
        <p className="preview-note">
          This game is final ({prediction.score}). Live model output is no longer available — see Box
          Score and Feed for the result.
        </p>
      </div>
    )
  }

  const { livePrediction, valueBet, summary } = buildModelOutput(prediction)

  return (
    <div className="model-insights">
      <div className="model-insights__grid">
        {/* Card 1 — Most likely outcome */}
        <article className="insight-card red-card">
          <p className="section-label">Most likely outcome</p>
          <p className="insight-card__headline">{livePrediction.mostLikelyWinner} wins</p>
          <div className="metric-row">
            <span>Win probability</span>
            <strong>{livePrediction.winProbability}%</strong>
          </div>
          <div className="metric-row">
            <span>Projected final</span>
            <strong>{livePrediction.projectedFinalText}</strong>
          </div>
          <div className="metric-row">
            <span>Projected total</span>
            <strong>{livePrediction.projectedTotal} runs</strong>
          </div>
        </article>

        {/* Card 2 — Best value */}
        {valueBet ? (
          <article className="insight-card blue-card">
            <div className="insight-card__title-row">
              <p className="section-label">Best value</p>
              <span className={`value-status value-status--${valueBet.status.toLowerCase()}`}>
                {valueBet.status}
              </span>
            </div>
            <p className="insight-card__headline">
              {valueBet.team} {valueBet.bookOdds}
            </p>
            <div className="metric-row">
              <span>Book implied</span>
              <strong>{valueBet.bookImplied}%</strong>
            </div>
            <div className="metric-row">
              <span>Model probability</span>
              <strong>{valueBet.modelProbability}%</strong>
            </div>
            <div className="metric-row">
              <span>Edge</span>
              <strong className={valueBet.edgePts >= 1 ? 'edge-pos' : ''}>
                {valueBet.edgePts >= 0 ? '+' : ''}
                {valueBet.edgePts} pts
              </strong>
            </div>
            <div className="metric-row">
              <span>Fair odds</span>
              <strong>{valueBet.fairOdds}</strong>
            </div>
            <div className="metric-row">
              <span>Confidence</span>
              <strong>{valueBet.confidence}</strong>
            </div>
          </article>
        ) : (
          <article className="insight-card blue-card">
            <p className="section-label">Best value</p>
            <p className="model-insights__status">No sportsbook odds available for this game.</p>
          </article>
        )}

        {/* Card 3 — Why */}
        <article className="insight-card">
          <p className="section-label">Why</p>
          <p className="why-headline">{summary.headline}</p>
          <ul className="why-list">
            {summary.explanation.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </article>
      </div>
    </div>
  )
}
