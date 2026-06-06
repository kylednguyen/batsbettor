// Data context for the routed MLB assistant.
//
// These helpers gather real MLB StatsAPI data (today's scoreboard, a game's
// box score + scoring plays, a player's stat line today) so the LLM can answer
// scoreboard / game-summary / player-lookup questions — not just betting model
// questions. Everything is grounded; nothing is invented.

import { getSchedule, getBoxscore, getGameFeed } from '../mlbStatsService.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

// Lightweight game shape for the scoreboard/routing — built from ONE schedule
// call (hydrated with team + linescore), not a feed-per-game fetch.
export interface LiteGame {
  gamePk: number | null
  homeTeam: string | null
  awayTeam: string | null
  homeAbbreviation: string | null
  awayAbbreviation: string | null
  homeScore: number | null
  awayScore: number | null
  statusCode: string | null
  status: string | null
  inningState: string | null
}

// --- light request-scoped caches ---------------------------------------------
const CARDS_TTL = 20_000
let cardsCache: { date: string; at: number; cards: LiteGame[] } | null = null
const boxCache = new Map<number, { at: number; box: Any }>()
const BOX_TTL = 30_000

export async function getTodayCards(date: string): Promise<LiteGame[]> {
  if (cardsCache && cardsCache.date === date && Date.now() - cardsCache.at < CARDS_TTL) {
    return cardsCache.cards
  }
  const sched = (await getSchedule({ date, hydrate: 'team,linescore' })) as Any
  const games: Any[] = (sched?.dates ?? []).flatMap((d: Any) => d?.games ?? [])
  const cards: LiteGame[] = games.map((g: Any) => {
    const ls = g?.linescore ?? {}
    return {
      gamePk: g?.gamePk ?? null,
      homeTeam: g?.teams?.home?.team?.name ?? null,
      awayTeam: g?.teams?.away?.team?.name ?? null,
      homeAbbreviation: g?.teams?.home?.team?.abbreviation ?? null,
      awayAbbreviation: g?.teams?.away?.team?.abbreviation ?? null,
      homeScore: g?.teams?.home?.score ?? ls?.teams?.home?.runs ?? null,
      awayScore: g?.teams?.away?.score ?? ls?.teams?.away?.runs ?? null,
      statusCode: g?.status?.abstractGameCode ?? null,
      status: g?.status?.detailedState ?? null,
      inningState:
        ls?.inningState && ls?.currentInningOrdinal
          ? `${ls.inningState} ${ls.currentInningOrdinal}`
          : null,
    }
  })
  cardsCache = { date, at: Date.now(), cards }
  return cards
}

async function box(gamePk: number): Promise<Any> {
  const hit = boxCache.get(gamePk)
  if (hit && Date.now() - hit.at < BOX_TTL) return hit.box
  const b = await getBoxscore({ gamePk })
  boxCache.set(gamePk, { at: Date.now(), box: b })
  return b
}

function cardStatus(c: LiteGame): string {
  if (c.statusCode === 'L') return c.inningState || c.status || 'Live'
  if (c.statusCode === 'F') return 'Final'
  return c.status || 'Scheduled'
}

function cardScore(c: LiteGame): string {
  if (c.awayScore != null && c.homeScore != null) {
    return `${c.awayAbbreviation} ${c.awayScore}, ${c.homeAbbreviation} ${c.homeScore}`
  }
  return `${c.awayAbbreviation} @ ${c.homeAbbreviation}`
}

// --- scoreboard --------------------------------------------------------------
export function buildScoreboardText(cards: LiteGame[]): string {
  if (!cards.length) return 'No MLB games found for today.'
  return cards
    .map((c) => `- ${cardScore(c)} — ${cardStatus(c)}`)
    .join('\n')
}

// --- team matching -----------------------------------------------------------
export function findMatchingCards(message: string, cards: LiteGame[]): LiteGame[] {
  const m = ` ${message.toLowerCase()} `
  return cards.filter((c) => {
    const names = [c.homeTeam, c.awayTeam].filter(Boolean) as string[]
    for (const full of names) {
      const lower = full.toLowerCase()
      const parts = lower.split(' ')
      const nickname = parts[parts.length - 1]
      const city = parts.slice(0, -1).join(' ')
      if (m.includes(lower)) return true
      if (nickname.length > 3 && m.includes(nickname)) return true
      if (city.length > 3 && m.includes(city)) return true
    }
    const abbrs = [c.homeAbbreviation, c.awayAbbreviation].filter(Boolean) as string[]
    if (abbrs.some((a) => new RegExp(`\\b${a.toLowerCase()}\\b`).test(m))) return true
    return false
  })
}

