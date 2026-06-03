// Odds math utilities: convert between American odds and probabilities,
// strip the bookmaker vig, and translate model probabilities into fair prices.

export function americanToImpliedProb(odds: number): number {
  if (odds < 0) {
    return Math.abs(odds) / (Math.abs(odds) + 100)
  }
  return 100 / (odds + 100)
}

export function impliedProbToAmerican(prob: number): number {
  if (prob <= 0 || prob >= 1) {
    throw new Error('Probability must be between 0 and 1')
  }
  if (prob >= 0.5) {
    return Math.round((-100 * prob) / (1 - prob))
  }
  return Math.round((100 * (1 - prob)) / prob)
}

export function formatAmerican(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`
}

export function removeVigTwoWay(probA: number, probB: number): [number, number] {
  const total = probA + probB
  if (total <= 0) return [0.5, 0.5]
  return [probA / total, probB / total]
}

export interface MoneylineTranslation {
  homeRawImplied: number
  awayRawImplied: number
  homeNoVig: number
  awayNoVig: number
  bookHold: number
}

// Convert a two-way moneyline market into raw implied and no-vig probabilities.
export function translateMoneyline(
  homeOdds: number,
  awayOdds: number
): MoneylineTranslation {
  const homeRaw = americanToImpliedProb(homeOdds)
  const awayRaw = americanToImpliedProb(awayOdds)
  const [homeNoVig, awayNoVig] = removeVigTwoWay(homeRaw, awayRaw)

  return {
    homeRawImplied: homeRaw,
    awayRawImplied: awayRaw,
    homeNoVig,
    awayNoVig,
    bookHold: homeRaw + awayRaw - 1,
  }
}
