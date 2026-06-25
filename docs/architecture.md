# Architecture

BatsBet is a live MLB assistant with two faces over the same data: a **routed
chatbot** that answers baseball questions, and a **dashboard suite** (Live
Games / Top Edges / Odds) that surfaces the win-probability and betting-value
model. Everything is grounded in real MLB StatsAPI + DraftKings data; nothing is
invented.

This document describes how the system is put together. For the math behind the
win probability, projected score, edge, and confidence, see
[prediction-model.md](prediction-model.md). For the offline ML training loop and
the "model-as-data" design, see [tasks.md](../tasks.md).

---

## 1. Top-level shape

```text
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (React + Vite + TS)                                           │
│                                                                        │
│   Sidebar nav ── New chat ─ Live games ─ Top edges ─ Odds              │
│        │             │            │           │         │              │
│        ▼             ▼            └─────┬──────┘         │              │
│   ChatWindow    chat composer      Dashboards.tsx (3 views)            │
│        │             │                   │                             │
└────────┼─────────────┼───────────────────┼─────────────────────────────┘
         │ POST         │ GET               │ GET  (one per game on the slate)
         │ /api/chat    │ /api/predict/:pk  │ /api/predict/:pk
         ▼              ▼                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Node + Express + Socket.IO (server/)                                  │
│                                                                        │
│   chat.ts ──► llm/ (intent router + provider)                          │
│   predictionService.ts ──► winProbability.ts  (analytic model)         │
│   model/predict.ts ──────► models/*.json      (trained artifact)       │
│   liveUpdateHub.ts (15s tick) ──► ingest/* ──► Supabase feature store   │
│   model/backtest.ts ──► Supabase  (re-score history, rank versions)    │
└───────┬──────────────────────────┬───────────────────────────┬────────┘
        │                          │                           │
        ▼                          ▼                           ▼
  MLB StatsAPI              DraftKings / The Odds API     Supabase Postgres
  (feeds, schedules,        (moneylines)                 (games, odds_snapshots,
   box, PBP, stats, WAR)                                  feature_snapshots,
                                                          predictions)
```

- **Frontend:** React + Vite + TypeScript. One SPA (`src/App.tsx`) with a
  sidebar, a center workspace that swaps between the chat and the three
  dashboards (`activeView` state), and an attached game-preview panel.
- **Backend:** Node + Express + Socket.IO + TypeScript, run with `tsx` (no
  build step in dev). A 15-second tick loop drives live updates and ingestion.
- **Data layer:** MLB StatsAPI and DraftKings at request time; Supabase Postgres
  as the feature store for offline training and backtesting.

---

## 2. Frontend

| Area | Files | Notes |
| --- | --- | --- |
| App shell + view routing | `src/App.tsx` | `activeView: 'chat' \| 'live' \| 'edges' \| 'odds'`; nav clicks switch views, `useSlatePredictions` only fetches when a dashboard is open. |
| Chat | `src/components/ChatWindow.tsx`, `ChatMessage.tsx`, `ChatInput.tsx` | Typewriter reveal on the latest assistant message (time-based `setInterval`); auto-growing composer textarea (1 line → 200px cap). |
| Dashboards | `src/components/Dashboards.tsx` | `useSlatePredictions` fans out `getPrediction` over the slate; `LiveGamesDashboard`, `TopEdgesDashboard`, `OddsDashboard`. |
| Game preview | `src/components/SelectedGamePanel.tsx`, `ModelInsights.tsx` | Opened by clicking any game; Overview / Model / Props / Box / Feed. |
| API client | `src/api/client.ts` | Thin fetch wrappers over the backend routes. |
| Types | `src/types.ts` | Mirror of the server's `Prediction` / `ScoreCard` shapes. |
| Theme | `src/styles.css` | "Moneyball" gold/white/black palette via CSS custom properties (`--brand: #d7a93b`, near-black surfaces, warm whites). |

### The three dashboards