// --- game summary ------------------------------------------------------------
function topBatters(team: Any): string[] {
  const players: Any = team?.players ?? {}
  const ids: number[] = team?.batters ?? []
  return ids
    .map((id) => players[`ID${id}`])
    .filter((p) => {
      const b = p?.stats?.batting
      return b && (b.hits > 0 || b.homeRuns > 0 || b.rbi > 0)
    })
    .sort((a, b) => {
      const sa = a.stats.batting.homeRuns * 3 + a.stats.batting.rbi + a.stats.batting.hits
      const sb = b.stats.batting.homeRuns * 3 + b.stats.batting.rbi + b.stats.batting.hits
      return sb - sa
    })
    .slice(0, 4)
    .map((p) => `  ${p.person.fullName}: ${p.stats.batting.summary}`)
}

function decisionPitchers(team: Any): string[] {
  const players: Any = team?.players ?? {}
  const ids: number[] = team?.pitchers ?? []
  return ids
    .map((id) => players[`ID${id}`])
    .filter((p) => p?.stats?.pitching?.inningsPitched)
    .filter((p, i) => p.stats.pitching.note || i === 0) // starter + anyone with a decision
    .slice(0, 3)
    .map((p) => `  ${p.person.fullName}: ${p.stats.pitching.summary}${p.stats.pitching.note ? ` ${p.stats.pitching.note}` : ''}`)
}

export async function buildGameSummary(gamePk: number): Promise<string> {
  try {
    const b = await box(gamePk)
    const away = b?.teams?.away
    const home = b?.teams?.home
    const awayName = away?.team?.abbreviation ?? away?.team?.name ?? 'Away'
    const homeName = home?.team?.abbreviation ?? home?.team?.name ?? 'Home'
    const awayR = away?.teamStats?.batting?.runs
    const homeR = home?.teamStats?.batting?.runs

    const lines: string[] = []
    lines.push(`Score: ${awayName} ${awayR ?? '-'}, ${homeName} ${homeR ?? '-'}`)
    const ab = topBatters(away)
    const hb = topBatters(home)
    if (ab.length) lines.push(`${awayName} batting leaders:`, ...ab)
    if (hb.length) lines.push(`${homeName} batting leaders:`, ...hb)
    const ap = decisionPitchers(away)
    const hp = decisionPitchers(home)
    if (ap.length) lines.push(`${awayName} pitching:`, ...ap)
    if (hp.length) lines.push(`${homeName} pitching:`, ...hp)

    // Scoring plays from the live feed (already-fetched data path).
    try {
      const feed: Any = await getGameFeed({ gamePk })
      const plays = feed?.liveData?.plays
      const scoringIdx: number[] = plays?.scoringPlays ?? []
      const recent = scoringIdx
        .slice(-6)
        .map((i) => plays?.allPlays?.[i]?.result?.description?.trim())
        .filter(Boolean)
      if (recent.length) lines.push('Scoring plays:', ...recent.map((d: string) => `  ${d}`))
    } catch {
      // feed optional
    }

    return lines.join('\n')
  } catch {
    return 'Box score is not available for this game yet.'
  }
}

// --- player stats over a time range (this week / season / last N games) ------
const STATS_BASE = 'https://statsapi.mlb.com/api/v1'

async function statsApi(path: string): Promise<Any> {
  const r = await fetch(`${STATS_BASE}${path}`, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`statsapi ${r.status}`)
  return r.json()
}

function shiftDate(dateString: string, deltaDays: number): string {
  const [y, m, d] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
}

const NAME_STOP = new Set(
  'what whats hows how is are was were the a an do did does done many much get got have has had play played playing pitch pitched hit hits homer homered home run runs rbi rbis strikeout strikeouts stat stats statline line numbers number this last past recent recently lately so far over season year month week weeks day days today tonight yesterday game games his her their about for of in on me tell show give good vs against and or doing look looking with going to will tomorrow next'.split(
    ' '
  )
)

