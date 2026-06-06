# BatsBet

A live MLB assistant: a general baseball Q&A chatbot routed over real MLB data, with a win-probability and betting-value model layered on top. It answers baseball questions first (scores, player stats, game summaries, MVP race) and adds model/market context when it's relevant.

## What it does

- General MLB chat with intent routing — scoreboard, player stat lines (today, this week, last N games, season, incl. WAR / wRC+ / wOBA), game summaries, MVP / Cy Young projections from the WAR leaderboard, odds explanations, and the win-probability model.
- Win-probability and value model — for any game it computes the most likely winner and, separately, the best value bet vs the sportsbook line (these can be different teams).
- Live scoreboard with real-time updates via WebSockets, browsable by date.
- ChatGPT-style workspace: a left sidebar, a centered chat, and an attached game-preview panel with Overview / Model / Props / Box Score / Feed tabs.
- Everything is grounded in MLB StatsAPI / DraftKings data; the assistant does not invent stats, scores, or odds, and says plainly when something is missing or in the future.

## Example questions

- "What are the scores today?" / "What games are live right now?"
- "What are Ohtani's stats this week?" / "How has Aaron Judge done this season?" / "Bobby Witt last 10 games"
- "What's Skubal's WAR this season?"
- "Who could be MVP this year?" / "AL MVP race" / "best pitcher by WAR"
- "What happened in the Tigers game?" (final/live score, top performers, scoring plays)
- "Who does the model like in the Yankees game, and is there value?"
- "What does +180 mean?" / "Is this line good?"

## Stack

- **Frontend:** React + Vite + TypeScript
- **Backend:** Node.js + Express + Socket.IO + TypeScript
- **Data:** MLB StatsAPI (live feeds, schedules, box scores, play-by-play, player game logs and season/date-range stats, sabermetrics incl. WAR, WAR leaderboards, historical results, last-30-game team form), DraftKings (scraped moneylines, with The Odds API as fallback)
- **Live model:** Explainable analytic live win-probability and score-projection engine — base/out run expectancy + remaining innings (incl. extra-innings/ghost-runner handling), modeled as a normal run differential and blended with a pregame prior that decays through the game. Odds math strips the vig and converts model probabilities into fair moneylines and a model-vs-market edge.
- **Matchup features:** Probable-starter quality (ERA/FIP/K9 → expected runs allowed) and bullpen fatigue (recent reliever pitch load + back-to-back arms), both from MLB StatsAPI. They nudge the pregame prior by a bounded, explainable amount — but only when no market odds exist, since betting lines already price in starters and bullpen state.
- **Pregame model (trained):** An **XGBoost** classifier (logistic-regression baseline retained) fit on ~4,800 historical games using each team's last-10 and last-30 game form (win rate, run differential). It tunes the pregame prior the live model anchors to. Trained in Python, exported as a flattened tree ensemble, and run **in-process in TypeScript** (no Python service at runtime) with verified parity. Time-based holdout evaluation (log loss / Brier / accuracy / ROC-AUC vs a home-field baseline).
- **LLM layer:** A routed MLB assistant. Each question is classified into a mode (scoreboard, player lookup, game summary, model, odds, props, explanation, leaders/MVP), the backend fetches the matching real data, and the LLM answers over it — baseball first, betting/model context only when relevant. The ML model still computes win probability and value; the LLM never computes or invents numbers, and declines questions it has no data for (including individual-player futures). Provider is swappable (Groq / Gemini / Anthropic / local Ollama).

## Odds source

Odds are scraped from DraftKings' public sportsbook feed (MLB moneyline), matched to each game by team nickname. If DraftKings is unavailable (geo-block or shape change) the app falls back to The Odds API (set `ODDS_API_KEY`).

## Training the models

```bash
npm run train:winprob                       # 1) fetch history, fit logistic, export CSV
npm run train:winprob -- 2022-04-01 2024-10-01   # custom range
npm run train:xgb                           # 2) train XGBoost from the exported CSV
```

`train:winprob` pulls historical schedules from MLB StatsAPI, reconstructs each team's rolling last-30/last-10 form at the moment of every game (no leakage), fits the logistic baseline, and writes `data/processed/pregame_training.csv`. `train:xgb` ([ml/train_xgb.py](ml/train_xgb.py)) trains XGBoost on that CSV and exports `models/pregame_win_prob_xgb.json` (tree ensemble + metrics + parity samples). The server prefers XGBoost, falling back to logistic, then a home-field baseline.

> Requires Python with `xgboost` (`pip install xgboost`; on macOS also `brew install libomp`). Baseball Reference is a viable alternative source for the same form inputs; StatsAPI is used because it returns final scores in bulk without scraping.

## Chat: routed MLB assistant

`POST /api/chat` ([server/llm/mlbChatService.ts](server/llm/mlbChatService.ts)) is a router + explainer over real MLB data, not a database-in-the-LLM:

