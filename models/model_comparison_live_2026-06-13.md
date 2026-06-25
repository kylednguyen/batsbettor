# Model comparison — live cohort (2026-06-13)

1024 games · 62170 train / 15691 val rows · 10 features. By-game time split.

```
Model                        Acc   LogLoss    Brier   ROC-AUC
-------------------------------------------------------------
LogisticRegression        0.7389    0.4933   0.1665    0.8340
SVC                       0.7350    0.5147   0.1736    0.8262
HistGradientBoosting      0.6843    0.7008   0.2205    0.7658
KNeighbors                0.7198    0.7878   0.1772    0.8134
NearestCentroid           0.7303       n/a      n/a       n/a
```

**Best by log loss:** LogisticRegression