All three read the **analytic** prediction (`/api/predict/:gamePk`) for every
game on the slate via the `useSlatePredictions` hook (parallel
`Promise.allSettled`). They display different projections of the same payload:

- **Live Games** — a card grid. Per game: status, both teams with records +
  win %, the win-probability split bar, probable starters, projected final
  score, the best edge, and a value-confidence chip.
- **Top Edges** — a table ranked by the model-vs-book edge (descending). Columns:
  matchup, best-value side, model %, market %, edge bar, projected total runs,
  starters, confidence %.
- **Odds** — a book-vs-model table, two rows per game (away/home): book line →
  implied → no-vig → model % → fair price, with per-game hold.

---

## 3. Backend routes

| Route | Handler | Purpose |
| --- | --- | --- |
| `GET /api/health` | inline | Liveness. |
| `GET /api/mlb/scorecards` | `mlbStatsService` | The day's games with scores + moneylines (drives the sidebar and dashboards). |
| `GET /api/mlb/schedule`, `/today-score`, `/odds`, `/game/:pk/live` | `mlbStatsService` | Schedule, summary, odds, and a single live feed. |
| `GET /api/predict/:gamePk` | `predictionService.getPredictionForGame` | **Analytic** prediction (the dashboards + chat use this). Win prob, projected score, fair odds, edge, confidence, drivers. |
| `GET /api/model/predict/:gamePk` | `model/predict.predictGame` | **Trained-artifact** prediction (live LR model, devig fallback). Distinct stack. |
| `GET /api/odds/translate` | `utils/oddsMath` | Convert between win prob and book-style odds. |
| `GET /api/model` | `model/predict` | Which artifact versions are active. |
| `GET /api/backtest` | `model/backtest.runBacktest` | Re-score historical snapshots under every artifact + baselines; log loss / Brier / accuracy / calibration per version. |
| `POST /api/chat` | `chat.handleChat` | Routed LLM assistant. |

---

## 4. Two prediction stacks

There are deliberately **two** independent prediction paths. They share the
odds-math utilities but nothing else, so either can evolve without touching the
other.

### A. Analytic stack — `/api/predict` (what the UI uses)

`predictionService.ts` orchestrates, `winProbability.ts` does the math. It is a
transparent ("white-box") model so the chatbot can explain *why* a number moved.

```text
MLB feed + DraftKings + team form + starters + bullpen
        │
        ▼
predictionService.buildPrediction
        │   estimateRunEnvironment()  ── team offense × opp run prevention
        │                                (blended with the opposing starter)
        ▼
winProbability.computeWinProbability
        │   pregame:  projected runs → run differential → normal-CDF win %
        │   live:     base/out run expectancy + remaining innings,
        │             blended with a decaying pregame prior
        ▼
buildPrediction (cont.)
        │   shrink pregame win % 30% toward the book's no-vig line
        │   fair moneylines  ← win %
        │   edge             ← model win % − book no-vig %
        │   confidence %      ← saturating curve over |edge|
        ▼
Prediction { model, market, edge, confidencePct, drivers, ... }
```

Full detail (formulas, the 30% shrink, why the score and line are one chain) is
in [prediction-model.md](prediction-model.md).

### B. Trained stack — `/api/model/predict` ("model-as-data")

A scikit-learn model is just **data**. Training is offline and rare; inference is
a dot product in TypeScript. There is no Python service at runtime.

```text
Supabase feature_snapshots ──► ml/train_win_prob.py (offline, GitHub Actions)
   (persisted feature rows)        StandardScaler + LogisticRegression
                                          │  writes JSON artifact
                                          ▼
                              models/win_prob_live_latest.json
                                          │  loaded + skew-validated
                                          ▼
                       server/model/predict.ts  →  p = σ(w · x_scaled + b)
```

- One feature builder is the single source of truth for both training rows and
  live inference (`features/buildFeatureVector.ts`, `buildLiveFeatureVector.ts`),
  which prevents training/serving skew.
