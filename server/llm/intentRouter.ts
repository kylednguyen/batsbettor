// Lightweight, deterministic intent classification for the MLB assistant.
// Keyword-based (no extra LLM call) — decides which data the service fetches and
// how the answer should be framed.

export type ChatIntent =
  | 'scoreboard'
  | 'player'
  | 'game_summary'
  | 'model'
  | 'odds'
  | 'props'
  | 'explanation'
  | 'leaders'
  | 'general'

export function detectIntent(message: string, hasSelectedGame: boolean): ChatIntent {
  const m = ` ${message.toLowerCase()} `

  if (/\bprops?\b|over\/?under|total bases|anytime (hr|home run)|strikeout (prop|over)|to hit a/.test(m)) {
    return 'props'
  }
  if (/scoreboard|what.*(games|scores)|games? (live|today|tonight|on)|who won|live games|today'?s games|around the league|any games/.test(m)) {
    return 'scoreboard'
  }
  if (
    /\bmvp\b|cy young|war leaders?|\bleaderboard\b|most valuable|who (should|will|could|might) (win|be).*(mvp|cy young|award)|best (hitter|batter|pitcher|player)\b|top (hitters|players|pitchers|by war)|league leaders|war leader/.test(
      m
    )
  ) {
    return 'leaders'
  }
  if (/\bodds\b|moneyline|money line|implied probability|fair odds|what does [+-]?\d+ mean|is (this|that|the).*(line|price|number)|\bvig\b|juice/.test(m)) {
    return 'odds'
  }
  if (/most likely|who (is|'s|will|does).*(win|favor)|prediction|model (say|think|like|favor|on|have)|win probability|biggest edge|value (bet|play|side)|mispriced|best value/.test(m)) {
    return 'model'
  }
  if (
    /what did|how (did|has|have|is) .*(do|done|play|playing|pitch|pitching|hit|hitting|go|fared|been|looking|looked)|stat ?line|\bstats\b|\bnumbers\b|\bwar\b|game ?log|last \d+ games?|did .*(homer|hit|strike|pitch|play)|how many (k|strikeouts|hits|home runs|hr|rbi|bases|walks)|went \d/.test(
      m
    )
  ) {
    return 'player'
  }
  if (/summar|recap|what happened (in|with|to)|how did the .* game|box ?score|turning point/.test(m)) {
    return 'game_summary'
  }
  if (/\bwhy\b|explain|reason|because|how come|what makes/.test(m)) {
    return 'explanation'
  }
  return hasSelectedGame ? 'model' : 'general'
}
