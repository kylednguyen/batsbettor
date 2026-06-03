# MLB Live Forecasting Chatbot Project Plan

## Project Goal

Build a chatbot that answers live MLB forecasting questions using real-time game state, sportsbook odds, historical baseball data, and machine learning predictions.

The chatbot should answer questions like:

```text
What is the live win probability for the Yankees game?
What are the fair odds for the Dodgers right now?
Is the book overpricing the Mets?
What is the projected final score for Red Sox vs Rays?
Why did the win probability move?
Show me today’s best model vs book differences.
```

This should be treated as an analytics and machine learning portfolio project, not betting advice.

---

## MVP Product Description

**MLB Forecasting Chatbot**

The app ingests live MLB game data, pulls sportsbook odds, runs a machine learning model, and lets the user ask natural-language questions about live games.

The chatbot returns:

```text
Current inning / outs / base state
Current score
Live win probability
Projected final score
Projected total runs
Projected moneyline
Book odds
No-vig implied probability
Model vs book probability difference
Plain-English explanation
```

---

## Example Chatbot Conversation

### User

```text
What’s the live outlook for Yankees vs Red Sox?
```

### Bot

```text
Yankees vs Red Sox is currently in the bottom of the 6th.

Score: Yankees 3, Red Sox 2
Base state: runners on 1st and 3rd
Outs: 1
Count: 2-1

Model win probability:
Yankees: 68.1%
Red Sox: 31.9%

Projected final score:
Yankees 5.1, Red Sox 3.9
Projected total: 9.0 runs

Book odds:
Yankees -175
Red Sox +145

No-vig book probability:
Yankees 62.2%
Red Sox 37.8%

Model fair odds:
Yankees -214
Red Sox +214

Model vs book difference:
Yankees +5.9 percentage points
Red Sox -5.9 percentage points

Interpretation: The model is slightly higher on the Yankees than the current market, mostly because they are leading late with runners on base.
```

---

## Core Product Features

## 1. Chat Interface

The frontend should look like a simple sports analytics assistant.

Users type questions such as:

```text
Show me today's live MLB games.
Give me the win probability for the Mets game.
Translate the odds for Dodgers vs Padres.
What does your model think the final score will be?
Which games have the biggest difference between model probability and book probability?
Explain why the Braves win probability is high.
```

The chatbot should respond with structured natural language, not just raw JSON.

---

## 2. Intent Detection

The chatbot needs to classify what the user is asking.

Core intents:

```text
list_live_games
get_game_status
get_win_probability
get_projected_score
get_odds_translation
get_model_vs_book_edge
explain_prediction
get_prediction_history
general_help
```

Example mapping:

```text
User: "What games are live?"
Intent: list_live_games

User: "What are fair odds for the Yankees?"
Intent: get_odds_translation

User: "Why is the model high on the Dodgers?"
Intent: explain_prediction

User: "Which games have the best edge?"
Intent: get_model_vs_book_edge
```

For MVP, you can do this with rule-based keyword matching. Later, use an LLM function-calling layer.

---

## 3. Retrieval Layer

The chatbot should not guess. It should retrieve the latest data from your backend.

The chat service should call internal tools/functions like:

```text
get_live_games()
get_live_game(game_pk)
get_latest_odds(game_pk)
get_prediction(game_pk)
get_prediction_history(game_pk)
get_top_model_edges()
```

The chatbot response should be grounded in these returned objects.

---

## Recommended System Architecture

```text
mlb-forecast-chatbot/
  backend/
    app/
      main.py
      config.py

      api/
        chat_routes.py
        live_routes.py
        odds_routes.py
        prediction_routes.py
        health_routes.py

      chatbot/
        intent_router.py
        response_builder.py
        prompts.py
        tools.py
        memory.py

      db/
        database.py
        schema.sql
        queries.py

      ingestion/
        historical_statcast_ingest.py
        historical_game_ingest.py
        live_game_ingest.py
        odds_ingest.py

      features/
        historical_features.py
        live_features.py
        odds_features.py

      ml/
        train_win_prob.py
        train_score_model.py
        evaluate.py
        predict.py

      services/
        mlb_stats_client.py
        odds_client.py
        pybaseball_client.py

      utils/
        odds_math.py
        baseball_state.py
        team_mapping.py
        game_matcher.py

    models/
      live_win_probability.pkl
      score_projection.pkl

    requirements.txt

  frontend/
    src/
      App.tsx
      api/client.ts
      components/
        ChatWindow.tsx
        ChatMessage.tsx
        ChatInput.tsx
        GameChip.tsx
        PredictionCard.tsx
        OddsCard.tsx
        EdgeCard.tsx

  data/
    raw/
    processed/
    snapshots/

  scripts/
    run_historical_ingest.py
    run_live_ingest.py
    run_train.py

  docker-compose.yml
  README.md
```