function nameCandidates(message: string): string[] {
  const cleaned = message
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z\s.-]/g, ' ')
  const toks = cleaned.split(/\s+/).filter((t) => t.length > 1 && !NAME_STOP.has(t))
  const out: string[] = []
  for (let i = 0; i < toks.length - 1; i += 1) out.push(`${toks[i]} ${toks[i + 1]}`)
  for (const t of toks) out.push(t)
  for (const t of toks) if (t.endsWith('s') && t.length > 4) out.push(t.slice(0, -1))
  return [...new Set(out)].slice(0, 5)
}

interface PlayerRef {
  id: number
  name: string
  pos: string
  team: string
}

async function searchPlayer(message: string): Promise<PlayerRef | null> {
  for (const cand of nameCandidates(message)) {
    try {
      const r = await statsApi(`/people/search?names=${encodeURIComponent(cand)}`)
      const people: Any[] = r?.people ?? []
      const pick = people.find((p) => p.active) ?? people[0]
      if (pick) {
        return {
          id: pick.id,
          name: pick.fullName,
          pos: pick.primaryPosition?.abbreviation ?? '',
          team: pick.currentTeam?.abbreviation ?? pick.currentTeam?.name ?? '',
        }
      }
    } catch {
      // try next candidate
    }
  }
  return null
}

interface StatRange {
  kind: 'season' | 'dateRange' | 'lastGames'
  start?: string
  end?: string
  n?: number
  label: string
}

function parseStatRange(message: string, today: string): StatRange {
  const m = ` ${message.toLowerCase()} `
  const lastGames = m.match(/last (\d+) games?/)
  if (lastGames) return { kind: 'lastGames', n: Math.min(Number(lastGames[1]) || 10, 25), label: `last ${lastGames[1]} games` }
  const lastDays = m.match(/last (\d+) days?/)
  if (lastDays) {
    const n = Math.min(Number(lastDays[1]) || 7, 60)
    return { kind: 'dateRange', start: shiftDate(today, -(n - 1)), end: today, label: `last ${n} days` }
  }
  if (/this week|past week|last 7 days|last seven/.test(m)) return { kind: 'dateRange', start: shiftDate(today, -6), end: today, label: 'this week' }
  if (/last week/.test(m)) return { kind: 'dateRange', start: shiftDate(today, -13), end: shiftDate(today, -7), label: 'last week' }
  if (/this month|past month|last 30 days/.test(m)) return { kind: 'dateRange', start: shiftDate(today, -29), end: today, label: 'last 30 days' }
  if (/yesterday/.test(m)) { const y = shiftDate(today, -1); return { kind: 'dateRange', start: y, end: y, label: 'yesterday' } }
  return { kind: 'season', label: 'this season' }
}

function aggregateSplits(splits: Any[], group: 'hitting' | 'pitching'): Any {
  const sum: Any = {}
  const fields =
    group === 'hitting'
      ? ['gamesPlayed', 'atBats', 'hits', 'doubles', 'triples', 'homeRuns', 'runs', 'rbi', 'baseOnBalls', 'strikeOuts', 'totalBases', 'stolenBases']
      : ['gamesPlayed', 'earnedRuns', 'strikeOuts', 'baseOnBalls', 'homeRuns', 'hits', 'outs', 'numberOfPitches', 'wins', 'losses']
  for (const f of fields) sum[f] = 0
  for (const s of splits) for (const f of fields) sum[f] += Number(s?.stat?.[f] ?? 0)
  if (group === 'hitting') sum.avg = sum.atBats ? (sum.hits / sum.atBats).toFixed(3).replace(/^0/, '') : '.000'
  else {
    const ip = sum.outs / 3
    sum.inningsPitched = ip.toFixed(1)
    sum.era = ip ? ((sum.earnedRuns * 9) / ip).toFixed(2) : '0.00'
  }
  return sum
}

function saberSuffix(s: Any): string {
  const bits: string[] = []
  if (s.war != null) bits.push(`${Number(s.war).toFixed(1)} WAR`)
  if (s.wRcPlus != null) bits.push(`${Math.round(Number(s.wRcPlus))} wRC+`)
  if (s.woba != null) bits.push(`${Number(s.woba).toFixed(3).replace(/^0/, '')} wOBA`)
  return bits.length ? `, ${bits.join(', ')}` : ''
}

