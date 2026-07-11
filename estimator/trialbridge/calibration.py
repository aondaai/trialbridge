"""Probability calibration (Trilha B, step 2).

The enrichment layer emits a predicted depth-eligibility rate `p` per stratum; the
estimator weights those rates by DataSUS base counts to produce Estimated N. For the
sum of probabilities to equal a real count, `p` must be *calibrated*: among strata the
model calls "p ~ 0.30", ~30% must actually pass depth. Shrinkage (see stats.shrink)
controls variance; it does not guarantee calibration under domain shift — the
proprietary hospitals are not a random sample of the DataSUS population.

This module fits a monotonic map `p -> p_calibrated` from a reliability table of
(predicted, outcome) pairs collected on a HELD-OUT split (never the training fold),
and measures calibration error before/after. Two calibrators, both dependency-free
and consistent with stats.py's "no numpy" rule:

  * PlattCalibrator  — logistic in logit-space: sigmoid(a*logit(p)+b). Two parameters,
    smooth, identity at (a=1,b=0). Best when the miscalibration is a smooth stretch.
  * IsotonicCalibrator — non-parametric monotone step function via PAVA. No shape
    assumption; best when miscalibration is non-monotone-in-magnitude but order-preserving.
    Needs more data than Platt to be stable.

The estimand this can validate TODAY is cross-source transfer *within* the proprietary
base (leave-one-hospital-out) and in-distribution fit (random holdout). The estimand it
must ultimately validate — proprietary rate vs the DataSUS target population — needs the
Rosetta Stone linkage (Trilha B, step 1) to supply target-domain labels. The machinery
is identical; only the source of the (predicted, outcome) pairs changes. See CALIBRATION.md.

`calibration_ref` is a deterministic id (like registry.make_version) so a calibrated
Estimated N can be reproduced and audited, and so provenance.imputed(..., calibration_ref=)
can point every calibrated value back at the report that earned it.
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import List, Sequence, Tuple

# (predicted probability in [0,1], observed outcome 0/1)
Pair = Tuple[float, int]

_EPS = 1e-6


def _clip01(p: float) -> float:
    return min(1.0 - _EPS, max(_EPS, p))


def _logit(p: float) -> float:
    p = _clip01(p)
    return math.log(p / (1.0 - p))


def _sigmoid(x: float) -> float:
    # numerically stable
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


# ---------------------------------------------------------------------------
# Reliability measurement
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ReliabilityBin:
    lo: float
    hi: float
    count: int
    mean_pred: float   # mean predicted prob in this bin
    mean_obs: float    # observed pass fraction in this bin


@dataclass(frozen=True)
class ReliabilityReport:
    bins: Tuple[ReliabilityBin, ...]
    ece: float         # expected calibration error: sum_bin (n_bin/N) * |pred-obs|
    mce: float         # max calibration error: max_bin |pred-obs|
    brier: float       # mean (p - y)^2 over all pairs
    n: int

    def __str__(self) -> str:
        head = f"ECE={self.ece:.4f}  MCE={self.mce:.4f}  Brier={self.brier:.4f}  (n={self.n})"
        rows = [
            f"  [{b.lo:.2f},{b.hi:.2f})  n={b.count:>5}  pred={b.mean_pred:.3f}  "
            f"obs={b.mean_obs:.3f}  gap={b.mean_pred - b.mean_obs:+.3f}"
            for b in self.bins if b.count > 0
        ]
        return head + ("\n" + "\n".join(rows) if rows else "")


def reliability(pairs: Sequence[Pair], n_bins: int = 10) -> ReliabilityReport:
    """Equal-width binning of predicted probability; compare mean pred vs observed rate.

    ECE/MCE weight the gap by bin population (empty bins contribute nothing). Brier is
    computed over all pairs, independent of binning.
    """
    n = len(pairs)
    if n == 0:
        return ReliabilityReport(bins=(), ece=0.0, mce=0.0, brier=0.0, n=0)

    edges = [i / n_bins for i in range(n_bins + 1)]
    sums_p = [0.0] * n_bins
    sums_y = [0.0] * n_bins
    counts = [0] * n_bins
    brier = 0.0
    for p, y in pairs:
        brier += (p - y) ** 2
        # bin index; predicted prob exactly 1.0 lands in the last bin
        b = min(n_bins - 1, int(_clip01(p) * n_bins))
        sums_p[b] += p
        sums_y[b] += y
        counts[b] += 1
    brier /= n

    bins: List[ReliabilityBin] = []
    ece = 0.0
    mce = 0.0
    for i in range(n_bins):
        c = counts[i]
        if c == 0:
            bins.append(ReliabilityBin(edges[i], edges[i + 1], 0, 0.0, 0.0))
            continue
        mp = sums_p[i] / c
        mo = sums_y[i] / c
        gap = abs(mp - mo)
        ece += (c / n) * gap
        mce = max(mce, gap)
        bins.append(ReliabilityBin(edges[i], edges[i + 1], c, mp, mo))
    return ReliabilityReport(bins=tuple(bins), ece=ece, mce=mce, brier=brier, n=n)


# ---------------------------------------------------------------------------
# Platt scaling (logistic in logit-space)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PlattCalibrator:
    a: float
    b: float
    n_train: int

    method: str = "platt"

    def __call__(self, p: float) -> float:
        return _sigmoid(self.a * _logit(p) + self.b)

    @classmethod
    def fit(cls, pairs: Sequence[Pair], iters: int = 200, lr: float = 0.1
            ) -> "PlattCalibrator":
        """Fit sigmoid(a*logit(p)+b) by minimizing log-loss with Newton-ish IRLS steps.

        Starts at the identity (a=1, b=0). Uses full-batch Newton on the 2-parameter
        logistic — cheap and stable for two params. Deterministic (no shuffling/seed).
        """
        xs = [_logit(p) for p, _ in pairs]
        ys = [float(y) for _, y in pairs]
        n = len(pairs)
        if n == 0:
            return cls(a=1.0, b=0.0, n_train=0)

        a, b = 1.0, 0.0
        for _ in range(iters):
            # gradient and Hessian of mean log-loss wrt (a, b)
            g_a = g_b = 0.0
            h_aa = h_ab = h_bb = 0.0
            for x, y in zip(xs, ys):
                mu = _sigmoid(a * x + b)
                d = mu - y
                g_a += d * x
                g_b += d
                w = mu * (1.0 - mu)
                h_aa += w * x * x
                h_ab += w * x
                h_bb += w
            g_a /= n; g_b /= n
            h_aa /= n; h_ab /= n; h_bb /= n
            # Newton step with tiny ridge for invertibility
            h_aa += 1e-9; h_bb += 1e-9
            det = h_aa * h_bb - h_ab * h_ab
            if abs(det) < 1e-12:
                # fall back to gradient descent step
                a -= lr * g_a
                b -= lr * g_b
                continue
            # inverse Hessian times gradient
            da = (h_bb * g_a - h_ab * g_b) / det
            db = (h_aa * g_b - h_ab * g_a) / det
            a -= da
            b -= db
            if abs(da) < 1e-9 and abs(db) < 1e-9:
                break
        return cls(a=a, b=b, n_train=n)


# ---------------------------------------------------------------------------
# Isotonic regression (Pool Adjacent Violators)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class IsotonicCalibrator:
    # sorted, deduplicated (x -> y) knots of a monotone non-decreasing step function
    xs: Tuple[float, ...]
    ys: Tuple[float, ...]
    n_train: int

    method: str = "isotonic"

    def __call__(self, p: float) -> float:
        xs, ys = self.xs, self.ys
        if not xs:
            return _clip01(p)
        if p <= xs[0]:
            return ys[0]
        if p >= xs[-1]:
            return ys[-1]
        # linear interpolation between adjacent knots (monotone, so safe)
        lo, hi = 0, len(xs) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if xs[mid] <= p:
                lo = mid
            else:
                hi = mid
        x0, x1, y0, y1 = xs[lo], xs[hi], ys[lo], ys[hi]
        if x1 == x0:
            return y0
        t = (p - x0) / (x1 - x0)
        return y0 + t * (y1 - y0)

    @classmethod
    def fit(cls, pairs: Sequence[Pair]) -> "IsotonicCalibrator":
        """Weighted PAVA. Groups identical predicted probs, then pools adjacent blocks
        that violate monotonicity, weighting by group size. Deterministic."""
        n = len(pairs)
        if n == 0:
            return cls(xs=(), ys=(), n_train=0)
        # aggregate outcomes per distinct predicted prob (stable, sorted)
        agg: dict[float, list[float]] = {}
        for p, y in pairs:
            agg.setdefault(p, [0.0, 0.0])
            agg[p][0] += y      # sum of outcomes
            agg[p][1] += 1.0    # weight
        points = sorted(agg.items())  # by predicted prob
        # blocks: [x_repr, sum_y, weight]
        blocks: List[list] = [[x, sy, w] for x, (sy, w) in points]
        # PAVA: merge while previous mean > current mean
        i = 0
        while i < len(blocks) - 1:
            m_cur = blocks[i][1] / blocks[i][2]
            m_nxt = blocks[i + 1][1] / blocks[i + 1][2]
            if m_cur > m_nxt + 1e-15:
                # pool i and i+1
                blocks[i][1] += blocks[i + 1][1]
                blocks[i][2] += blocks[i + 1][2]
                # keep x of the pooled block as the max x it spans so interpolation
                # over [x_i, x_{i+1}] stays correct; use the right edge
                blocks[i][0] = blocks[i + 1][0]
                del blocks[i + 1]
                if i > 0:
                    i -= 1  # re-check backwards
            else:
                i += 1
        xs = tuple(bk[0] for bk in blocks)
        ys = tuple(min(1.0, max(0.0, bk[1] / bk[2])) for bk in blocks)
        return cls(xs=xs, ys=ys, n_train=n)


# ---------------------------------------------------------------------------
# Report bundling a fitted calibrator with its before/after evidence
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CalibrationReport:
    method: str
    calibration_ref: str
    before: ReliabilityReport
    after: ReliabilityReport
    n_train: int
    n_eval: int
    split: str                 # how the holdout was formed, e.g. "leave-one-hospital-out"
    notes: str = ""

    @property
    def ece_improvement(self) -> float:
        return self.before.ece - self.after.ece

    def __str__(self) -> str:
        return (
            f"calibration[{self.method}] ref={self.calibration_ref} split={self.split}\n"
            f"  before: {self.before}\n"
            f"  after : {self.after}\n"
            f"  ECE improvement: {self.ece_improvement:+.4f} "
            f"(train n={self.n_train}, eval n={self.n_eval})"
            + (f"\n  note: {self.notes}" if self.notes else "")
        )


def make_calibration_ref(method: str, split: str, n_train: int,
                         model_version: str = "", extra: str = "") -> str:
    """Deterministic id for a fitted calibration, mirroring registry.make_version.

    Same (method, split, training size, model version, extra) -> same ref, so a
    calibrated estimate is reproducible and auditable.
    """
    payload = "|".join([
        f"method={method}",
        f"split={split}",
        f"n_train={n_train}",
        f"model={model_version}",
        f"extra={extra}",
    ])
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:8]
    return f"calib-{digest}"
