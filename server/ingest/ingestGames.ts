import { getSupabase } from '../db/supabase.js'
import type { ScoreCard } from '../mlbStatsService.js'

// gamePks whose final labels are already written, so we stop rewriting them.
const labeledGamePks = new Set<number>()

export async function ingestGames(cards: ScoreCard[], date: string): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return

  const season = Number(date.slice(0, 4))

  const rows = cards
    .filter((card) => card.gamePk !== null && !labeledGamePks.has(card.gamePk))
    .map((card) => {
      const isFinal = card.statusCode === 'F'
      const hasScores = card.homeScore !== null && card.awayScore !== null
      return {
        game_pk: card.gamePk,
        game_date: date,
        game_time: card.gameDate,
        season,
        home_team: card.homeTeam,
        away_team: card.awayTeam,
        status: card.status,
        status_code: card.statusCode,
        final_home_score: isFinal && hasScores ? card.homeScore : null,
        final_away_score: isFinal && hasScores ? card.awayScore : null,
        home_win: isFinal && hasScores ? card.homeScore! > card.awayScore! : null,
        updated_at: new Date().toISOString(),
      }
    })

  if (rows.length === 0) return

  const { error } = await supabase.from('games').upsert(rows, { onConflict: 'game_pk' })
  if (error) {
    console.error('ingestGames failed:', error.message)
    return
  }

  for (const row of rows) {
    if (row.home_win !== null) labeledGamePks.add(row.game_pk as number)
  }
}