- The artifact carries its own scaler and feature list; `model/predict.ts`
  validates that list against the builder at load time and fails loudly on a
  mismatch (the skew tripwire).
- Live games route to the live artifact; pregame falls back to the market
  de-vig probability until a pregame artifact is trained.

---

## 5. Ingestion + feature store

The existing 15-second tick loop (`liveUpdateHub.ts`) drives ingestion — there
is no separate scheduler.

```text
tick()
  ├─ fetchScoreboard()                 live updates over Socket.IO
  ├─ ingestGames(cards)                upsert games; label home_win at final
  ├─ ingestOdds(cards)                 snapshot odds only when the line moves
  └─ ingestFeatures(cards)             one pregame feature row + prediction per game
```

Writes are best-effort: failures are logged and never break live updates, and
without `SUPABASE_*` env vars every writer silently no-ops.

**Supabase schema** (`server/db/schema.sql`):

| Table | Holds |
| --- | --- |
| `games` | game_pk, teams, date, status, final scores, `home_win` label |
| `odds_snapshots` | moneylines + no-vig probs, written only when the line moves |
| `feature_snapshots` | `feature_names[]` + `feature_values[]` + JSONB, `is_pregame` flag |
| `predictions` | `model_version`-stamped probs, fair odds, edge |

Historical live-state rows are reconstructed from archived play-by-play via
`npm run backfill:live` (`scripts/backfill-live-training.ts`), so training data
exists without waiting for games to accumulate.

---

## 6. Evaluation tooling

| Tool | File | What it does |
| --- | --- | --- |
| Backtest endpoint | `server/model/backtest.ts` (`GET /api/backtest`) | Re-scores persisted snapshots under every artifact + market/uniform baselines; reports log loss, Brier, accuracy, and 10-bin calibration per version/cohort. `?cohort=live\|pregame\|all`, `?limit=N`. |
| Model comparison | `ml/compare_models.py` | Fits LR / SVC / NearestCentroid / KNN / HistGBT on the same by-game split and tabulates the panel. Writes a JSON + Markdown report to `models/`. Latest result: LR wins (log loss 0.4933). |

Both read the same feature store, so results are directly comparable — apples to
apples on identical historical games.

---

## 7. Chat layer

`POST /api/chat` → `chat.handleChat` → `llm/`:

1. `intentRouter` classifies the question (scoreboard, player lookup, game
   summary, model, odds, props, explanation, leaders/MVP).
2. The backend fetches the matching real data (StatsAPI / predictions / odds).
3. The LLM answers **over that data** — baseball first, model/betting context
   only when relevant. It never computes or invents numbers and declines
   questions it has no data for.

The provider is swappable via `LLM_PROVIDER` (Groq / Gemini / Anthropic / local
Ollama).

---

## 8. Key directories

```text
src/                     React frontend
  components/Dashboards.tsx   Live Games / Top Edges / Odds
  api/client.ts               backend fetch wrappers
  styles.css                  Moneyball theme + dashboard styles
server/
  index.ts                    Express routes + Socket.IO bootstrap
  predictionService.ts        analytic prediction orchestration
  winProbability.ts           run-expectancy + win-prob math
  teamForm.ts pitcherService.ts bullpenService.ts   matchup features
  model/predict.ts            trained-artifact inference (+ skew tripwire)
  model/backtest.ts           /api/backtest implementation
  model/artifact.ts           artifact JSON contract
  features/                   single-source-of-truth feature builders
  ingest/                     tick-loop ingestion writers
  db/                         Supabase client + schema.sql
  llm/                        intent router + provider + RAG
ml/
  train_win_prob.py           fit LR artifacts (pregame + live)
  compare_models.py           classifier panel comparison
models/                       committed JSON artifacts + comparison reports
docs/
  architecture.md             this file
  prediction-model.md         the prediction/edge/confidence chain
  design-spec.md              UI design language
tasks.md                      project plan + phase checklists
```
