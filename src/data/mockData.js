export const starterPrompts = [
  "What's the live win probability for the Yankees game?",
  'Which games have the biggest model vs book gap right now?',
  'Translate the fair odds for Dodgers vs Padres.',
  'Why did the Braves win probability move?',
]

export const intentList = [
  'list_live_games',
  'get_win_probability',
  'get_projected_score',
  'get_odds_translation',
  'get_model_vs_book_edge',
  'explain_prediction',
]

export const retrievalTools = [
  'get_live_games()',
  'get_live_game(game_pk)',
  'get_latest_odds(game_pk)',
  'get_prediction(game_pk)',
  'get_prediction_history(game_pk)',
  'get_top_model_edges()',
]

export const frontendModules = [
  'ChatWindow',
  'ChatMessage',
  'ChatInput',
  'GameChip',
  'PredictionCard',
  'OddsCard',
  'EdgeCard',
]

export const liveGames = [
  {
    matchup: 'NYY vs BOS',
    status: 'Bot 6th',
    score: 'NYY 3 - BOS 2',
  },
  {
    matchup: 'LAD vs SDP',
    status: 'Top 4th',
    score: 'LAD 2 - SDP 1',
  },
  {
    matchup: 'ATL vs NYM',
    status: 'Pregame',
    score: 'First pitch 7:10 PM',
  },
]

export const chatMessages = [
  {
    role: 'assistant',
    tag: 'System',
    title: 'Grounded response format',
    body:
      'The assistant should answer with current game state, score, live win probability, fair odds, model edge, and a short plain-English explanation.',
  },
  {
    role: 'user',
    tag: 'User',
    title: 'Example prompt',
    body: "What's the live outlook for Yankees vs Red Sox?",
  },
  {
    role: 'assistant',
    tag: 'Bot',
    title: 'Example structured answer',
    body:
      'Bottom of the 6th, Yankees lead 3-2 with runners on first and third. Model win probability is 68.1%, projected final is 5.1 to 3.9, and the model is slightly higher on New York than the book.',
  },
]

export const sidebarChats = [
  {
    id: 'chat-live-dodgers',
    title: 'Dodgers live edge',
    preview: 'What changed in LAD win probability?',
    timestamp: '11:38 PM',
    pinned: true,
  },
  {
    id: 'chat-yankees-odds',
    title: 'Yankees fair odds',
    preview: 'Translate Yankees live fair odds',
    timestamp: '10:52 PM',
  },
  {
    id: 'chat-braves-move',
    title: 'Braves probability move',
    preview: 'Why did Atlanta move from 58 to 64?',
    timestamp: 'Yesterday',
  },
  {
    id: 'chat-general-mlb',
    title: 'General MLB trends',
    preview: 'Which teams are overheating this week?',
    timestamp: 'May 26',
  },
]
