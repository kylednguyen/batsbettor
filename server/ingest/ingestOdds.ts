import { getSupabase } from '../db/supabase.js'
import type { ScoreCard } from '../mlbStatsService.js'
import { translateMoneyline } from '../utils/oddsMath.js'

// Last written odds per game, so we only insert a snapshot when the line
// actually moves instead of every 15s tick.
const lastOddsHashByGamePk = new Map<number, string>()

export async function ingestOdds(cards: ScoreCard[]): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return

  const rows: Record<string, unknown>[] = []

  for (const card of cards) {
    if (card.gamePk === null || card.homeMoneyline === null || card.awayMoneyline === null) continue

    const hash = `${card.oddsProvider}:${card.homeMoneyline}:${card.awayMoneyline}`
    if (lastOddsHashByGamePk.get(card.gamePk) === hash) continue

    const { homeNoVig, awayNoVig, bookHold } = translateMoneyline(card.homeMoneyline, card.awayMoneyline)
    rows.push({
      game_pk: card.gamePk,
      bookmaker: card.oddsProvider,
      home_moneyline: card.homeMoneyline,
      away_moneyline: card.awayMoneyline,
      home_no_vig: homeNoVig,
      away_no_vig: awayNoVig,
      book_hold: bookHold,
      odds_last_update: card.oddsLastUpdate,
    })
    lastOddsHashByGamePk.set(card.gamePk, hash)
  }

  if (rows.length === 0) return

  const { error } = await supabase.from('odds_snapshots').insert(rows)
  if (error) {
    console.error('ingestOdds failed:', error.message)
    // Drop the hashes so the failed rows are retried next tick.
    for (const row of rows) lastOddsHashByGamePk.delete(row.game_pk as number)
  }
}
