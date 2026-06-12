export function americanToImpliedProb(odds: number): number {
  if (odds < 0) {
    return Math.abs(odds) / (Math.abs(odds) + 100)
  }
  return 100 / (odds + 100)
}

export function impliedProbToAmerican(prob: number): number {
  if (prob <= 0 || prob >= 1) {
    throw new Error('Probability must be strictly between 0 and 1')
  }
  if (prob >= 0.5) {
    return Math.round((-100 * prob) / (1 - prob))
  }
  return Math.round((100 * (1 - prob)) / prob)
}

export function removeVigTwoWay(probA: number, probB: number): [number, number] {
  const total = probA + probB
  return [probA / total, probB / total]
}

export function formatAmericanOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`
}

// Translate a model win probability into book-style odds: the fair line
// (no hold) plus what a book would post at typical hold levels.
export interface ProbabilityTranslation {
  probability: number
  percentDisplay: string
  fairAmerican: number
  fairAmericanDisplay: string
  withTypicalHold: {
    holdPercent: number
    american: number
    americanDisplay: string
  }
}

const TYPICAL_BOOK_HOLD = 0.045

export function translateProbability(prob: number): ProbabilityTranslation {
  if (prob <= 0 || prob >= 1) {
    throw new Error('Probability must be strictly between 0 and 1')
  }
  const fairAmerican = impliedProbToAmerican(prob)
  // Books split the hold across both sides; half lands on this outcome.
  const juiced = Math.min(prob + TYPICAL_BOOK_HOLD / 2, 0.999)
  const juicedAmerican = impliedProbToAmerican(juiced)

  return {
    probability: prob,
    percentDisplay: `${(prob * 100).toFixed(1)}%`,
    fairAmerican,
    fairAmericanDisplay: formatAmericanOdds(fairAmerican),
    withTypicalHold: {
      holdPercent: TYPICAL_BOOK_HOLD * 100,
      american: juicedAmerican,
      americanDisplay: formatAmericanOdds(juicedAmerican),
    },
  }
}

export interface MoneylineTranslation {
  homeRawImplied: number
  awayRawImplied: number
  homeNoVig: number
  awayNoVig: number
  bookHold: number
}

export function translateMoneyline(homeOdds: number, awayOdds: number): MoneylineTranslation {
  const homeRawImplied = americanToImpliedProb(homeOdds)
  const awayRawImplied = americanToImpliedProb(awayOdds)
  const [homeNoVig, awayNoVig] = removeVigTwoWay(homeRawImplied, awayRawImplied)

  return {
    homeRawImplied,
    awayRawImplied,
    homeNoVig,
    awayNoVig,
    bookHold: homeRawImplied + awayRawImplied - 1,
  }
}
