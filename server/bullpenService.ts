// Bullpen usage / fatigue pipeline.
//
// Reconstructs a team's recent relief workload from MLB StatsAPI box scores:
// which relievers pitched on which days and how many pitches they threw. From
// that it derives a fatigue score and flags likely-unavailable arms (pitched on
// back-to-back days). Feeds the prediction's late-game prior and the chatbot.
// Fails soft: missing data returns null.

import { getScheduleRange, getBoxscore } from './mlbStatsService.js'

export interface BullpenStatus {
  pitchesLast3Days: number
  relieversUsedLast3Days: number
  backToBackArms: number // relievers who pitched on consecutive days (likely tired)
  gamesConsidered: number
  // Composite fatigue score (higher = more depleted bullpen).
  fatigueScore: number
}

interface ReliefAppearance {
  date: string
  pitcherId: number
  pitches: number
}

function shiftDate(dateString: string, deltaDays: number): string {
  const [y, m, d] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

const cache = new Map<number, { fetchedAt: number; status: BullpenStatus | null }>()
const TTL_MS = 60 * 60 * 1000 // 1 hour

// Collect this team's relief appearances over its last few completed games.
async function collectReliefAppearances(
  teamId: number,
  asOfDate: string
): Promise<ReliefAppearance[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schedule = (await getScheduleRange({
    startDate: shiftDate(asOfDate, -6),
    endDate: asOfDate,
    teamId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any

  const games: Array<{ gamePk: number; date: string }> = []
  for (const dateEntry of schedule?.dates ?? []) {
    for (const game of dateEntry?.games ?? []) {
      const code = game?.status?.abstractGameCode ?? game?.status?.codedGameState
      if (code !== 'F') continue
      const date = String(game?.gameDate ?? dateEntry?.date ?? '').slice(0, 10)
      if (!date || date > asOfDate) continue
      games.push({ gamePk: game.gamePk, date })
    }
  }
  // Most recent up to 4 games is enough to gauge fatigue.
  games.sort((a, b) => b.date.localeCompare(a.date))
  const recent = games.slice(0, 4)

  const appearances: ReliefAppearance[] = []
  await Promise.all(
    recent.map(async ({ gamePk, date }) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const box = (await getBoxscore({ gamePk })) as any
        const home = box?.teams?.home
        const away = box?.teams?.away
        const side =
          home?.team?.id === teamId ? home : away?.team?.id === teamId ? away : null
        if (!side) return
        for (const pid of side?.pitchers ?? []) {
          const player = side?.players?.[`ID${pid}`]
          const ps = player?.stats?.pitching
          if (!ps) continue
          // Reliever = did not start this game.
          if (Number(ps?.gamesStarted ?? 0) === 1) continue
          const pitches = Number(ps?.numberOfPitches ?? ps?.pitchesThrown ?? 0)
          if (pitches <= 0) continue
          appearances.push({ date, pitcherId: pid, pitches })
        }
      } catch (_error) {
        // skip this game
      }
    })
  )
  return appearances
}

export async function getBullpenStatus(
  teamId: number,
  asOfDate: string = new Date().toISOString().slice(0, 10)
): Promise<BullpenStatus | null> {
  if (!teamId) return null
  const cached = cache.get(teamId)
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.status

  try {
    const appearances = await collectReliefAppearances(teamId, asOfDate)
    if (appearances.length === 0) {
      const empty: BullpenStatus = {
        pitchesLast3Days: 0,
        relieversUsedLast3Days: 0,
        backToBackArms: 0,
        gamesConsidered: 0,
        fatigueScore: 0,
      }
      cache.set(teamId, { fetchedAt: Date.now(), status: empty })
      return empty
    }

    const within3 = appearances.filter((a) => daysBetween(a.date, asOfDate) <= 3)
    const pitchesLast3Days = within3.reduce((sum, a) => sum + a.pitches, 0)
    const relieversUsedLast3Days = new Set(within3.map((a) => a.pitcherId)).size

    // Back-to-back: a reliever appearing on two consecutive calendar days.
    const datesByPitcher = new Map<number, string[]>()
    for (const a of appearances) {
      const list = datesByPitcher.get(a.pitcherId) ?? []
      list.push(a.date)
      datesByPitcher.set(a.pitcherId, list)
    }
    let backToBackArms = 0
    for (const dates of datesByPitcher.values()) {
      const sorted = [...new Set(dates)].sort()
      const consecutive = sorted.some((d, i) => i > 0 && daysBetween(sorted[i - 1], d) === 1)
      if (consecutive) backToBackArms += 1
    }

    const gamesConsidered = new Set(appearances.map((a) => a.date)).size
    // Fatigue: recent pitch load plus a penalty per likely-unavailable arm.
    const fatigueScore = Math.round(pitchesLast3Days + backToBackArms * 15)

    const status: BullpenStatus = {
      pitchesLast3Days,
      relieversUsedLast3Days,
      backToBackArms,
      gamesConsidered,
      fatigueScore,
    }
    cache.set(teamId, { fetchedAt: Date.now(), status })
    return status
  } catch (_error) {
    cache.set(teamId, { fetchedAt: Date.now(), status: null })
    return null
  }
}
