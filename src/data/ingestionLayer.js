export const ingestionLayer = {
  source: 'MLB Stats API',
  runDate: '2026-05-27',
  fetchedAt: '2026-05-27T20:03:03Z',
  totalGames: 15,
  gamesInProgress: 3,
  sampledGamePk: 822809,
  artifacts: [
    'data/raw/mlbstats/schedule_2026-05-27.json',
    'data/raw/mlbstats/live_game_822809.json',
  ],
  sampleGames: [
    {
      gamePk: 822809,
      matchup: 'Miami Marlins @ Toronto Blue Jays',
      status: 'Final',
      score: 'MIA 1 - TOR 2',
    },
    {
      gamePk: 824432,
      matchup: 'Washington Nationals @ Seattle Mariners',
      status: 'Final',
      score: 'Fetched from schedule snapshot',
    },
  ],
}