---

# Core Data Sources

## 1. MLB StatsAPI

Use this for live game schedule, live game feed, score, inning, outs, count, base runners, and current game state.

Example live feed endpoint:

```text
https://statsapi.mlb.com/api/v1.1/game/{game_pk}/feed/live
```

Example schedule endpoint:

```text
https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=team,linescore
```

---

## 2. pybaseball

Use this for historical Statcast and pitch-level data.

Useful fields:

```text
game_pk
game_date
home_team
away_team
inning
inning_topbot
outs_when_up
balls
strikes
on_1b
on_2b
on_3b
home_score
away_score
bat_score
fld_score
batter
pitcher
events
description
pitch_type
release_speed
launch_speed
launch_angle
estimated_woba_using_speedangle
```

---

## 3. The Odds API

Use this for live or pregame MLB odds.

Sport key:

```text
baseball_mlb
```

Markets:

```text
h2h      -> moneyline
spreads  -> run line
totals   -> over/under
```

---

# Database Schema

Use Postgres.

## games

```sql
CREATE TABLE games (
    game_pk TEXT PRIMARY KEY,
    game_date DATE,
    season INT,
    home_team TEXT,
    away_team TEXT,
    venue TEXT,
    status TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## live_game_snapshots

```sql
CREATE TABLE live_game_snapshots (
    snapshot_id BIGSERIAL PRIMARY KEY,
    game_pk TEXT REFERENCES games(game_pk),
    collected_at TIMESTAMP DEFAULT NOW(),

    inning INT,
    half_inning TEXT,
    outs INT,

    home_score INT,
    away_score INT,
    run_diff INT,

    batting_team TEXT,
    pitching_team TEXT,

    runner_on_first BOOLEAN,
    runner_on_second BOOLEAN,
    runner_on_third BOOLEAN,
    base_state TEXT,

    balls INT,
    strikes INT,

    current_batter_id TEXT,
    current_pitcher_id TEXT,

    raw_json JSONB
);
```

Base state examples:

```text
empty
1--
-2-
--3
12-
1-3
-23
123
```

---

## odds_snapshots

```sql
CREATE TABLE odds_snapshots (
    odds_id BIGSERIAL PRIMARY KEY,
    game_pk TEXT REFERENCES games(game_pk),
    collected_at TIMESTAMP DEFAULT NOW(),

    bookmaker TEXT,

    home_team TEXT,
    away_team TEXT,

    home_moneyline INT,
    away_moneyline INT,

    spread_line FLOAT,
    home_spread_price INT,
    away_spread_price INT,

    total_line FLOAT,
    over_price INT,
    under_price INT,

    raw_json JSONB
);
```

---

## predictions

```sql
CREATE TABLE predictions (
    prediction_id BIGSERIAL PRIMARY KEY,
    game_pk TEXT REFERENCES games(game_pk),
    snapshot_id BIGINT REFERENCES live_game_snapshots(snapshot_id),
    created_at TIMESTAMP DEFAULT NOW(),

    model_version TEXT,

    home_win_probability FLOAT,
    away_win_probability FLOAT,

    projected_home_runs FLOAT,
    projected_away_runs FLOAT,
    projected_total_runs FLOAT,
    projected_run_diff FLOAT,

    fair_home_moneyline INT,
    fair_away_moneyline INT,

    home_no_vig_probability FLOAT,
    away_no_vig_probability FLOAT,

    home_probability_edge FLOAT,
    away_probability_edge FLOAT
);
```

---

## chat_logs

Stores user questions and bot answers for debugging and product improvement.

```sql
CREATE TABLE chat_logs (
    chat_id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT NOW(),

    user_message TEXT,
    detected_intent TEXT,
    game_pk TEXT,

    tool_called TEXT,
    response_text TEXT,

    raw_context JSONB
);
```

---

# Backend API Endpoints

## Core data endpoints

```text
GET /api/health
GET /api/live/games
GET /api/live/games/{game_pk}
GET /api/odds/{game_pk}
GET /api/predict/{game_pk}
GET /api/predictions/{game_pk}/history
GET /api/edges/top
```

## Chatbot endpoint

```text
POST /api/chat
```

Request:

```json
{
  "message": "What is the win probability for the Yankees game?"
}
```

Response:

```json
{
  "intent": "get_win_probability",
  "game_pk": "746123",
  "answer": "The Yankees have a 68.1% live win probability...",
  "cards": [
    {
      "type": "prediction",
      "home_team": "NYY",
      "away_team": "BOS",
      "home_win_probability": 0.681,
      "away_win_probability": 0.319
    }
  ]
}
```

---

# Chatbot Components

## intent_router.py

Purpose: decide what the user wants.

Simple MVP version:

```python
TEAM_KEYWORDS = {
    "yankees": "NYY",
    "red sox": "BOS",
    "dodgers": "LAD",
    "mets": "NYM",
    "padres": "SD",
}


