const MLB_STATS_ORIGIN = 'https://statsapi.mlb.com'
const ODDS_API_ORIGIN = 'https://api.the-odds-api.com'
const ODDS_API_SPORT_KEY = 'baseball_mlb'
const ODDS_API_REGION = process.env.ODDS_API_REGION || 'us'
const ODDS_API_MARKETS = 'h2h'
const ODDS_API_BOOKMAKER = process.env.ODDS_API_BOOKMAKER || ''
const ODDS_API_KEY = process.env.ODDS_API_KEY || ''

export interface ScoreCard {
  gamePk: number | null
  gameDate: string | null
  matchup: string
  awayTeam: string | null
  homeTeam: string | null
  awayAbbreviation: string
  homeAbbreviation: string
  awayRecord: string | null
  homeRecord: string | null
  status: string | null
  statusCode: string | null
  score: string
  awayScore: number | null
  homeScore: number | null
  inning: string | null
  inningState: string | null
  outs: number | null
  count: string | null
  baseState: string | null
  oddsProvider: string | null
  homeMoneyline: number | null
  awayMoneyline: number | null
  homeMoneylineDisplay: string | null
  awayMoneylineDisplay: string | null
  oddsLastUpdate: string | null
  feedError?: string
}

export interface ScoreBox {
  gamePk: number | null
  matchup: string | null
  status: string | null
  score: string | null
  baseState: string | null
  count: string | null
  outs: number | null
}

interface OddsEntry {
  provider: string | null
  homeMoneyline: number | null
  awayMoneyline: number | null
  homeMoneylineDisplay: string | null
  awayMoneylineDisplay: string | null
  lastUpdate: string | null
}

interface OddsPayload {
  provider: string | null
  oddsByLookupKey: Map<string, OddsEntry>
}

type QueryParams = Record<string, string | number | boolean | null | undefined>

function buildUrl(path: string, query: QueryParams = {}): URL {
  const url = new URL(path, MLB_STATS_ORIGIN)
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  return url
}

function buildOddsUrl(path: string, query: QueryParams = {}): URL {
  const url = new URL(path, ODDS_API_ORIGIN)
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  return url
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`MLB Stats API ${response.status}: ${errorText}`)
  }
  return response.json()
}

function normalizeTeamName(name: unknown): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function getDateKeyFromIso(isoString: string | null | undefined): string | null {
  if (!isoString) return null
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return null
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(date)
}

function buildOddsLookupKey({ awayTeam, homeTeam, gameDate }: {
  awayTeam: unknown
  homeTeam: unknown
  gameDate: string | null | undefined
}): string {
  const dateKey = getDateKeyFromIso(gameDate) ?? gameDate ?? ''
  return `${normalizeTeamName(awayTeam)}::${normalizeTeamName(homeTeam)}::${dateKey}`
}

