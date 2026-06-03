// Curated baseball knowledge base for RAG retrieval.
//
// Per the architecture: the ML model computes the probability, structured data
// supplies the exact numbers, and these short documents give the LLM correct
// conceptual context (definitions, what factors mean) so its explanations are
// accurate. This is deliberately small and hand-written — NOT raw stat rows —
// which is what RAG is good for.

export interface KnowledgeDoc {
  id: string
  title: string
  text: string
}

export const baseballKnowledgeDocs: KnowledgeDoc[] = [
  {
    id: 'win-probability',
    title: 'Win probability',
    text: `Win probability estimates a team's chance to win from the current game state. The most important live factors are inning, score differential, outs, base runners, home/away status, and how many innings each team still bats. A three-run lead in the 9th is far safer than the same lead in the 2nd because fewer outs remain for a comeback.`,
  },
  {
    id: 'run-expectancy',
    title: 'Run expectancy and base/out state',
    text: `Run expectancy is the average number of runs a team scores in the remainder of an inning from a given base/out state. Runners on base and fewer outs raise it. A runner on third with fewer than two outs is a high-value scoring situation; bases loaded with nobody out is among the highest. The model uses base/out run expectancy to project how many more runs each team will score.`,
  },
  {
    id: 'base-state',
    title: 'Base state',
    text: `Base state describes which bases are occupied (for example "runners on first and third"). More runners and runners closer to home increase scoring chances, especially with fewer than two outs. Two outs sharply reduce the expected runs from any base state.`,
  },
  {
    id: 'leverage',
    title: 'Leverage',
    text: `Leverage measures how much a single play can swing win probability. Close games in late innings are high leverage; blowouts and early innings are low leverage. High-leverage spots are where bullpen quality, pinch-hitting, and base-out decisions matter most.`,
  },
  {
    id: 'extra-innings',
    title: 'Extra innings and the ghost runner',
    text: `Since 2020, extra innings begin with an automatic runner on second base (the "ghost runner"), which raises run expectancy for both teams. The home team bats last, so in a tied extra inning the home team has a structural advantage: they can win with a single run in the bottom half (a walk-off). Win probability in extras should reflect that the home team gets the final at-bat.`,
  },
  {
    id: 'projected-score',
    title: 'Projected final score',
    text: `The projected final score adds each team's current runs to the runs they are expected to score the rest of the way, based on base/out run expectancy and the number of innings remaining. It is an expectation, not a prediction of an exact outcome, and is most uncertain early in a game.`,
  },
  {
    id: 'no-vig-probability',
    title: 'No-vig (vig-free) probability',
    text: `Sportsbook moneylines include the bookmaker's margin, or "vig," so the two sides' implied probabilities sum to more than 100%. Removing the vig (normalizing the two implied probabilities to sum to 100%) yields the market's true estimate of each team's win chance. The amount above 100% is the book's hold.`,
  },
  {
    id: 'implied-probability',
    title: 'Implied probability and American odds',
    text: `American odds convert to an implied win probability. For negative odds the implied probability is |odds| / (|odds| + 100); for positive odds it is 100 / (odds + 100). Favorites have negative odds and higher implied probability; underdogs have positive odds.`,
  },
  {
    id: 'fair-odds',
    title: 'Model fair odds',
    text: `Fair odds are the American moneyline that exactly matches the model's win probability, with no vig. Comparing the model's fair odds to the book's actual odds shows where the model and market disagree.`,
  },
  {
    id: 'model-vs-market-edge',
    title: 'Model vs market edge',
    text: `Edge is the difference, in percentage points, between the model's win probability and the market's vig-free probability for the same team. A positive edge means the model is higher on that team than the market. Edges are signals of disagreement, not guarantees, and small edges are usually noise.`,
  },
  {
    id: 'team-form',
    title: 'Recent team form',
    text: `Recent form summarizes how a team has played over its last several games, typically win rate and run differential per game over the last 10 and 30 games. Strong recent run differential is a better signal of underlying quality than win-loss record alone. The pregame model uses last-30 and last-10 form as inputs.`,
  },
  {
    id: 'market-as-prior',
    title: 'Betting market as a baseline',
    text: `Pregame betting odds are a strong baseline estimate of team strength because the market already incorporates starting pitchers, lineups, injuries, and other public information. When odds are available, the model anchors its pregame estimate to the vig-free market probability and lets live game state move it from there.`,
  },
  {
    id: 'starting-pitcher-quality',
    title: 'Starting pitcher quality (ERA, FIP)',
    text: `A starting pitcher's quality is measured by ERA (earned runs allowed per 9 innings) and FIP (fielding-independent pitching), which estimates ERA from strikeouts, walks, and home runs to remove defense and luck. Lower is better; around 4.30 is league average. A strong probable starter lowers the opponent's expected runs and raises that team's win probability, especially early in the game.`,
  },
  {
    id: 'pitcher-fatigue',
    title: 'Pitcher fatigue',
    text: `Pitcher fatigue shows up as a rising pitch count, falling velocity, worse command, and harder contact, and grows each time through the order. A tiring starter raises the chance the opposing offense scores, which lowers the pitching team's win probability.`,
  },
  {
    id: 'bullpen-fatigue',
    title: 'Bullpen fatigue',
    text: `A bullpen can be depleted when key relievers pitched on recent days or threw many pitches, leaving lower-quality or unavailable arms for high-leverage spots. A tired bullpen lowers a team's late-game win probability, especially if its starter exits early.`,
  },
  {
    id: 'statcast-metrics',
    title: 'Statcast quality-of-contact metrics',
    text: `Statcast (Baseball Savant) metrics measure underlying skill better than results. xwOBA (expected weighted on-base average) and xERA estimate value from contact quality and plate discipline. Barrel rate is the share of batted balls with ideal exit velocity and launch angle; hard-hit rate is the share hit 95+ mph. Chase rate is swings at pitches out of the zone, and whiff rate is swings and misses. High barrel/hard-hit and low chase/whiff indicate a dangerous hitter; the reverse indicates a vulnerable one. These are season-level skill signals, not live in-game data.`,
  },
  {
    id: 'lineup-strength',
    title: 'Lineup strength and batters due up',
    text: `Lineup strength reflects how productive the hitters are, often summarized by team xwOBA or wRC+. Which batters are due up matters in a live spot: the top of the order (best hitters) coming up is more threatening than the bottom of the order. Platoon matchups across the next few hitters can raise or lower the scoring threat for that inning.`,
  },
  {
    id: 'player-props',
    title: 'Player props (strikeouts, hits, home runs)',
    text: `Player prop questions (a hitter's hits/HR, a pitcher's strikeouts) depend on player-specific inputs: recent game logs, the opposing pitcher or lineup, handedness splits, and Statcast metrics like barrel rate, whiff rate, and a pitcher's strikeout rate and pitch arsenal. Props also depend on expected playing time and the prop line/odds. This app focuses on team-level win probability and does not currently project individual player props.`,
  },
  {
    id: 'platoon',
    title: 'Platoon advantage',
    text: `Batters generally hit better against opposite-handed pitchers: right-handed batters do better against lefties and left-handed batters against righties. A lineup stacked with the platoon advantage against the current pitcher is more dangerous.`,
  },
  {
    id: 'confidence',
    title: 'Model confidence',
    text: `Confidence reflects how much the model trusts its estimate. It is higher late in decided games and when sportsbook odds are available, and lower pregame or when odds are missing. Low confidence means the estimate should be treated as rough.`,
  },
]