def detect_intent(message: str) -> str:
    msg = message.lower()

    if "live games" in msg or "games today" in msg:
        return "list_live_games"

    if "win probability" in msg or "chance" in msg:
        return "get_win_probability"

    if "projected score" in msg or "final score" in msg:
        return "get_projected_score"

    if "odds" in msg or "moneyline" in msg or "fair" in msg:
        return "get_odds_translation"

    if "edge" in msg or "difference" in msg or "model vs book" in msg:
        return "get_model_vs_book_edge"

    if "why" in msg or "explain" in msg:
        return "explain_prediction"

    return "general_help"


def extract_team(message: str):
    msg = message.lower()
    for name, abbr in TEAM_KEYWORDS.items():
        if name in msg:
            return abbr
    return None
```

---

## tools.py

Purpose: functions the chatbot can call.

```python
from app.db.queries import (
    get_today_games,
    get_latest_live_snapshot,
    get_latest_odds,
    get_latest_prediction,
    get_top_edges,
)


def list_live_games():
    return get_today_games()


def get_game_prediction(game_pk: str):
    snapshot = get_latest_live_snapshot(game_pk)
    odds = get_latest_odds(game_pk)
    prediction = get_latest_prediction(game_pk)

    return {
        "snapshot": snapshot,
        "odds": odds,
        "prediction": prediction,
    }


def get_best_model_edges(limit: int = 5):
    return get_top_edges(limit=limit)
```

---

## response_builder.py

Purpose: convert data into a natural chatbot answer.

```python
def format_percent(value: float) -> str:
    return f"{value * 100:.1f}%"


def build_win_probability_response(context: dict) -> str:
    snapshot = context["snapshot"]
    prediction = context["prediction"]

    home_team = snapshot["home_team"]
    away_team = snapshot["away_team"]

    return f"""
{home_team} vs {away_team} is currently in the {snapshot['half_inning']} of the {snapshot['inning']} inning.

Score: {home_team} {snapshot['home_score']}, {away_team} {snapshot['away_score']}
Base state: {snapshot['base_state']}
Outs: {snapshot['outs']}
Count: {snapshot['balls']}-{snapshot['strikes']}

Model win probability:
{home_team}: {format_percent(prediction['home_win_probability'])}
{away_team}: {format_percent(prediction['away_win_probability'])}

Projected final score:
{home_team} {prediction['projected_home_runs']:.1f}, {away_team} {prediction['projected_away_runs']:.1f}
""".strip()
```

---

## chat_routes.py

```python
from fastapi import APIRouter
from pydantic import BaseModel

from app.chatbot.intent_router import detect_intent, extract_team
from app.chatbot.tools import list_live_games, get_game_prediction, get_best_model_edges
from app.chatbot.response_builder import build_win_probability_response
from app.db.queries import find_live_game_by_team, insert_chat_log

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str