function formatAmericanOdds(price: number | null | undefined): string | null {
  if (price === null || price === undefined || Number.isNaN(Number(price))) return null
  const numeric = Number(price)
  return numeric > 0 ? `+${numeric}` : `${numeric}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickPreferredBookmaker(bookmakers: any[] = []): any {
  if (!Array.isArray(bookmakers) || bookmakers.length === 0) return null
  if (ODDS_API_BOOKMAKER) {
    return bookmakers.find((b) => b?.key === ODDS_API_BOOKMAKER) ?? bookmakers[0]
  }
  return bookmakers[0]
}

export async function getCurrentMlbOdds(): Promise<OddsPayload> {
  if (!ODDS_API_KEY) {
    return { provider: null, oddsByLookupKey: new Map() }
  }

  const url = buildOddsUrl(`/v4/sports/${ODDS_API_SPORT_KEY}/odds`, {
    apiKey: ODDS_API_KEY,
    regions: ODDS_API_REGION,
    markets: ODDS_API_MARKETS,
    oddsFormat: 'american',
  })

  const payload = await fetchJson(url) as unknown[]
  const oddsByLookupKey = new Map<string, OddsEntry>()

  for (const event of payload ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = event as Record<string, any>
    const bookmaker = pickPreferredBookmaker(e?.bookmakers)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const market = bookmaker?.markets?.find((item: any) => item?.key === 'h2h')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcomes: any[] = market?.outcomes ?? []
    const homeOutcome = outcomes.find((o) => o?.name === e?.home_team) ?? null
    const awayOutcome = outcomes.find((o) => o?.name === e?.away_team) ?? null
    const lookupKey = buildOddsLookupKey({
      awayTeam: e?.away_team,
      homeTeam: e?.home_team,
      gameDate: e?.commence_time,
    })

    oddsByLookupKey.set(lookupKey, {
      provider: bookmaker?.title ?? null,
      homeMoneyline: homeOutcome?.price ?? null,
      awayMoneyline: awayOutcome?.price ?? null,
      homeMoneylineDisplay: formatAmericanOdds(homeOutcome?.price),
      awayMoneylineDisplay: formatAmericanOdds(awayOutcome?.price),
      lastUpdate: market?.last_update ?? bookmaker?.last_update ?? null,
    })
  }

  return { provider: 'The Odds API', oddsByLookupKey }
}

export async function getMlbOddsByDate({ date }: { date: string }) {
  const oddsPayload = await getCurrentMlbOdds()
  const odds = [...oddsPayload.oddsByLookupKey.entries()]
    .filter(([lookupKey]) => lookupKey.endsWith(`::${date}`))
    .map(([, value]) => value)

  return { date, provider: oddsPayload.provider, odds }
}

function attachOddsToCard(card: ScoreCard, oddsLookup: OddsEntry | null | undefined): ScoreCard {
  if (!oddsLookup) return card
  return {
    ...card,
    oddsProvider: oddsLookup.provider ?? null,
    homeMoneyline: oddsLookup.homeMoneyline ?? null,
    awayMoneyline: oddsLookup.awayMoneyline ?? null,
    homeMoneylineDisplay: oddsLookup.homeMoneylineDisplay ?? null,
    awayMoneylineDisplay: oddsLookup.awayMoneylineDisplay ?? null,
    oddsLastUpdate: oddsLookup.lastUpdate ?? null,
  }
}

export async function getScheduleByDate({ date, sportId = 1, gameType = 'R' }: { date: string; sportId?: number; gameType?: string }): Promise<unknown> {
  const url = buildUrl('/api/v1/schedule', { sportId, gameType, date })
  return fetchJson(url)
}

export async function getGameFeed({ gamePk }: { gamePk: number }): Promise<unknown> {
  const url = buildUrl(`/api/v1.1/game/${gamePk}/feed/live`)
  return fetchJson(url)
}

export function flattenGamesFromSchedule(schedulePayload: unknown): Array<{
  gamePk: number
  gameDate: string
  status: string | null
  statusCode: string | null
  homeTeam: string | null
  awayTeam: string | null
  homeAbbreviation: string | null
  awayAbbreviation: string | null
  homeScore: number | null
  awayScore: number | null
}> {
  const payload = schedulePayload as {
    dates?: Array<{
      games?: Array<{
        gamePk: number
        gameDate: string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        status?: Record<string, any>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        teams?: Record<string, any>
      }>
    }>
  } | null

  return (payload?.dates ?? []).flatMap((dateEntry) =>
    (dateEntry.games ?? []).map((game) => ({
      gamePk: game.gamePk,
      gameDate: game.gameDate,
      status: game.status?.detailedState ?? game.status?.abstractGameState ?? null,
      statusCode: game.status?.abstractGameCode ?? null,
      homeTeam: game.teams?.home?.team?.name ?? null,
      awayTeam: game.teams?.away?.team?.name ?? null,
      homeAbbreviation: game.teams?.home?.team?.abbreviation ?? null,
      awayAbbreviation: game.teams?.away?.team?.abbreviation ?? null,
      homeScore: game.teams?.home?.score ?? null,
      awayScore: game.teams?.away?.score ?? null,
    }))
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatCount(linescore: Record<string, any> | null | undefined): string | null {
  const balls = linescore?.balls
  const strikes = linescore?.strikes
  if (balls === undefined || strikes === undefined) return null
  return `${balls}-${strikes}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatBaseState(offense: Record<string, any> | null | undefined): string | null {
  if (!offense || typeof offense !== 'object') return null
  const occupied: string[] = []
  if (offense?.first) occupied.push('1st')
  if (offense?.second) occupied.push('2nd')
  if (offense?.third) occupied.push('3rd')
  return occupied.length > 0 ? occupied.join(', ') : 'Bases empty'
}

function formatScore(
  awayAbbreviation: string,
  awayScore: number | null,
  homeAbbreviation: string,
  homeScore: number | null
): string {
  if (awayScore === null || awayScore === undefined || homeScore === null || homeScore === undefined) {
    return 'Score unavailable'
  }
  return `${awayAbbreviation} ${awayScore} - ${homeAbbreviation} ${homeScore}`
}

function formatRecord(record: { wins?: number; losses?: number } | null | undefined): string | null {
  const wins = record?.wins
  const losses = record?.losses
  if (wins === null || wins === undefined || losses === null || losses === undefined) return null
  return `${wins}-${losses}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarizeGameState(feed: Record<string, any>): Partial<ScoreCard> {
  const gameData = feed?.gameData ?? {}
  const linescore = feed?.liveData?.linescore ?? {}
  const offense = linescore?.offense ?? {}
  const teams = gameData?.teams ?? {}
  const statusCode: string | null = gameData?.status?.abstractGameCode ?? null
  const isLive = statusCode === 'L'
  const isFinal = statusCode === 'F'
  const awayAbbreviation: string = teams?.away?.abbreviation ?? teams?.away?.name ?? 'Away'
  const homeAbbreviation: string = teams?.home?.abbreviation ?? teams?.home?.name ?? 'Home'
  const awayScore: number | null = linescore?.teams?.away?.runs ?? null
  const homeScore: number | null = linescore?.teams?.home?.runs ?? null
  const inningOrdinal: string | null = linescore?.currentInningOrdinal ?? null
  const halfInning: string | null = linescore?.inningHalf ?? null
  const outs: number | null = linescore?.outs ?? null

  return {
    gamePk: gameData?.game?.pk ?? null,
    status: gameData?.status?.detailedState ?? null,
    matchup: `${teams?.away?.name ?? 'Away'} @ ${teams?.home?.name ?? 'Home'}`,
    awayTeam: teams?.away?.name ?? null,
    homeTeam: teams?.home?.name ?? null,
    awayAbbreviation,
    homeAbbreviation,
    awayRecord: formatRecord(teams?.away?.record),
    homeRecord: formatRecord(teams?.home?.record),
    statusCode,
    score: formatScore(awayAbbreviation, awayScore, homeAbbreviation, homeScore),
    awayScore,
    homeScore,
    inning: isLive ? inningOrdinal : null,
    inningState:
      isLive && inningOrdinal && halfInning
        ? `${halfInning} ${inningOrdinal}`
        : isFinal
          ? 'Final'
          : gameData?.status?.detailedState ?? null,
    outs: isLive ? outs : null,
    count: isLive ? formatCount(linescore) : null,
    baseState: isLive ? formatBaseState(offense) : null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildScoreCardFromScheduleGame(game: Record<string, any>): ScoreCard {
  const homeAbbreviation: string = game?.teams?.home?.team?.abbreviation ?? game?.teams?.home?.team?.name ?? 'HOME'
  const awayAbbreviation: string = game?.teams?.away?.team?.abbreviation ?? game?.teams?.away?.team?.name ?? 'AWAY'
  const homeScore: number | null = game?.teams?.home?.score ?? null
  const awayScore: number | null = game?.teams?.away?.score ?? null

  return {
    gamePk: game?.gamePk ?? null,
    gameDate: game?.gameDate ?? null,
    matchup: `${game?.teams?.away?.team?.name ?? 'Away'} @ ${game?.teams?.home?.team?.name ?? 'Home'}`,
    awayTeam: game?.teams?.away?.team?.name ?? null,
    homeTeam: game?.teams?.home?.team?.name ?? null,
    awayAbbreviation,
    homeAbbreviation,
    awayRecord: formatRecord(game?.teams?.away?.leagueRecord),
    homeRecord: formatRecord(game?.teams?.home?.leagueRecord),
    status: game?.status?.detailedState ?? game?.status?.abstractGameState ?? null,
    statusCode: game?.status?.abstractGameCode ?? null,
    score: formatScore(awayAbbreviation, awayScore, homeAbbreviation, homeScore),
    awayScore,
    homeScore,
    inning: null,
    inningState: game?.status?.detailedState ?? null,
    outs: null,
    count: null,
    baseState: null,
    oddsProvider: null,
    homeMoneyline: null,
    awayMoneyline: null,
    homeMoneylineDisplay: null,
    awayMoneylineDisplay: null,
    oddsLastUpdate: null,
  }
}

export async function getLiveScoreCardsByDate({ date, gameType = 'R' }: { date: string; gameType?: string }) {
  const schedulePayload = await getScheduleByDate({ date, gameType })
  const sp = schedulePayload as { dates?: Array<{ games?: unknown[] }> } | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scheduledGames: any[] = (sp?.dates ?? []).flatMap((dateEntry) => dateEntry.games ?? [])
  let oddsLookupMap = new Map<string, OddsEntry>()
  let oddsProvider: string | null = null

  try {
    const oddsPayload = await getCurrentMlbOdds()
    oddsLookupMap = oddsPayload.oddsByLookupKey
    oddsProvider = oddsPayload.provider
  } catch (_error) {
    oddsProvider = null
  }

  const cards: ScoreCard[] = await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scheduledGames.map(async (game: any) => {
      const fallbackCard = buildScoreCardFromScheduleGame(game)
      const oddsLookup = oddsLookupMap.get(
        buildOddsLookupKey({
          awayTeam: game?.teams?.away?.team?.name,
          homeTeam: game?.teams?.home?.team?.name,
          gameDate: game?.gameDate,
        })
      )

      try {
        const feed = await getGameFeed({ gamePk: game.gamePk })
        return attachOddsToCard({
          ...fallbackCard,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...summarizeGameState(feed as Record<string, any>),
          gameDate: game?.gameDate ?? fallbackCard.gameDate,
        } as ScoreCard, oddsLookup)
      } catch (error) {
        return attachOddsToCard({
          ...fallbackCard,
          feedError: (error as Error).message,
        }, oddsLookup)
      }
    })
  )

  return {
    date,
    oddsProvider,
    totalGames: cards.length,
    gamesInProgress: cards.filter((card) => card.statusCode === 'L').length,
    cards,
  }
}

export function buildFeaturedGameSummary(cards: ScoreCard[]): ScoreBox | null {
  const featured =
    cards.find((card) => card.statusCode === 'L') ??
    cards.find((card) => card.statusCode === 'P') ??
    cards[0] ??
    null

  if (!featured) return null

  return {
    gamePk: featured.gamePk,
    matchup: featured.matchup,
    status: featured.inningState ?? featured.status,
    score: featured.score,
    baseState: featured.baseState,
    count: featured.count,
    outs: featured.outs,
  }
}