function formatHitting(name: string, label: string, s: Any): string {
  return `${name} (${label}): ${s.gamesPlayed ?? '?'} G, ${s.atBats} AB, ${s.hits} H, ${s.homeRuns} HR, ${s.rbi} RBI, ${s.runs} R, ${s.baseOnBalls} BB, ${s.strikeOuts} K, ${s.totalBases} TB${s.stolenBases ? `, ${s.stolenBases} SB` : ''}${s.avg ? `, ${s.avg} AVG` : ''}${s.ops ? `, ${s.ops} OPS` : ''}${saberSuffix(s)}`
}

function formatPitching(name: string, label: string, s: Any): string {
  return `${name} (${label}): ${s.gamesPlayed ?? '?'} G, ${s.inningsPitched} IP, ${s.earnedRuns} ER, ${s.strikeOuts} K, ${s.baseOnBalls} BB, ${s.homeRuns} HR${s.era ? `, ${s.era} ERA` : ''}${s.whip ? `, ${s.whip} WHIP` : ''}${s.war != null ? `, ${Number(s.war).toFixed(1)} WAR` : ''}`
}

// Resolve a player from the message and return a stat line for the requested
// range (this week / last N days / last N games / this season).
export async function getPlayerStats(message: string, today: string): Promise<string | null> {
  const player = await searchPlayer(message)
  if (!player) return null
  const range = parseStatRange(message, today)
  const group: 'hitting' | 'pitching' = player.pos === 'P' ? 'pitching' : 'hitting'
  const season = today.slice(0, 4)

  try {
    let stat: Any = null
    let label = range.label
    if (range.kind === 'season') {
      const r = await statsApi(`/people/${player.id}/stats?stats=season&group=${group}&season=${season}`)
      stat = r?.stats?.[0]?.splits?.[0]?.stat
      // Merge in WAR / wOBA / wRC+ from the sabermetrics endpoint.
      try {
        const sm = await statsApi(`/people/${player.id}/stats?stats=sabermetrics&group=${group}&season=${season}`)
        const smStat = sm?.stats?.[0]?.splits?.[0]?.stat
        if (smStat && stat) stat = { ...stat, war: smStat.war, woba: smStat.woba, wRcPlus: smStat.wRcPlus }
      } catch {
        // sabermetrics optional
      }
    } else if (range.kind === 'dateRange') {
      const r = await statsApi(`/people/${player.id}/stats?stats=byDateRange&group=${group}&startDate=${range.start}&endDate=${range.end}&season=${season}`)
      stat = r?.stats?.[0]?.splits?.[0]?.stat
    } else {
      const r = await statsApi(`/people/${player.id}/stats?stats=gameLog&group=${group}&season=${season}`)
      const splits: Any[] = (r?.stats?.[0]?.splits ?? []).slice(-(range.n ?? 10))
      if (splits.length) stat = aggregateSplits(splits, group)
      label = `${range.label} (${splits.length} G)`
    }
    if (!stat || (group === 'hitting' && stat.atBats == null) || (group === 'pitching' && stat.inningsPitched == null && stat.outs == null)) {
      return `${player.name} (${player.team}): no ${group} stats found for ${range.label}.`
    }
    const line = group === 'hitting' ? formatHitting(player.name, label, stat) : formatPitching(player.name, label, stat)
    return `${line}  [${player.team}, ${player.pos}]`
  } catch {
    return `${player.name}: stats lookup failed for ${range.label}.`
  }
}

// --- player lookup (today) ---------------------------------------------------
function playerMentioned(message: string, fullName: string): boolean {
  const m = ` ${message.toLowerCase()} `
  const lower = fullName.toLowerCase()
  if (m.includes(lower)) return true
  const last = lower.split(' ').slice(1).join(' ') // surname (handles multi-word)
  if (last && last.length > 3 && new RegExp(`\\b${last.replace(/[^a-z\s]/g, '')}\\b`).test(m)) return true
  return false
}

