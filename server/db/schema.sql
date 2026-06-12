-- BatsBettor Supabase schema. Run once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS games (
    game_pk BIGINT PRIMARY KEY,
    game_date DATE,
    game_time TIMESTAMPTZ,
    season INT,
    home_team TEXT,
    away_team TEXT,
    status TEXT,
    status_code TEXT,
    -- Label columns, backfilled when the game goes final.
    final_home_score INT,
    final_away_score INT,
    home_win BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS odds_snapshots (
    odds_id BIGSERIAL PRIMARY KEY,
    game_pk BIGINT REFERENCES games(game_pk),
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    bookmaker TEXT,
    home_moneyline INT,
    away_moneyline INT,
    -- No-vig probabilities computed at write time (see server/utils/oddsMath.ts).
    home_no_vig DOUBLE PRECISION,
    away_no_vig DOUBLE PRECISION,
    book_hold DOUBLE PRECISION,
    odds_last_update TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_odds_snapshots_game ON odds_snapshots(game_pk, collected_at DESC);

-- One pregame row per game is the training contract: features that existed
-- BEFORE the outcome, joined to games.home_win for the label.
CREATE TABLE IF NOT EXISTS feature_snapshots (
    snapshot_id BIGSERIAL PRIMARY KEY,
    game_pk BIGINT REFERENCES games(game_pk),
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    is_pregame BOOLEAN NOT NULL DEFAULT TRUE,
    feature_names TEXT[] NOT NULL,
    feature_values DOUBLE PRECISION[] NOT NULL,
    features JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_snapshots_pregame
    ON feature_snapshots(game_pk) WHERE is_pregame;

CREATE TABLE IF NOT EXISTS predictions (
    prediction_id BIGSERIAL PRIMARY KEY,
    game_pk BIGINT REFERENCES games(game_pk),
    snapshot_id BIGINT REFERENCES feature_snapshots(snapshot_id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Every prediction is stamped so retrains stay comparable across versions.
    model_version TEXT NOT NULL,
    home_win_probability DOUBLE PRECISION,
    away_win_probability DOUBLE PRECISION,
    fair_home_moneyline INT,
    fair_away_moneyline INT,
    home_no_vig_probability DOUBLE PRECISION,
    away_no_vig_probability DOUBLE PRECISION,
    home_probability_edge DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_predictions_game ON predictions(game_pk, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_version ON predictions(model_version);
