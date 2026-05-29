const MLB_STATS_ORIGIN = 'https://statsapi.mlb.com'
const ODDS_API_ORIGIN = 'https://api.the-odds-api.com'
const ODDS_API_SPORT_KEY = 'baseball_mlb'
const ODDS_API_REGION = process.env.ODDS_API_REGION || 'us'
const ODDS_API_MARKETS = 'h2h'
const ODDS_API_BOOKMAKER = process.env.ODDS_API_BOOKMAKER || ''
const ODDS_API_KEY = process.env.ODDS_API_KEY || ''

function buildUrl(path, query = {}) {
  const url = new URL(path, MLB_STATS_ORIGIN)
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  return url
}

function buildOddsUrl(path, query = {}) {
  const url = new URL(path, ODDS_API_ORIGIN)
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  return url
}

async function fetchJson(url) {
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

function normalizeTeamName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function getDateKeyFromIso(isoString) {
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

function buildOddsLookupKey({ awayTeam, homeTeam, gameDate }) {
  const dateKey = getDateKeyFromIso(gameDate) ?? gameDate ?? ''
  return `${normalizeTeamName(awayTeam)}::${normalizeTeamName(homeTeam)}::${dateKey}`
}

function formatAmericanOdds(price) {
  if (price === null || price === undefined || Number.isNaN(Number(price))) return null
  const numeric = Number(price)
  return numeric > 0 ? `+${numeric}` : `${numeric}`
}

function pickPreferredBookmaker(bookmakers = []) {
  if (!Array.isArray(bookmakers) || bookmakers.length === 0) return null
  if (ODDS_API_BOOKMAKER) {
    return bookmakers.find((bookmaker) => bookmaker?.key === ODDS_API_BOOKMAKER) ?? bookmakers[0]
  }
  return bookmakers[0]
}

export async function getCurrentMlbOdds() {
  if (!ODDS_API_KEY) {
    return {
      provider: null,
      oddsByLookupKey: new Map(),
    }
  }

  const url = buildOddsUrl(`/v4/sports/${ODDS_API_SPORT_KEY}/odds`, {
    apiKey: ODDS_API_KEY,
    regions: ODDS_API_REGION,
    markets: ODDS_API_MARKETS,
    oddsFormat: 'american',
  })

  const payload = await fetchJson(url)
  const oddsByLookupKey = new Map()

  for (const event of payload ?? []) {
    const bookmaker = pickPreferredBookmaker(event?.bookmakers)
    const market = bookmaker?.markets?.find((item) => item?.key === 'h2h')
    const outcomes = market?.outcomes ?? []
    const homeOutcome = outcomes.find((outcome) => outcome?.name === event?.home_team) ?? null
    const awayOutcome = outcomes.find((outcome) => outcome?.name === event?.away_team) ?? null
    const lookupKey = buildOddsLookupKey({
      awayTeam: event?.away_team,
      homeTeam: event?.home_team,
      gameDate: event?.commence_time,
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

  return {
    provider: 'The Odds API',
    oddsByLookupKey,
  }
}

export async function getMlbOddsByDate({ date }) {
  const oddsPayload = await getCurrentMlbOdds()
  const odds = [...oddsPayload.oddsByLookupKey.entries()]
    .filter(([lookupKey]) => lookupKey.endsWith(`::${date}`))
    .map(([, value]) => value)

  return {
    date,
    provider: oddsPayload.provider,
    odds,
  }
}

function attachOddsToCard(card, oddsLookup) {
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

export async function getScheduleByDate({ date, sportId = 1, gameType = 'R' }) {
  const url = buildUrl('/api/v1/schedule', { sportId, gameType, date })
  return fetchJson(url)
}

export async function getGameFeed({ gamePk }) {
  const url = buildUrl(`/api/v1.1/game/${gamePk}/feed/live`)
  return fetchJson(url)
}

export function flattenGamesFromSchedule(schedulePayload) {
  return (schedulePayload?.dates ?? []).flatMap((dateEntry) =>
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

function formatCount(linescore) {
  const balls = linescore?.balls
  const strikes = linescore?.strikes
  if (balls === undefined || strikes === undefined) return null
  return `${balls}-${strikes}`
}

function formatBaseState(offense) {
  if (!offense || typeof offense !== 'object') return null
  const occupied = []
  if (offense?.first) occupied.push('1st')
  if (offense?.second) occupied.push('2nd')
  if (offense?.third) occupied.push('3rd')
  return occupied.length > 0 ? occupied.join(', ') : 'Bases empty'
}

function formatScore(awayAbbreviation, awayScore, homeAbbreviation, homeScore) {
  if (awayScore === null || awayScore === undefined || homeScore === null || homeScore === undefined) {
    return 'Score unavailable'
  }
  return `${awayAbbreviation} ${awayScore} - ${homeAbbreviation} ${homeScore}`
}

function formatRecord(record) {
  const wins = record?.wins
  const losses = record?.losses
  if (wins === null || wins === undefined || losses === null || losses === undefined) return null
  return `${wins}-${losses}`
}

function summarizeGameState(feed) {
  const gameData = feed?.gameData ?? {}
  const linescore = feed?.liveData?.linescore ?? {}
  const offense = linescore?.offense ?? {}
  const teams = gameData?.teams ?? {}
  const statusCode = gameData?.status?.abstractGameCode ?? null
  const isLive = statusCode === 'L'
  const isFinal = statusCode === 'F'
  const awayAbbreviation = teams?.away?.abbreviation ?? teams?.away?.name ?? 'Away'
  const homeAbbreviation = teams?.home?.abbreviation ?? teams?.home?.name ?? 'Home'
  const awayScore = linescore?.teams?.away?.runs ?? null
  const homeScore = linescore?.teams?.home?.runs ?? null
  const inningOrdinal = linescore?.currentInningOrdinal ?? null
  const halfInning = linescore?.inningHalf ?? null
  const outs = linescore?.outs ?? null

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

export function buildScoreCardFromScheduleGame(game) {
  const homeAbbreviation = game?.teams?.home?.team?.abbreviation ?? game?.teams?.home?.team?.name ?? 'HOME'
  const awayAbbreviation = game?.teams?.away?.team?.abbreviation ?? game?.teams?.away?.team?.name ?? 'AWAY'
  const homeScore = game?.teams?.home?.score ?? null
  const awayScore = game?.teams?.away?.score ?? null

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

export async function getLiveScoreCardsByDate({ date, gameType = 'R' }) {
  const schedulePayload = await getScheduleByDate({ date, gameType })
  const scheduledGames = (schedulePayload?.dates ?? []).flatMap((dateEntry) => dateEntry.games ?? [])
  let oddsLookupMap = new Map()
  let oddsProvider = null

  try {
    const oddsPayload = await getCurrentMlbOdds()
    oddsLookupMap = oddsPayload.oddsByLookupKey
    oddsProvider = oddsPayload.provider
  } catch (error) {
    oddsProvider = null
  }

  const cards = await Promise.all(
    scheduledGames.map(async (game) => {
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
          ...summarizeGameState(feed),
          gameDate: game?.gameDate ?? fallbackCard.gameDate,
        }, oddsLookup)
      } catch (error) {
        return attachOddsToCard({
          ...fallbackCard,
          feedError: error.message,
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

export function buildFeaturedGameSummary(cards) {
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
