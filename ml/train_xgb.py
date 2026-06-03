"""XGBoost training for the pregame win-probability model.

Reads the training CSV exported by the TypeScript pipeline
(`npm run train:winprob` -> data/processed/pregame_training.csv), trains a
gradient-boosted tree model with a time-based holdout, and exports the tree
ensemble to models/pregame_win_prob_xgb.json so the Node server can run
inference in-process (no Python service required at runtime).

Usage:
    python3 ml/train_xgb.py

Data source: the same MLB StatsAPI last-30-game form rows used by the logistic
baseline, so the two models are directly comparable.
"""

import json
import math
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import xgboost as xgb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(ROOT, "data", "processed", "pregame_training.csv")
OUT_PATH = os.path.join(ROOT, "models", "pregame_win_prob_xgb.json")

# Must match PREGAME_FEATURE_NAMES in server/pregameModel.ts (order matters).
FEATURES = [
    "homeWinPct",
    "homeRunDiffAvg",
    "homeWinPct10",
    "homeRunDiffAvg10",
    "awayWinPct",
    "awayRunDiffAvg",
    "awayWinPct10",
    "awayRunDiffAvg10",
]


def log_loss(y, p):
    eps = 1e-15
    p = np.clip(p, eps, 1 - eps)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def brier(y, p):
    return float(np.mean((p - y) ** 2))


def accuracy(y, p):
    return float(np.mean((p >= 0.5).astype(int) == y))


def roc_auc(y, p):
    order = np.argsort(p)
    ranks = np.empty_like(order, dtype=float)
    ranks[order] = np.arange(1, len(p) + 1)
    pos = y.sum()
    neg = len(y) - pos
    if pos == 0 or neg == 0:
        return 0.5
    return float((ranks[y == 1].sum() - pos * (pos + 1) / 2) / (pos * neg))


def flatten_tree(node, out):
    """Flatten an XGBoost get_dump JSON node into {nodeid: node_record}."""
    nid = node["nodeid"]
    if "leaf" in node:
        out[nid] = {"leaf": float(node["leaf"])}
        return
    out[nid] = {
        "f": int(str(node["split"]).replace("f", "")),
        "cond": float(node["split_condition"]),
        "yes": int(node["yes"]),
        "no": int(node["no"]),
        "missing": int(node["missing"]),
    }
    for child in node.get("children", []):
        flatten_tree(child, out)


def main():
    if not os.path.exists(CSV_PATH):
        raise SystemExit(
            f"Training CSV not found at {CSV_PATH}. Run `npm run train:winprob` first."
        )

    print(f"Loading {CSV_PATH}")
    df = pd.read_csv(CSV_PATH)
    df = df.sort_values("date").reset_index(drop=True)
    print(f"  rows: {len(df)}")

    X = df[FEATURES].to_numpy(dtype=float)
    y = df["label"].to_numpy(dtype=int)

    # Time-based split: earliest 80% train, latest 20% test (no leakage).
    split = int(len(df) * 0.8)
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]
    print(f"  train: {len(y_train)}  test: {len(y_test)}")

    # Shallow + heavily regularized: the form features are low-dimensional and
    # noisy, so deep trees overfit. This keeps XGBoost competitive and well
    # calibrated on the time-based holdout.
    model = xgb.XGBClassifier(
        n_estimators=160,
        max_depth=2,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        min_child_weight=20,
        reg_lambda=3.0,
        reg_alpha=0.0,
        base_score=0.5,
        objective="binary:logistic",
        eval_metric="logloss",
        n_jobs=4,
    )
    print("Training XGBoost...")
    model.fit(X_train, y_train)

    p_test = model.predict_proba(X_test)[:, 1]
    base_rate = float(y_train.mean())
    p_base = np.full_like(p_test, base_rate)

    metrics = {
        "logLoss": round(log_loss(y_test, p_test), 4),
        "brier": round(brier(y_test, p_test), 4),
        "accuracy": round(accuracy(y_test, p_test), 4),
        "rocAuc": round(roc_auc(y_test, p_test), 4),
        "baselineLogLoss": round(log_loss(y_test, p_base), 4),
        "baselineAccuracy": round(accuracy(y_test, p_base), 4),
        "homeWinRate": round(base_rate, 4),
    }
    print("\n  XGBoost vs baseline (test split):")
    print(f"    log loss : {metrics['logLoss']}  (baseline {metrics['baselineLogLoss']})")
    print(f"    brier    : {metrics['brier']}")
    print(f"    accuracy : {metrics['accuracy']}  (baseline {metrics['baselineAccuracy']})")
    print(f"    roc auc  : {metrics['rocAuc']}")

    # Extract base_score and the tree ensemble for TS inference.
    booster = model.get_booster()
    config = json.loads(booster.save_config())
    raw_base = str(config["learner"]["learner_model_param"].get("base_score", "0.5"))
    # XGBoost may report base_score as a vector string like "[5E-1]".
    base_score = float(raw_base.strip("[]").split(",")[0])

    dumps = booster.get_dump(dump_format="json")
    trees = []
    for raw in dumps:
        nodes = {}
        flatten_tree(json.loads(raw), nodes)
        trees.append(nodes)

    # Feature importance (gain) for explainability.
    score = booster.get_score(importance_type="gain")
    importance = {
        FEATURES[int(k[1:])]: round(float(v), 4) for k, v in score.items()
    }

    out = {
        "modelType": "xgboost",
        "featureNames": FEATURES,
        "baseScore": base_score,
        "nTrees": len(trees),
        "trees": trees,
        "metrics": metrics,
        "importanceGain": importance,
        "trainingRows": int(len(y_train)),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
    }

    # Parity samples for the TS evaluator.
    #   - `prob`     : full-precision booster prediction (ground truth)
    #   - `dumpProb` : walk of the exported (float32-serialized) trees; this is
    #                  what the TS inference reproduces, so TS should match it to
    #                  machine precision. The tiny prob-vs-dumpProb gap is the
    #                  unavoidable get_dump serialization tolerance.
    def walk(tree, x):
        nid = 0
        for _ in range(64):
            n = tree[nid]  # in-memory flattened dict uses int keys
            if "leaf" in n:
                return n["leaf"]
            nid = n["yes"] if x[n["f"]] < n["cond"] else n["no"]
        return 0.0

    base_margin = math.log(base_score / (1 - base_score))

    def dump_prob(x):
        margin = base_margin + sum(walk(t, x) for t in trees)
        return 1 / (1 + math.exp(-margin))

    sample_idx = list(range(min(6, len(X_test))))
    rounded = [[round(float(v), 6) for v in X_test[i]] for i in sample_idx]
    rounded_probs = model.predict_proba(np.array(rounded))[:, 1]
    out["paritySamples"] = [
        {
            "features": rounded[i],
            "prob": round(float(rounded_probs[i]), 8),
            "dumpProb": round(float(dump_prob(rounded[i])), 10),
        }
        for i in range(len(sample_idx))
    ]

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f)
    print(f"\nSaved XGBoost model -> {OUT_PATH}")
    print(f"  trees: {len(trees)}  base_score: {base_score}")
    print(f"  top gains: {dict(sorted(importance.items(), key=lambda x: -x[1])[:4])}")


if __name__ == "__main__":
    main()