export async function findPlayerLines(message: string, cards: LiteGame[]): Promise<string[]> {
  const playable = cards.filter((c) => c.statusCode === 'L' || c.statusCode === 'F').slice(0, 16)
  const results: string[] = []

  await Promise.all(
    playable.map(async (c) => {
      if (!c.gamePk) return
      try {
        const b = await box(c.gamePk)
        for (const side of ['away', 'home'] as const) {
          const team = b?.teams?.[side]
          const opp = side === 'away' ? b?.teams?.home : b?.teams?.away
          const players: Any = team?.players ?? {}
          for (const key of Object.keys(players)) {
            const p = players[key]
            const name = p?.person?.fullName
            if (!name || !playerMentioned(message, name)) continue
            const bat = p?.stats?.batting
            const pit = p?.stats?.pitching
            const teamAbbr = team?.team?.abbreviation ?? ''
            const oppAbbr = opp?.team?.abbreviation ?? ''
            const ctx = `${teamAbbr} vs ${oppAbbr}, ${cardStatus(c)}`
            if (bat && bat.plateAppearances > 0) {
              results.push(
                `${name} (${ctx}): ${bat.summary} — HR ${bat.homeRuns}, RBI ${bat.rbi}, R ${bat.runs}, BB ${bat.baseOnBalls}, K ${bat.strikeOuts}, TB ${bat.totalBases}`
              )
            } else if (pit && pit.inningsPitched) {
              results.push(
                `${name} (${ctx}): ${pit.summary}${pit.note ? ` ${pit.note}` : ''} — ER ${pit.earnedRuns}, K ${pit.strikeOuts}, BB ${pit.baseOnBalls}, P ${pit.numberOfPitches}`
              )
            }
          }
        }
      } catch {
        // skip game
      }
    })
  )
  return results
}

// --- WAR leaders / MVP candidates --------------------------------------------
const LEADERS_TTL = 10 * 60 * 1000
const leadersCache = new Map<string, { at: number; text: string }>()

// Build a ranked WAR leaderboard (the basis for an MVP/Cy Young projection).
export async function buildLeadersContext(message: string, season: string): Promise<string> {
  const m = ` ${message.toLowerCase()} `
  const isPitching = /cy young|pitcher|pitching|\bera\b|strikeout leader/.test(m)
  const group = isPitching ? 'pitching' : 'hitting'
  const leagueId = /\b(al|american league)\b/.test(m) ? 103 : /\b(nl|national league)\b/.test(m) ? 104 : undefined
  const leagueLabel = leagueId === 103 ? 'AL' : leagueId === 104 ? 'NL' : 'MLB'

  const cacheKey = `${season}:${group}:${leagueId ?? 'all'}`
  const hit = leadersCache.get(cacheKey)
  if (hit && Date.now() - hit.at < LEADERS_TTL) return hit.text

  try {
    let path = `/stats?stats=sabermetrics&group=${group}&season=${season}&sortStat=war&order=desc&limit=10&playerPool=qualified&hydrate=team`
    if (leagueId) path += `&leagueId=${leagueId}`
    const r = await statsApi(path)
    const splits: Any[] = r?.stats?.[0]?.splits ?? []
    if (!splits.length) return `No qualified ${group} WAR leaders found for ${season}.`

    const rows = splits.slice(0, 8).map((s, i) => {
      const name = s?.player?.fullName ?? 'Unknown'
      const team = s?.team?.abbreviation ?? s?.team?.teamName ?? s?.team?.name ?? s?.player?.currentTeam?.name ?? ''
      const st = s?.stat ?? {}
      const war = st.war != null ? Number(st.war).toFixed(1) : '?'
      const extra = isPitching
        ? ''
        : `${st.wRcPlus != null ? `, ${Math.round(Number(st.wRcPlus))} wRC+` : ''}${st.woba != null ? `, ${Number(st.woba).toFixed(3).replace(/^0/, '')} wOBA` : ''}`
      return `${i + 1}. ${name} (${team}) — ${war} WAR${extra}`
    })
    const text = `${leagueLabel} ${group} WAR leaders, ${season} (qualified):\n${rows.join('\n')}`
    leadersCache.set(cacheKey, { at: Date.now(), text })
    return text
  } catch {
    return `WAR leaderboard lookup failed for ${season}.`
  }
}
