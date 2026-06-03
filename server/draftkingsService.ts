// DraftKings odds scraper.
//
// DraftKings exposes an unofficial JSON sportsbook API ("nash" sportscontent).
// This client pulls the MLB league feed, extracts the moneyline market for each
// game, and returns the OddsEntry shape used elsewhere so it can be a drop-in
// odds source. DraftKings geo-blocks some IPs and changes its payload shape, so
// every step fails soft and returns no odds rather than throwing — callers can
// then fall back to another odds source.
//
// Team names differ between providers (DraftKings "MIA Marlins" vs MLB
// "Miami Marlins"), so matching is done on the normalized team nickname: the
// MLB full name ends with the DraftKings nickname ("miamimarlins".endsWith
// ("marlins")), which is unique across all 30 clubs.

import { normalizeTeamName, type OddsEntry } from './mlbStatsService.js'

// MLB league id on DraftKings. Override via env if DK rotates it.
const DK_LEAGUE = process.env.DRAFTKINGS_LEAGUE || '84240'
const DK_URL =
  process.env.DRAFTKINGS_URL ||
  `https://sportsbook-nash.draftkings.com/api/sportscontent/dkusva/v1/leagues/${DK_LEAGUE}`

const DK_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Referer: 'https://sportsbook.draftkings.com/',
}

export interface DkGameOdds {
  awayNickname: string // normalized, e.g. "marlins"
  homeNickname: string
  entry: OddsEntry
}

interface DkPayload {
  provider: 'DraftKings'
  games: DkGameOdds[]
}

// Cache to avoid hammering DK on every prediction refresh.
const DK_CACHE_TTL_MS = 30_000
let dkCache: { fetchedAt: number; payload: DkPayload } | null = null

// DraftKings encodes negative odds with a unicode minus sign.
function parseAmerican(value: unknown): number | null {
  if (value == null) return null
  const cleaned = String(value).replace(/[−–—]/g, '-').replace(/[^0-9+-]/g, '')
  if (!cleaned || cleaned === '+' || cleaned === '-') return null
  const numeric = Number(cleaned)
  return Number.isFinite(numeric) ? numeric : null
}

function formatAmericanOdds(price: number | null): string | null {
  if (price == null) return null
  return price > 0 ? `+${price}` : `${price}`
}

// Reduce "MIA Marlins" / "Miami Marlins" to the normalized nickname "marlins".
function teamNickname(participant: {
  metadata?: { rosettaTeamName?: string }
  seoIdentifier?: string
  name?: string
}): string {
  const raw =
    participant?.metadata?.rosettaTeamName ?? participant?.seoIdentifier ?? participant?.name ?? ''
  return normalizeTeamName(raw)
}

const empty: DkPayload = { provider: 'DraftKings', games: [] }

export async function getDraftKingsOdds(): Promise<DkPayload> {
  if (dkCache && Date.now() - dkCache.fetchedAt < DK_CACHE_TTL_MS) {
    return dkCache.payload
  }

  try {
    const response = await fetch(DK_URL, { headers: DK_HEADERS })
    if (!response.ok) {
      dkCache = { fetchedAt: Date.now(), payload: empty }
      return empty
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = data?.events ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const markets: any[] = data?.markets ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const selections: any[] = data?.selections ?? []

    // eventId -> participants split by venue role.
    const eventMap = new Map<
      string,
      { away: string; home: string; awayNick: string; homeNick: string; startDate: string | null }
    >()
    for (const event of events) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const participants: any[] = event?.participants ?? []
      const home = participants.find((p) => p?.venueRole === 'Home')
      const away = participants.find((p) => p?.venueRole === 'Away')
      if (!home || !away) continue
      eventMap.set(String(event?.id), {
        away: away?.name ?? '',
        home: home?.name ?? '',
        awayNick: teamNickname(away),
        homeNick: teamNickname(home),
        startDate: event?.startEventDate ?? null,
      })
    }

    // Group selections by market id for quick lookup.
    const selectionsByMarket = new Map<string, any[]>()
    for (const selection of selections) {
      const marketId = String(selection?.marketId ?? '')
      if (!marketId) continue
      const list = selectionsByMarket.get(marketId)
      if (list) list.push(selection)
      else selectionsByMarket.set(marketId, [selection])
    }

    const games: DkGameOdds[] = []
    for (const market of markets) {
      const isMoneyline =
        /moneyline/i.test(market?.marketType?.name ?? '') || /moneyline/i.test(market?.name ?? '')
      if (!isMoneyline) continue

      const info = eventMap.get(String(market?.eventId))
      if (!info) continue

      const marketSelections = selectionsByMarket.get(String(market?.id)) ?? []
      let homeOdds: number | null = null
      let awayOdds: number | null = null
      for (const selection of marketSelections) {
        const price = parseAmerican(selection?.displayOdds?.american)
        if (selection?.outcomeType === 'Home') homeOdds = price
        else if (selection?.outcomeType === 'Away') awayOdds = price
      }

      if (homeOdds == null && awayOdds == null) continue

      games.push({
        awayNickname: info.awayNick,
        homeNickname: info.homeNick,
        entry: {
          provider: 'DraftKings',
          homeMoneyline: homeOdds,
          awayMoneyline: awayOdds,
          homeMoneylineDisplay: formatAmericanOdds(homeOdds),
          awayMoneylineDisplay: formatAmericanOdds(awayOdds),
          lastUpdate: info.startDate,
        },
      })
    }

    const payload: DkPayload = { provider: 'DraftKings', games }
    dkCache = { fetchedAt: Date.now(), payload }
    return payload
  } catch (_error) {
    dkCache = { fetchedAt: Date.now(), payload: empty }
    return empty
  }
}

// Look up the DraftKings moneyline for one matchup. Matches on team nickname,
// since DraftKings and MLB use different full team names and abbreviations.
export async function getDraftKingsOddsForMatchup({
  awayTeam,
  homeTeam,
}: {
  awayTeam: unknown
  homeTeam: unknown
  gameDate?: string | null
}): Promise<OddsEntry | null> {
  const payload = await getDraftKingsOdds()
  const awayNorm = normalizeTeamName(awayTeam)
  const homeNorm = normalizeTeamName(homeTeam)
  if (!awayNorm || !homeNorm) return null

  const match = payload.games.find(
    (game) =>
      game.awayNickname &&
      game.homeNickname &&
      awayNorm.endsWith(game.awayNickname) &&
      homeNorm.endsWith(game.homeNickname)
  )
  return match?.entry ?? null
}