1. **Intent** — a deterministic keyword classifier ([intentRouter.ts](server/llm/intentRouter.ts)) tags the question: `scoreboard`, `player`, `game_summary`, `model`, `odds`, `props`, `explanation`, `leaders`, or `general`.
2. **Data** — the backend fetches only what the mode needs ([mlbContext.ts](server/llm/mlbContext.ts)): today's scoreboard (one schedule call), a game's box-score top performers + scoring plays, a player's stat line over a time range (today / this week / last N games / season, with WAR / wRC+ / wOBA), the WAR leaderboard for MVP / Cy Young (AL/NL filterable), and the grounded win-probability prediction for model/odds questions. A dependency-free, intent-aware TF-IDF retriever ([rag.ts](server/llm/rag.ts)) adds baseball concept definitions for explanation/odds questions.
3. **Answer** — the system prompt makes the model answer in the right mode, baseball first, scannable, using only the provided numbers.

Mode highlights:

- **Model** — always returns the most likely winner (highest model win probability) and, separately, the best value bet (largest positive edge vs the book's vig-free probability). These can be different teams.
- **Leaders / MVP / Cy Young** — ranks candidates by WAR (the standard award basis), names a front-runner and challengers split by league, and frames it as a projection, not a lock.
- **Player** — resolves the name via StatsAPI search and returns the requested range; future-performance questions are declined (only the team model projects games).

**Guardrails:** the assistant uses only the numbers in the provided data, never computes the win probability itself, and never invents scores, stats, odds, injuries, or lineups. It says plainly when data is missing. Statcast batter quality (xwOBA, barrel rate, etc.), handedness splits, confirmed lineups, injuries, weather/park, and player-prop projections are not ingested, so it flags those as unavailable rather than guessing.

The provider is behind a seam (`LLM_PROVIDER`):

- **Groq (recommended — free + hosted):** `LLM_PROVIDER=groq` with a free `GROQ_API_KEY` from [console.groq.com](https://console.groq.com). Runs `llama-3.3-70b-versatile` (override with `GROQ_MODEL`) — ~70B quality at no cost, far stronger than a local 8B model. OpenAI-compatible REST, no extra npm dependency.
- **Google Gemini (free + hosted):** `LLM_PROVIDER=gemini` with a free `GEMINI_API_KEY` from [aistudio.google.com](https://aistudio.google.com). Runs `gemini-flash-latest` (override with `GEMINI_MODEL`).
- **Anthropic:** `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`; override with `CHAT_MODEL` (defaults to Claude Haiku for cost). Best format adherence.
- **Ollama (fully local — no API key):**
  ```bash
  brew install --cask ollama   # bundles the inference runner
  open -a Ollama               # or: ollama serve
  ollama pull llama3.1:8b      # default; llama3.2 (3B) is faster but weaker
  ```
  Run the backend with `LLM_PROVIDER=ollama`. Tunables: `OLLAMA_MODEL` (default `llama3.1:8b`), `OLLAMA_NUM_CTX` (default `8192`), `CHAT_TEMPERATURE` (default `0.3`), `OLLAMA_HOST`. The chat calls Ollama's local REST API directly — no extra npm dependency.

## Prediction API

`GET /api/predict/:gamePk` returns a grounded prediction: live game state, home/away win probability, projected final score and total, fair moneylines, no-vig book probabilities, model-vs-market edge, recent team form, probable starters and bullpen state, play-by-play scoring plays, a confidence rating, plain-English drivers, and data-quality warnings.

## Interface

A stable three-column workspace:

- **Left sidebar** — brand, navigation, today's games (live / upcoming / final with a pulsing live indicator and aligned scores), quick prompts, and a pinned profile footer.
- **Center** — the chat: a clean header, a centered empty state with prompt suggestions, scrollable messages rendered from markdown, and a composer anchored at the bottom.
- **Right game-preview panel** (attached when a game is selected) — an anchored scoreboard that stays visible across tabs, then **Overview / Model / Props / Box Score / Feed** tabs. Overview shows the live game context plus a compact model takeaway; Model shows the full most-likely-winner and best-value cards; Box Score and Feed show the box score and scoring plays.

The model section always separates the **most likely winner** from the **best value bet** rather than collapsing them into one "model leans" line.

## Running locally

```bash
npm install
npm run dev        # frontend on :5173
npm run dev:server # backend on :8787
```

## Status

Working: live data ingestion, DraftKings odds, the analytic live win-probability and projected-score engine (with extra-innings handling), the trained pregame model (XGBoost plus a logistic baseline) on last-10/30 team form, probable-starter and bullpen-fatigue features, the routed MLB assistant (scoreboard, player stats incl. WAR over multiple time ranges, game summaries, MVP/Cy Young projection, model and odds), and the three-column workspace UI. Providers: Groq, Gemini, Anthropic, or local Ollama.

Next up (per `tasks.md`): backfilling historical probable-starter and bullpen state so those features can be trained into the model (today they apply as a bounded, explainable prior adjustment), a player-prop projection model, and optional Statcast batter metrics, lineups, and weather/park context. Box Score and Feed are nested under the Overview tab's existing sub-views; promoting them to top-level tabs is a small follow-up.
