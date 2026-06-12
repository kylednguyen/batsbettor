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
