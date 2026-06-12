# BatsBettor

An MLB forecasting chatbot that combines live game feeds, sportsbook odds, and machine learning to answer natural-language questions about win probability, fair odds, and model-vs-market differences.

## What it does

- Live scoreboard with real-time updates via WebSockets
- Ask questions like "What's the win probability for the Yankees?" or "Which games have the biggest edge?"
- Returns current game state, model win probability, book odds, no-vig probabilities, and plain-English explanations
- Browse games by date from the sidebar

## Stack

- **Frontend:** React + Vite + TypeScript
- **Backend:** Node.js + Express + Socket.IO + TypeScript
- **Data:** MLB StatsAPI (live feeds, schedules), The Odds API (moneyline), Supabase Postgres (feature store)
- **ML:** "Model-as-data" pipeline — Node ingests feature snapshots into Supabase, a GitHub Actions job trains a scikit-learn logistic regression offline, and the Node service runs inference from a committed JSON artifact. No always-on Python. See `tasks.md` for the full design.

## Running locally

### 1. Install and configure

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Required for | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Chatbot | console.anthropic.com |
| `ODDS_API_KEY` | Odds, model features, predictions | the-odds-api.com (free tier) |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | Snapshot ingestion / training data | Supabase project → Settings → API |

Everything degrades gracefully: without `ODDS_API_KEY` you get live scores only; without Supabase, ingestion silently no-ops; without `ANTHROPIC_API_KEY`, chat returns a 503.

### 2. (Once) Set up Supabase

Create a free project at supabase.com, then paste the contents of `server/db/schema.sql` into the SQL editor and run it. This creates `games`, `odds_snapshots`, `feature_snapshots`, and `predictions`.

### 3. Run

```bash
npm run dev:server   # backend on :8787 (tick loop + ingestion start automatically)
npm run dev          # frontend on :5173 (separate terminal)
```

Sanity checks:

```bash
curl localhost:8787/api/health            # {"ok":true,...}
curl localhost:8787/api/model             # {"modelVersion":"devig-v0"} until first training run
curl localhost:8787/api/mlb/scorecards    # today's games
curl localhost:8787/api/predict/<gamePk>  # prediction for one game (needs odds)
```

With Supabase configured, watch rows appear in the dashboard table editor as the tick loop runs.

### 4. Train the model (after data accumulates)

The server needs to run for ~2–4 weeks so labeled games accumulate (the training script skips below 50 labeled games). Then either:

**Locally:**

```bash
pip install -r ml/requirements.txt
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python ml/train_win_prob.py
```

**Or via GitHub Actions:** add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` as repo secrets, then run the "Train win probability model" workflow from the Actions tab (it also runs weekly on a cron). The workflow commits `models/win_prob_latest.json`; the server picks it up within 5 minutes and `GET /api/model` reports the new `lr-*` version.

## Status

Core UI, live data ingestion, and the Tier 0 prediction layer (de-vig fair odds) are working. The trained logistic regression model goes live after enough labeled games accumulate. Roadmap and architecture details: `tasks.md`.
