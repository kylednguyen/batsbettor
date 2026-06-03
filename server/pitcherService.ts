// Probable starting pitcher pipeline.
//
// Pulls each game's probable starters and their season pitching stats from MLB
// StatsAPI, then derives an explainable quality score (expected runs allowed
// per 9, blending ERA and FIP). This feeds the prediction's pregame prior and
// the chatbot's explanations. Fails soft: missing data returns null.

import { getPersonSeasonPitching } from './mlbStatsService.js'

const LEAGUE_AVG_RA9 = 4.3 // fallback when a pitcher has little/no data
const FIP_CONSTANT = 3.15

export interface PitcherProfile {
  id: number
  name: string
  era: number | null
  whip: number | null
  fip: number | null
  k9: number | null
  bb9: number | null
  inningsPitched: number
  gamesStarted: number
  // Expected runs allowed per 9 innings (lower is better). Blends ERA + FIP.
  expectedRA9: number
}

// Parse MLB innings-pitched notation ("98.1" => 98 + 1/3).
function parseInnings(ip: unknown): number {
  const text = String(ip ?? '0')
  const [whole, frac] = text.split('.')
  const outs = frac === '1' ? 1 / 3 : frac === '2' ? 2 / 3 : 0
  return (Number(whole) || 0) + outs
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const cache = new Map<string, { fetchedAt: number; profile: PitcherProfile | null }>()
const TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

export async function getPitcherProfile(
  id: number,
  name: string,
  season: number
): Promise<PitcherProfile | null> {
  if (!id) return null
  const key = `${id}:${season}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.profile

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = (await getPersonSeasonPitching({ personId: id, season })) as any
    const stat = payload?.people?.[0]?.stats?.[0]?.splits?.[0]?.stat
    const person = payload?.people?.[0]

    const ip = parseInnings(stat?.inningsPitched)
    const era = num(stat?.era)
    const whip = num(stat?.whip)
    const k = num(stat?.strikeOuts)
    const bb = num(stat?.baseOnBalls)
    const hr = num(stat?.homeRuns)
    const gs = num(stat?.gamesStarted) ?? 0

    // FIP = (13*HR + 3*BB - 2*K) / IP + constant (HBP omitted).
    const fip =
      ip > 0 && hr != null && bb != null && k != null
        ? (13 * hr + 3 * bb - 2 * k) / ip + FIP_CONSTANT
        : null
    const k9 = ip > 0 && k != null ? (k * 9) / ip : null
    const bb9 = ip > 0 && bb != null ? (bb * 9) / ip : null

    // Expected RA9: blend ERA and FIP once a pitcher has a real sample; small
    // samples lean on FIP (more stable) and regress toward league average.
    let expectedRA9 = LEAGUE_AVG_RA9
    if (era != null && fip != null && ip >= 20) expectedRA9 = 0.5 * era + 0.5 * fip
    else if (fip != null && ip >= 10) expectedRA9 = fip
    else if (era != null && ip >= 10) expectedRA9 = era

    const profile: PitcherProfile = {
      id,
      name: person?.fullName ?? name,
      era,
      whip,
      fip: fip != null ? Math.round(fip * 100) / 100 : null,
      k9: k9 != null ? Math.round(k9 * 100) / 100 : null,
      bb9: bb9 != null ? Math.round(bb9 * 100) / 100 : null,
      inningsPitched: Math.round(ip * 10) / 10,
      gamesStarted: gs,
      expectedRA9: Math.round(expectedRA9 * 100) / 100,
    }
    cache.set(key, { fetchedAt: Date.now(), profile })
    return profile
  } catch (_error) {
    cache.set(key, { fetchedAt: Date.now(), profile: null })
    return null
  }
}

export interface ProbableStarters {
  home: PitcherProfile | null
  away: PitcherProfile | null
}

// Extract probable starter ids/names from the live feed's gameData.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getProbableStarters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  feed: Record<string, any>,
  season: number
): Promise<ProbableStarters> {
  const probable = feed?.gameData?.probablePitchers ?? {}
  const homeP = probable?.home
  const awayP = probable?.away

  const [home, away] = await Promise.all([
    homeP?.id ? getPitcherProfile(homeP.id, homeP.fullName ?? '', season) : Promise.resolve(null),
    awayP?.id ? getPitcherProfile(awayP.id, awayP.fullName ?? '', season) : Promise.resolve(null),
  ])

  return { home, away }
}