@router.post("")
def chat(request: ChatRequest):
    message = request.message
    intent = detect_intent(message)
    team = extract_team(message)

    if intent == "list_live_games":
        games = list_live_games()
        answer = "Here are today's MLB games:\n" + "\n".join(
            [f"- {g['away_team']} at {g['home_team']}: {g['status']}" for g in games]
        )
        return {"intent": intent, "answer": answer, "data": games}

    if team:
        game = find_live_game_by_team(team)
        if not game:
            return {
                "intent": intent,
                "answer": f"I could not find a live game for {team} right now."
            }

        context = get_game_prediction(game["game_pk"])

        if intent == "get_win_probability":
            answer = build_win_probability_response(context)
        else:
            answer = build_win_probability_response(context)

        insert_chat_log(
            user_message=message,
            detected_intent=intent,
            game_pk=game["game_pk"],
            tool_called="get_game_prediction",
            response_text=answer,
            raw_context=context,
        )

        return {
            "intent": intent,
            "game_pk": game["game_pk"],
            "answer": answer,
            "data": context,
        }

    if intent == "get_model_vs_book_edge":
        edges = get_best_model_edges(limit=5)
        answer = "Here are the biggest model vs book differences right now:\n" + "\n".join(
            [f"- {e['home_team']} vs {e['away_team']}: {e['home_probability_edge'] * 100:.1f} pts" for e in edges]
        )
        return {"intent": intent, "answer": answer, "data": edges}

    return {
        "intent": "general_help",
        "answer": "Ask me about live MLB games, win probability, projected score, odds translation, or model vs book differences."
    }
```

---

# Ingestion Pipeline Tasks

## Historical ingestion

```text
[ ] Install pybaseball
[ ] Pull Statcast data by date range
[ ] Save raw data as Parquet
[ ] Keep only regular season games first
[ ] Remove rows with missing game_pk
[ ] Normalize team abbreviations
[ ] Build historical training rows
[ ] Save mlb_training_rows.parquet
```

---

## Live game ingestion

```text
[ ] Build MLBStatsClient
[ ] Pull today’s MLB schedule
[ ] Extract game_pk
[ ] Upsert each game into games table
[ ] For live games, call live feed endpoint
[ ] Parse inning, half inning, score, outs, base runners
[ ] Insert into live_game_snapshots
```

---

## Odds ingestion

```text
[ ] Build OddsClient
[ ] Pull MLB odds from The Odds API
[ ] Parse h2h, spreads, and totals
[ ] Match odds game to MLB game_pk
[ ] Store odds snapshots
[ ] Convert American odds to implied probability
[ ] Remove vig from moneyline market
[ ] Save no-vig probabilities
```

---

# Odds Math Utilities

Create:

```text
backend/app/utils/odds_math.py
```

```python
def american_to_implied_prob(odds: int) -> float:
    if odds < 0:
        return abs(odds) / (abs(odds) + 100)
    return 100 / (odds + 100)


def implied_prob_to_american(prob: float) -> int:
    if prob <= 0 or prob >= 1:
        raise ValueError("Probability must be between 0 and 1")

    if prob >= 0.5:
        return round(-100 * prob / (1 - prob))

    return round(100 * (1 - prob) / prob)


def remove_vig_two_way(prob_a: float, prob_b: float):
    total = prob_a + prob_b
    return prob_a / total, prob_b / total


def translate_moneyline(home_odds: int, away_odds: int):
    home_raw = american_to_implied_prob(home_odds)
    away_raw = american_to_implied_prob(away_odds)

    home_no_vig, away_no_vig = remove_vig_two_way(home_raw, away_raw)

    return {
        "home_raw_implied": home_raw,
        "away_raw_implied": away_raw,
        "home_no_vig": home_no_vig,
        "away_no_vig": away_no_vig,
        "book_hold": home_raw + away_raw - 1
    }
