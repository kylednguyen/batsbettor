import type { Prediction } from './types'

// Separates the two questions a betting model must answer — they are NOT the
// same and must never be collapsed into one "model leans" statement:
//   1. Most likely winner = team with the highest model win probability.
//   2. Best value bet      = side with the largest positive edge vs the book's
//                            vig-free implied probability.
// These can be different teams (e.g. KC most likely to win, MIN best value).

export interface ModelOutput {
  livePrediction: {
    mostLikelyWinner: string
    winProbability: number
    projectedFinalText: string
    projectedTotal: number
  }
  valueBet: {
    team: string
    bookOdds: string
    bookImplied: number
    modelProbability: number
    edgePts: number
    fairOdds: string
    status: 'Playable' | 'Lean' | 'Pass'
    confidence: string
  } | null
  summary: {
    headline: string
    explanation: string[]
    sameTeam: boolean
  }
}

const r1 = (n: number) => Math.round(n * 10) / 10
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`

export function buildModelOutput(p: Prediction): ModelOutput {
  const homeProb = p.model.homeWinProbability
  const awayProb = p.model.awayWinProbability
  const homeIsWinner = homeProb >= awayProb
  const winner = homeIsWinner ? p.homeAbbreviation : p.awayAbbreviation
  const winProbability = r1((homeIsWinner ? homeProb : awayProb) * 100)

  const livePrediction = {
    mostLikelyWinner: winner,
    winProbability,
    projectedFinalText: `${p.awayAbbreviation} ${p.model.projectedAwayRuns} – ${p.homeAbbreviation} ${p.model.projectedHomeRuns}`,
    projectedTotal: p.model.projectedTotalRuns,
  }

  // Best value = the side the model rates higher than the vig-free market price.
  let valueBet: ModelOutput['valueBet'] = null
  if (
    p.market &&
    p.edge &&
    p.market.homeNoVigProbability != null &&
    p.market.awayNoVigProbability != null
  ) {
    const homeIsValue = p.edge.homeProbabilityEdge >= p.edge.awayProbabilityEdge
    const edgePts = r1(homeIsValue ? p.edge.homeProbabilityEdge : p.edge.awayProbabilityEdge)
    const team = homeIsValue ? p.homeAbbreviation : p.awayAbbreviation
    const bookOdds =
      (homeIsValue ? p.market.homeMoneylineDisplay : p.market.awayMoneylineDisplay) ?? '—'
    const bookImplied = r1(
      (homeIsValue ? p.market.homeNoVigProbability : p.market.awayNoVigProbability) * 100
    )
    const modelProbability = r1((homeIsValue ? homeProb : awayProb) * 100)
    const fairOdds =
      (homeIsValue ? p.model.fairHomeMoneylineDisplay : p.model.fairAwayMoneylineDisplay) ?? '—'
    const status: 'Playable' | 'Lean' | 'Pass' =
      edgePts >= 3 ? 'Playable' : edgePts >= 1 ? 'Lean' : 'Pass'
    // Prefer the numeric value-confidence (from the model-vs-book gap); fall back
    // to the qualitative label when no book line produced a percentage.
    const confidence = p.confidencePct != null ? `${p.confidencePct}%` : p.confidence
    valueBet = { team, bookOdds, bookImplied, modelProbability, edgePts, fairOdds, status, confidence }
  }

  const sameTeam = valueBet ? valueBet.team === winner : true

  let headline: string
  if (!valueBet) {
    headline = `${winner} is the most likely winner at ${winProbability}%.`
  } else if (sameTeam) {
    headline = `${winner} is both the most likely winner and the best value.`
  } else {
    headline = `${winner} is more likely to win, but ${valueBet.team} is the better value at ${valueBet.bookOdds}.`
  }

  const explanation: string[] = [
    `${winner} has the higher live win probability at ${winProbability}%.`,
  ]
  if (valueBet) {
    explanation.push(`${valueBet.team}'s book odds imply only a ${valueBet.bookImplied}% chance to win.`)
    explanation.push(
      `The model gives ${valueBet.team} a ${valueBet.modelProbability}% chance, creating a ${signed(valueBet.edgePts)} point value gap.`
    )
    if (valueBet.fairOdds !== '—') {
      explanation.push(
        valueBet.edgePts >= 1
          ? `Because the model fair price is ${valueBet.team} ${valueBet.fairOdds}, the current ${valueBet.bookOdds} price is undervalued.`
          : `The model fair price (${valueBet.team} ${valueBet.fairOdds}) is close to the current ${valueBet.bookOdds}, so there is little edge.`
      )
    }
  }

  return { livePrediction, valueBet, summary: { headline, explanation, sameTeam } }
}
