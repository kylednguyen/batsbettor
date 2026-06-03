# BatsBettor

An MLB forecasting chatbot that combines live game feeds, sportsbook odds, and machine learning to answer natural-language questions about win probability, projected scores, fair odds, and model-vs-market differences.

## What it does

- Live scoreboard with real-time updates via WebSockets
- Ask questions like "What's the win probability for the Yankees?" or "Which games have the biggest edge?"
- Returns current game state, model win probability, projected final score, book odds, no-vig probabilities, and plain-English explanations
- Browse games by date from the sidebar

## Stack

- **Frontend:** React + Vite + TypeScript
- **Backend:** Node.js + Express + Socket.IO + TypeScript
- **Data:** MLB StatsAPI (live feeds, schedules, historical results, last-30-game team form), DraftKings (scraped moneylines, with The Odds API as fallback)
- **Live model:** Explainable analytic live win-probability and score-projection engine — base/out run expectancy + remaining innings (incl. extra-innings/ghost-runner handling), modeled as a normal run differential and blended with a pregame prior that decays through the game. Odds math strips the vig and converts model probabilities into fair moneylines and a model-vs-market edge.
- **Matchup features:** Probable-starter quality (ERA/FIP/K9 → expected runs allowed) and bullpen fatigue (recent reliever pitch load + back-to-back arms), both from MLB StatsAPI. They nudge the pregame prior by a bounded, explainable amount — but only when no market odds exist, since betting lines already price in starters and bullpen state.
- **Pregame model (trained):** An **XGBoost** classifier (logistic-regression baseline retained) fit on ~4,800 historical games using each team's last-10 and last-30 game form (win rate, run differential). It tunes the pregame prior the live model anchors to. Trained in Python, exported as a flattened tree ensemble, and run **in-process in TypeScript** (no Python service at runtime) with verified parity. Time-based holdout evaluation (log loss / Brier / accuracy / ROC-AUC vs a home-field baseline).
- **LLM layer:** A retrieval-augmented MLB analyst. The ML model computes the probability; the LLM only explains it, grounded in (a) a structured **baseball context** object built from the live prediction and (b) a curated baseball **knowledge base** retrieved with a dependency-free, intent-aware TF-IDF retriever. It answers in a fixed analyst format, and refuses to invent data it doesn't have. Provider is swappable (Claude by default; Ollama for free local inference).

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

## LLM + RAG layer

`POST /api/chat` ([server/llm/mlbChatService.ts](server/llm/mlbChatService.ts)) runs the pipeline:

1. **Structured context** — builds a labeled `BASEBALL CONTEXT` block from the live prediction (game state, model win prob, projected score, fair odds, recent form, probable starters with ERA/FIP/K9, bullpen fatigue, sportsbook odds + no-vig + edge, model drivers, **play-by-play scoring plays + current at-bat**), plus an explicit **data-availability inventory** listing what is and isn't available. (See `tasks.md` → "LLM context & data availability" for the roadmap of further enrichments.)
2. **Intent-aware retrieval** — expands the user's question into concept terms (pitcher → ERA/FIP, props → Statcast/splits, odds → no-vig/edge, etc.) and pulls the top concept docs from [baseballKnowledge.ts](server/llm/baseballKnowledge.ts) via a dependency-free TF-IDF retriever ([rag.ts](server/llm/rag.ts)).
3. **Analyst answer** — the system prompt makes the model reason like an MLB analyst over the above and respond in a fixed format (**Direct answer / Why / Confidence / Missing data**).

**Guardrails:** the LLM uses only numbers in `BASEBALL CONTEXT`, never computes the probability itself, and never invents injuries, odds, player stats, pitcher names, live scores, Statcast metrics, weather, or lineups. When it lacks the data it replies *"I do not have enough data for that yet. I would need [specific missing data]."* (Statcast batter metrics, handedness splits, lineups, injuries, weather, park factors, and player props are **not** ingested by the app, so the assistant flags them as missing rather than guessing.)

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

`GET /api/predict/:gamePk` returns a grounded prediction: live game state, home/away win probability, projected final score and total, fair moneylines, no-vig book probabilities, model-vs-market edge, recent team form, a confidence rating, plain-English drivers, and data-quality warnings.

## Running locally

```bash
npm install
npm run dev        # frontend on :5173
npm run dev:server # backend on :8787
```

## Status

Working: live data ingestion, DraftKings odds, the analytic live win-probability + projected-score engine (with extra-innings handling), the trained pregame model (XGBoost + logistic) on last-10/30 team form, probable-starter and bullpen-fatigue features, and the grounded, analyst-style LLM chatbot (Anthropic or local Ollama).

Next up (per `tasks.md` Phase 2): backfilling historical probable-starter and bullpen state so those features can be trained into the model (today they apply as a bounded, explainable prior adjustment), then optional Statcast batter metrics, lineups, and weather/park context.