```

---

# Feature Engineering Tasks

Create:

```text
backend/app/features/live_features.py
```

Version 1 features:

```text
inning
is_top_inning
outs
balls
strikes
home_score
away_score
run_diff
current_total_runs
batting_team_is_home
runner_on_first
runner_on_second
runner_on_third
base_state_encoded
pregame_home_no_vig_prob
pregame_total
```

Checklist:

```text
[ ] Convert half inning to is_top_inning
[ ] Convert runners to 0/1 flags
[ ] Encode base state
[ ] Calculate run differential
[ ] Calculate current total runs
[ ] Add pregame market features from odds
[ ] Return one-row DataFrame for prediction
```

---

# Model Training Tasks

## Model 1: Live win probability

Target:

```text
home_win
```

Metrics:

```text
Log loss
Brier score
ROC-AUC
Calibration curve
```

Checklist:

```text
[ ] Load historical training rows
[ ] Sort by game_date to prevent leakage
[ ] Train/test split by date, not random
[ ] Train baseline Logistic Regression
[ ] Train Gradient Boosting model
[ ] Calibrate probabilities
[ ] Save model as live_win_probability.pkl
```

---

## Model 2: Final score projection

Targets:

```text
final_home_runs
final_away_runs
```

Metrics:

```text
Mean absolute error for home runs
Mean absolute error for away runs
Mean absolute error for total runs
Mean absolute error for run differential
```

Checklist:

```text
[ ] Train score projection model
[ ] Predict home and away final runs
[ ] Calculate projected total
[ ] Calculate projected run differential
[ ] Save model as score_projection.pkl
```

---

# Prediction Service Flow

```text
User asks question
↓
Chatbot detects intent
↓
Chatbot extracts team/game
↓
Chatbot calls prediction tool
↓
Backend loads latest live snapshot
↓
Backend loads latest odds snapshot
↓
Backend builds feature row
↓
ML model predicts win probability and score
↓
Odds math converts probability to fair odds
↓
Response builder turns prediction into natural language
↓
Chatbot returns answer and optional cards
```

---

# Frontend Chatbot Tasks

Build these components:

```text
ChatWindow
ChatMessage
ChatInput
GameChip
PredictionCard
OddsCard
EdgeCard
```

Frontend checklist:

```text
[ ] Create chat UI
[ ] Add message input
[ ] Send messages to POST /api/chat
[ ] Render assistant answers
[ ] Render prediction cards when returned
[ ] Add quick prompt buttons
[ ] Add loading state
[ ] Add error state
```

Quick prompt buttons:

```text
Show live games
Best model edges
Yankees win probability
Projected score
Translate odds
```

---

# Scheduler Tasks

Use APScheduler or a simple background loop.

Cadence:

```text
Live game ingest: every 15 seconds
Odds ingest: every 60 seconds
Prediction generation: after every live snapshot
Historical ingest: daily or manual
Model retraining: daily or weekly
```

Checklist:

```text
[ ] Add scheduler to backend
[ ] Poll MLB live game feed
[ ] Poll odds API
[ ] Generate prediction after live snapshot insert
[ ] Avoid duplicate snapshots if nothing changed
[ ] Log failed API calls
```

---

# Your 10-Day Build Plan

## Day 1: Project setup

```text
[ ] Create repo: mlb-forecast-chatbot
[ ] Create FastAPI backend
[ ] Create React frontend
[ ] Add Docker Compose with Postgres
[ ] Add .env
[ ] Add database schema
[ ] Add health endpoint
```

---

## Day 2: Live MLB ingestion

```text
[ ] Build MLBStatsClient
[ ] Pull today’s schedule
[ ] Extract game_pk
[ ] Pull live feed for one game
[ ] Parse inning, score, outs, base runners
[ ] Save live snapshots to Postgres
[ ] Create GET /api/live/games
```

---

## Day 3: Odds ingestion

```text
[ ] Get The Odds API key
[ ] Build OddsClient
[ ] Pull MLB moneyline, run line, totals
[ ] Create team name mapping
[ ] Match odds to game_pk
[ ] Save odds snapshots
[ ] Build odds translation utilities
[ ] Create GET /api/odds/{game_pk}
```

---

## Day 4: Historical data pipeline

```text
[ ] Install pybaseball
[ ] Pull Statcast data for a small date range
[ ] Save raw Parquet
[ ] Clean columns
[ ] Build base runner flags
[ ] Build final game targets
[ ] Save mlb_training_rows.parquet
```

---

## Day 5: Win probability model

```text
[ ] Train baseline Logistic Regression
[ ] Train Gradient Boosting model
[ ] Evaluate log loss
[ ] Evaluate Brier score
[ ] Calibrate model
[ ] Save live_win_probability.pkl
```

---

## Day 6: Score projection model

```text
[ ] Train final score model
[ ] Predict home and away final runs
[ ] Calculate projected total
[ ] Calculate projected run differential
[ ] Evaluate MAE
[ ] Save score_projection.pkl
```

---

## Day 7: Prediction endpoint

```text
[ ] Load latest live snapshot
[ ] Load latest odds snapshot
[ ] Build live feature row
[ ] Run win probability model
[ ] Run score projection model
[ ] Convert model probability to fair odds
[ ] Compare against no-vig book probability
[ ] Save prediction
[ ] Create GET /api/predict/{game_pk}
```

---

## Day 8: Chatbot backend

```text
[ ] Create POST /api/chat
[ ] Build intent_router.py
[ ] Build tools.py
[ ] Build response_builder.py
[ ] Support list_live_games
[ ] Support get_win_probability
[ ] Support get_projected_score
[ ] Support get_odds_translation
[ ] Support get_model_vs_book_edge
[ ] Save chat logs
```

---

## Day 9: Chatbot frontend

```text
[ ] Build ChatWindow
[ ] Build ChatMessage
[ ] Build ChatInput
[ ] Connect to POST /api/chat
[ ] Add quick prompt buttons
[ ] Render text responses
[ ] Render prediction cards
[ ] Render odds cards
```

---

## Day 10: Polish for portfolio

```text
[ ] Add README
[ ] Add screenshots
[ ] Add architecture diagram
[ ] Add example chatbot questions
[ ] Add model evaluation section
[ ] Add limitations section
[ ] Add demo video
[ ] Add resume bullets
```

---

# MVP Scope

Your first chatbot should answer only these:

```text
What games are live?
What is the live score?
What is the home team win probability?
What is the projected final score?
What are the current book odds?
What are the no-vig probabilities?
What are the model fair odds?
What is the model vs book difference?
```

Do not build these yet:

```text
Player props
Strikeout props
Home run props
Pitch-level outcome model
Monte Carlo simulator
Weather model
Bullpen fatigue model
Batter vs pitcher matchup engine
```

---

# Expanded Analytics Scope

Use this as the working scope for the next phase of the project:

```text
You are an agentic AI baseball analytics engineer helping me build an MLB prediction and live game analysis system.

