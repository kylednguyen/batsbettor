import type { Prediction } from '../types'
import { PredictionCard } from './PredictionCard'
import { OddsCard } from './OddsCard'
import { EdgeCard } from './EdgeCard'

interface ModelInsightsProps {
  prediction: Prediction | null
  loading: boolean
  error?: string
}

export function ModelInsights({ prediction, loading, error }: ModelInsightsProps) {
  if (loading && !prediction) {
    return (
      <div className="model-insights">
        <p className="section-label">Model insights</p>
        <p className="model-insights__status">Crunching the model…</p>
      </div>
    )
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

  // Concluded games: live win probability / projections / edge are no longer
  // meaningful, and the scorebug below already shows the final result — so the
  // live insight cards are simply omitted (no redundant "Final" card here).
  if (prediction.statusCode === 'F') return null

  return (
    <div className="model-insights">
      <div className="model-insights__grid">
        <PredictionCard prediction={prediction} />
        <OddsCard prediction={prediction} />
        <EdgeCard prediction={prediction} />
      </div>
      {prediction.drivers.length > 0 ? (
        <p className="model-insights__why">{prediction.drivers.join(' ')}</p>
      ) : null}
    </div>
  )
}
