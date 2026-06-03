import type { Prediction } from '../types'

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function PredictionCard({ prediction }: { prediction: Prediction }) {
  const { model, homeAbbreviation, awayAbbreviation } = prediction
  const favorsHome = model.homeWinProbability >= model.awayWinProbability
  const favoredTeam = favorsHome ? homeAbbreviation : awayAbbreviation
  const favoredProb = favorsHome ? model.homeWinProbability : model.awayWinProbability

  return (
    <article className="insight-card red-card">
      <p className="section-label">Live prediction</p>
      <div className="metric-row">
        <span>Win probability</span>
        <strong>
          {favoredTeam} {pct(favoredProb)}
        </strong>
      </div>
      <div className="metric-row">
        <span>Projected final</span>
        <strong>
          {awayAbbreviation} {model.projectedAwayRuns} - {homeAbbreviation} {model.projectedHomeRuns}
        </strong>
      </div>
      <div className="metric-row">
        <span>Projected total</span>
        <strong>{model.projectedTotalRuns} runs</strong>
      </div>
    </article>
  )
}