Your job is to design and help implement a pipeline that analyzes historical and current team/player data to estimate game outlook, win probability, fair odds, and model edge.

Focus on the following data categories:

1. Team hitting profile
- Recent team batting performance over last 5, 10, 15, and 30 games
- Runs scored, wRC+, OPS, OBP, SLG
- Strikeout rate, walk rate, chase rate, contact rate
- Performance vs pitcher handedness
- Performance at home vs away
- Recent injuries or missing starters if available

2. Player hitting profile
- Projected starting lineup
- Individual batter stats
- Chase rate
- Whiff rate
- Strikeout rate
- Walk rate
- Hard-hit rate
- Barrel rate
- xBA, xSLG, xwOBA if available
- Splits vs right-handed and left-handed pitchers
- Recent form over last 7, 14, and 30 days

3. Starting pitcher profile
- Probable starter for each team
- ERA, WHIP, FIP, xFIP, SIERA if available
- Strikeout rate, walk rate, ground-ball rate
- Hard-hit rate allowed
- Barrel rate allowed
- Pitch count trends
- Innings per start
- Recent starts
- Splits vs left-handed and right-handed batters
- Performance by pitch type if available

4. Bullpen strength
- Bullpen ERA, WHIP, FIP
- Bullpen strikeout and walk rates
- Recent workload over the last 1, 3, 5, and 7 days
- Which relievers are likely unavailable because of recent usage
- Probable high-leverage bullpen arms
- Closer availability
- Setup man availability
- Bullpen fatigue score
- Expected bullpen quality if the starter exits early

5. Game context
- Ballpark factor
- Weather if available
- Wind speed and direction
- Temperature
- Umpire tendencies if available
- Travel/rest advantage
- Day game after night game
- Home/away advantage
- Series context

6. Betting/odds context
- Current sportsbook moneyline
- Implied probability from betting odds
- Model probability
- Difference between model probability and implied probability
- Fair odds generated from model probability
- Edge percentage
- Confidence rating

Build the system in modular steps.

Step 1: Data ingestion
Create a plan for collecting data from available sources such as MLB StatsAPI, Baseball Savant, FanGraphs, Baseball Reference, Retrosheet, or other free public data sources. Identify which fields come from which source. Prefer free sources first.

