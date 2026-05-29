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
- **Data:** MLB StatsAPI (live feeds, schedules), The Odds API (moneyline, run line, totals)
- **ML (in progress):** Scikit-learn win probability and score projection models trained on historical Statcast data

## Running locally

```bash
npm install
npm run dev        # frontend on :5173
npm run dev:server # backend on :8787
```

## Status

Core UI and live data ingestion are working. Chatbot AI layer and ML prediction models are in active development.
