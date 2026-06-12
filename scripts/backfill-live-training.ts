// Backfill live-state training rows from past results.
//
// For each date in the range, fetches the MLB schedule, pulls the archived
// play-by-play feed for every final game, reconstructs the game state at the
// start of each at-bat, runs it through the SAME live feature builder used
// at inference time, and writes:
//   - a labeled games row (home_win)
//   - feature_snapshots rows with is_pregame = false
//
// Usage:
//   npm run backfill:live -- --start 2026-05-01 --end 2026-06-10
//   npm run backfill:live -- --date 2026-06-01

import { getSupabase } from '../server/db/supabase.js'
import { getGameFeed, getScheduleByDate, flattenGamesFromSchedule } from '../server/mlbStatsService.js'
import { buildLiveFeatureVector } from '../server/features/buildLiveFeatureVector.js'
import { reconstructLiveStates } from '../server/features/reconstructLiveStates.js'

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      i += 1
    }
  }
  return args
}

function* dateRange(start: string, end: string): Generator<string> {
  const cursor = new Date(`${start}T12:00:00Z`)
  const last = new Date(`${end}T12:00:00Z`)
  while (cursor <= last) {
    yield cursor.toISOString().slice(0, 10)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
}

async function backfillDate(date: string): Promise<{ games: number; rows: number }> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Supabase is not configured')

  const schedule = await getScheduleByDate({ date })
  const games = flattenGamesFromSchedule(schedule).filter((g) => g.statusCode === 'F')

  let totalRows = 0
  let totalGames = 0

  for (const game of games) {
    // Skip games that already have live training rows.
    const { data: existing, error: existsError } = await supabase
      .from('feature_snapshots')
      .select('snapshot_id')
      .eq('game_pk', game.gamePk)
      .eq('is_pregame', false)
      .limit(1)
    if (existsError) throw new Error(existsError.message)
    if ((existing?.length ?? 0) > 0) continue

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feed = (await getGameFeed({ gamePk: game.gamePk })) as Record<string, any>
    const reconstructed = reconstructLiveStates(feed)
    if (!reconstructed) continue

    const { error: gameError } = await supabase.from('games').upsert(
      {
        game_pk: reconstructed.gamePk,
        game_date: reconstructed.gameDate ?? date,
        game_time: game.gameDate,
        season: Number(date.slice(0, 4)),
        home_team: reconstructed.homeTeam,
        away_team: reconstructed.awayTeam,
        status: 'Final',
        status_code: 'F',
        final_home_score: reconstructed.finalHomeScore,
        final_away_score: reconstructed.finalAwayScore,
        home_win: reconstructed.homeWin,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'game_pk' }
    )
    if (gameError) throw new Error(gameError.message)

    const rows = reconstructed.states.map(({ state }) => {
      const vector = buildLiveFeatureVector(state)
      return {
        game_pk: reconstructed.gamePk,
        is_pregame: false,
        feature_names: vector.featureNames,
        feature_values: vector.values,
        features: vector.features,
      }
    })

    const { error: insertError } = await supabase.from('feature_snapshots').insert(rows)
    if (insertError) throw new Error(insertError.message)

    totalGames += 1
    totalRows += rows.length
    console.log(`  ${reconstructed.awayTeam} @ ${reconstructed.homeTeam}: ${rows.length} states (home_win=${reconstructed.homeWin})`)
  }

  return { games: totalGames, rows: totalRows }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const start = args.date ?? args.start
  const end = args.date ?? args.end ?? start
  if (!start) {
    console.error('Usage: npm run backfill:live -- --start YYYY-MM-DD --end YYYY-MM-DD (or --date YYYY-MM-DD)')
    process.exitCode = 1
    return
  }

  let games = 0
  let rows = 0
  for (const date of dateRange(start, end)) {
    console.log(`Backfilling ${date}...`)
    const result = await backfillDate(date)
    games += result.games
    rows += result.rows
  }
  console.log(`Done: ${games} games, ${rows} live-state training rows.`)
}

main().catch((error: unknown) => {
  console.error((error as Error).message)
  process.exitCode = 1
})