Step 2: Data cleaning
Normalize team names, player IDs, game IDs, dates, handedness, and stat formats. Handle missing data clearly. Create fallback logic when advanced stats are unavailable.

Step 3: Feature engineering
Create features such as:
- Team recent offense score
- Batter discipline score
- Pitcher quality score
- Pitcher vulnerability score
- Bullpen fatigue score
- Bullpen quality score
- Lineup strength score
- Matchup advantage score
- Park/weather adjustment
- Rest/travel adjustment

Step 4: Modeling
Recommend a practical first model. Start simple before advanced modeling. Compare:
- Logistic regression
- Random forest
- Gradient boosting
- XGBoost or LightGBM if available
- Elo-style rating system
- Ensemble model

The first target should be predicting win probability. A secondary target can be projected runs or run differential.

Step 5: Evaluation
Evaluate the model using:
- Accuracy
- Log loss
- Brier score
- ROC-AUC
- Calibration curve
- Profit/loss simulation against closing moneyline
- Backtesting by date so future games are never used to predict past games

Step 6: Output format
For each game, return a structured response like:

Game:
Team A vs Team B

Current state:
Pregame or live game state

Model win probability:
Team A: __%
Team B: __%

Fair odds:
Team A: __
Team B: __

Sportsbook implied probability:
Team A: __%
Team B: __%

Model edge:
Team A: __%
Team B: __%

Key reasons:
1. Starting pitcher advantage
2. Bullpen rest/availability
3. Lineup discipline/chase-rate advantage
4. Recent offensive form
5. Park/weather adjustment

Plain-English explanation:
Give a short explanation that a normal baseball fan can understand.

Confidence:
Low / Medium / High

Warnings:
Mention missing data, uncertain lineups, weather risk, or bullpen uncertainty.

Important constraints:
- Do not hallucinate data.
- If data is missing, say exactly what is missing.
- Prefer explainable features over black-box output.
- Keep the first version simple enough to build as an MVP.
- Make each module testable.
- Write clean code with clear file structure.
- Assume this will eventually be connected to a React frontend and Flask or FastAPI backend.

Now help me build the MVP step by step. Start by proposing the best architecture, folder structure, free data sources, and the first version of the feature set.
```

Recommended first implementation target for this expanded scope:

```text
1. Keep live win probability as the first production model target
2. Add a pregame feature store using free public sources first
3. Build a simple explainable feature set before advanced lineup or bullpen simulation
4. Return structured model outputs plus plain-English reasons and data-quality warnings
```

---

# Similarity + RAG Win Probability Scope

Use this as the working scope for the historical similarity and retrieval-driven version of the system:

```text
Act as an agentic MLB machine learning engineer.

I want to build a win probability model that predicts MLB game outcomes based on similar historical situations.

The system should combine:
1. A traditional ML model for win probability prediction
2. A vector database/RAG system for retrieving similar past game situations
3. An LLM explanation layer that turns the model output into a clear baseball explanation

The goal is not just to predict the winner. The goal is to say:

"Given this current matchup or live game state, what historically similar situations happened before, what was the outcome distribution, and what does that imply about the current win probability?"

Build the system around historical similarity.

Use historical MLB data to create situation snapshots such as:

Pregame snapshots:
- Home team
- Away team
- Probable starters
- Starting pitcher ERA, WHIP, FIP, K%, BB%, innings per start
- Bullpen ERA, WHIP, FIP
- Bullpen rest and recent workload
- Team recent batting form
- Lineup strength
- Batter chase rate, whiff rate, contact rate, K%, BB%, hard-hit rate
- Team performance vs pitcher handedness
- Park factor
- Weather
- Rest/travel situation
- Market odds and implied probability if available

Live-game snapshots:
- Inning
- Top/bottom
- Outs
- Base runners
- Current score
- Run differential
- Pitch count
- Current pitcher
- Bullpen availability
- Leverage index if available
- Batter/pitcher matchup
- Remaining lineup strength
- Home/away
- Pre-game team strength
- Current betting odds if available

For each historical situation, store:
- Structured numeric features for ML training
- A text summary for embedding/vector search
- Final outcome
- Final score
- Win/loss result
- Actual win probability movement if available
- Market odds if available

