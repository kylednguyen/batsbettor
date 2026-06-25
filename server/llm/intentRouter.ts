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
  | 'standings'
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
  // Standings / division races / team records — checked before player so
  // "how are the Dodgers doing" / "Yankees record" don't route to a player lookup.
  if (
    /\bstandings\b|division (race|lead|title|standings)|\b(al|nl|american league|national league) (east|central|west)\b|wild ?card|playoff (race|picture|spot|standings|chase)|first place|last place|best record|worst record|win.?loss record|\bgames back\b|\bgb\b|lead(s|ing)? the (al|nl|east|central|west|division)|atop the|in (first|second|third|fourth|last) place|where (do|does|are) .* (stand|rank)|how many (wins|losses|games) (do|does|have|has)|how (are|is|have|has|'?s) the .{2,30}? (doing|playing|played|looking|looked|fared|been)|record this (season|year)/.test(
      m
    )
  ) {
    return 'standings'
  }
  if (/\bodds\b|moneyline|money line|implied probability|fair odds|what does [+-]?\d+ mean|is (this|that|the).*(line|price|number)|\bvig\b|juice/.test(m)) {
    return 'odds'
  }
  if (/most likely|who (is|'s|will|does).*(win|favor)|prediction|model (say|think|like|favor|on|have)|win probability|(biggest|highest|best|most|top) edge|edges?\b|model vs|vs book|book gap|value (bet|play|side|tonight)|mispriced|over ?priced|under ?priced|best value|probable (pitcher|starter)|starting pitchers?|who'?s? (pitching|starting)|pitching matchup|on the mound|how do the (pitchers|starters)/.test(m)) {
    return 'model'
  }
  // Concept/definition questions about a stat or term ("what is WAR?", "explain
  // wOBA", "define OPS") must route to explanation, NOT player — otherwise the
  // stat name gets searched as a player name. Guard against possessives so
  // "what's Judge's WAR" still routes to player.
  const conceptTerm = /\b(war|wins above replacement|woba|wrc\+?|ops|obp|slg|slash line|era|whip|fip|k\/9|bb\/9|quality start|no.?vig|vig|juice|implied probability|run expectancy|leverage|fair odds|wrc)\b/
  const definitional = /\b(what'?s?|whats|explain|define|definition|meaning of|what does)\b/
  if (definitional.test(m) && conceptTerm.test(m) && !/\d{2,}/.test(m)) {
    // Strip the definitional words, stat terms, and filler. If a name-like token
    // survives (e.g. "ohtanis" in "what is ohtanis war"), it's a player lookup,
    // not a definition — even without an apostrophe. Otherwise it's a concept.
    const residue = m
      .replace(
        /\b(what'?s?|whats|is|are|the|a|an|explain|define|definition|meaning|of|does|do|mean|tell|me|about|for|in|on|baseball|stat|statistic|metric|good|number|war|wins|above|replacement|woba|wrc|ops|obp|slg|slash|line|era|whip|fip|k|bb|quality|start|no|vig|juice|implied|probability|run|expectancy|leverage|fair|odds|moneyline)\b/g,
        ' '
      )
      .replace(/[^a-z\s]/g, ' ')
      .trim()
    const hasName = residue.split(/\s+/).some((t) => t.length >= 3)
    if (!hasName) return 'explanation'
  }
  if (
    /what did|how (did|has|have|is) .*(do|done|play|playing|pitch|pitching|hit|hitting|go|fared|been|looking|looked)|stat ?line|\bstats\b|\bnumbers\b|\b(war|ops|obp|slg|woba|wrc|whip|fip|era|avg|babip)\b|game ?log|last \d+ games?|did .*(homer|hit|strike|pitch|play)|how many (k|strikeouts|hits|home runs|hr|rbi|bases|walks)|went \d/.test(
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