Use a vector database such as Chroma, FAISS, Pinecone, Supabase Vector, or pgvector.

The vector database should store text representations like:

"Bottom 7th, home team down 1, runners on first and second, one out, strong bullpen available, starter at 94 pitches, opposing bullpen used heavily yesterday, home lineup has strong platoon advantage against right-handed reliever."

When a new game situation comes in:
1. Convert the current situation into the same text format.
2. Embed it.
3. Retrieve the top 20 to 100 most similar historical situations.
4. Summarize what happened in those similar situations.
5. Use the retrieved examples as extra features for the win probability model.

Create similarity-based features such as:
- Similar situation win rate
- Similar situation average run differential
- Similar situation comeback rate
- Similar situation bullpen collapse rate
- Similar situation home team win rate
- Similar situation favorite win rate
- Similar situation average final score
- Similar situation market mispricing rate if odds data exists

Then train a supervised model using both:
A. Normal structured features
B. RAG-derived historical similarity features

Possible models:
- Logistic regression as baseline
- Random forest
- XGBoost or LightGBM
- CatBoost
- Calibrated gradient boosting
- Elo + ML hybrid model

The target should be:
- Pregame model: home team win probability
- Live model: current team win probability from game state

Evaluation should include:
- Log loss
- Brier score
- Calibration curve
- ROC-AUC
- Accuracy
- Backtesting by date
- Profit/loss simulation against sportsbook odds
- Comparison against baseline betting market probabilities

Important:
- Do not let future data leak into past predictions.
- Use time-based train/test split.
- Do not use final game outcome inside the live-game features.
- The vector search should only retrieve historical situations that occurred before the current prediction date.
- The LLM should explain the result, not make up the probability.
- The ML model should produce the probability.
- The RAG layer should provide similar historical context.
- The LLM should cite retrieved similar situations in plain English.

Design the MVP architecture.

I want you to produce:
1. System architecture
2. Folder structure
3. Data schema
4. Feature engineering plan
5. Vector database plan
6. ML training plan
7. Prediction API design
8. Example Python code
9. Example RAG retrieval flow
10. Example response format for the frontend

Keep the first version practical and buildable with free tools.
Use Python, FastAPI or Flask, scikit-learn, pandas, Chroma or FAISS, and a React frontend.
```

Recommended MVP interpretation of this similarity-based scope:

```text
1. Start with one pregame model and one live-state model
2. Store structured snapshots plus short text summaries for every historical situation
3. Use Chroma or FAISS first before moving to managed vector infra
4. Retrieve similar historical situations only from dates before the prediction timestamp
5. Feed retrieved win-rate and comeback-rate aggregates into the supervised model
6. Let the ML model generate the probability, and let the LLM only explain the retrieved context and feature drivers
```

---

# Phase 2 Upgrades

After the MVP works, add:

```text
Starting pitcher quality
Bullpen fatigue
Team offense last 14 days
Team wRC+
Park factor
Weather
Batter handedness
Pitcher handedness
Line movement tracking
Pregame model
Player prop projections
LLM function calling
Conversation memory
Source citations in chatbot responses
```

Best next upgrade after MVP:

```text
Bullpen fatigue + starting pitcher strength
```

That makes the project feel more baseball-specific and less generic.

---

# Resume Bullets

```text
Built an MLB forecasting chatbot that answers natural-language questions about live win probability, projected final score, sportsbook odds, fair moneyline pricing, and model-vs-market differences.

Developed ingestion pipelines for MLB StatsAPI live feeds, pybaseball Statcast data, and sportsbook odds, storing normalized game snapshots, odds snapshots, model predictions, and chat logs in Postgres.

Trained calibrated machine learning models on historical pitch-level game states to estimate live win probability using inning, score differential, outs, base runners, count, batting team, and market-implied probabilities.

Implemented a chatbot orchestration layer with intent detection, prediction retrieval tools, odds translation utilities, and response generation for live sports analytics questions.
```

---

# One-Sentence Portfolio Description

```text
An AI-powered MLB forecasting chatbot that combines live game feeds, historical Statcast data, sportsbook odds, and calibrated machine learning models to answer natural-language questions about win probability, projected score, fair odds, and model-vs-market differences.
```
