"""
Risk heatmap intelligence: hardcoded diversification narrative, mispricing detector
(sensitivity × facility footprint vs yfinance event window), and carbon-tax scenario support.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import yfinance as yf

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

CARBON_SCENARIO_ID = "carbon_tax_100"

# Underlying return % at full footprint (1.0). Position return = underlying × direction sign convention in helper.
SENSITIVITY_PCT: dict[tuple[str, str], float] = {
    ("VLO", "hurricane"): -4.0,
    ("VLO", "freeze"): -1.0,
    ("VLO", "wildfire"): 0.0,
    ("VLO", "carbon"): -8.0,
    ("NRG", "hurricane"): -2.0,
    ("NRG", "freeze"): -16.0,
    ("NRG", "wildfire"): 0.0,
    ("NRG", "carbon"): -6.0,
    ("EGP", "hurricane"): -6.0,
    ("EGP", "freeze"): 0.0,
    ("EGP", "wildfire"): -1.0,
    ("EGP", "carbon"): 0.0,
    ("ALL", "hurricane"): -8.7,
    ("ALL", "freeze"): -2.0,
    ("ALL", "wildfire"): -12.0,
    ("ALL", "carbon"): -2.0,
    ("CL=F", "hurricane"): -5.0,
    ("CL=F", "freeze"): 3.0,
    ("CL=F", "wildfire"): 0.0,
    ("CL=F", "carbon"): -10.0,
    ("NG=F", "hurricane"): 8.0,
    ("NG=F", "freeze"): 30.0,
    ("NG=F", "wildfire"): 2.0,
    ("NG=F", "carbon"): 5.0,
}

# Scenario replay total return (decimal) for carbon — no yfinance.
CARBON_RETURN_DECIMAL: dict[str, float] = {
    "VLO": -0.08,
    "NRG": -0.06,
    "EGP": 0.0,
    "ALL": -0.02,
    "CL=F": -0.10,
    "NG=F": 0.05,
}

DIVERSIFICATION_FICTION: dict[str, Any] = {
    "headline": "You thought you were diversified.",
    "subhead": "But: 3 hidden climate concentrations detected across your book.",
    "clusters": [
        {
            "id": "gulf_coast",
            "title": "Gulf Coast hurricane dependency",
            "count": 3,
            "symbols": ["VLO", "NRG", "CL=F"],
            "risk_score_0_100": 87,
            "detail": (
                "VLO refineries, NRG plants, and WTI long all move together under Gulf Coast hurricane. "
                "Harvey moved all three simultaneously."
            ),
        },
        {
            "id": "florida_concentration",
            "title": "Florida climate concentration",
            "count": 2,
            "symbols": ["EGP", "ALL"],
            "risk_score_0_100": 79,
            "detail": (
                "EGP warehouses flood and ALL pays claims from the same storm. Ian hit both simultaneously. "
                "These positions are not independent."
            ),
        },
        {
            "id": "texas_grid",
            "title": "Texas grid dependency",
            "count": 2,
            "symbols": ["NRG", "NG=F"],
            "risk_score_0_100": 72,
            "detail": (
                "NRG long and GAS short both react to Texas freeze events. Uri proved your hedge and your long "
                "share the same risk factor."
            ),
        },
    ],
}


def load_facility_rows() -> list[dict[str, Any]]:
    path = DATA_DIR / "facility_locations.json"
    return json.loads(path.read_text(encoding="utf-8"))


def facility_footprint_score(ticker: str, hazard: str, facilities: list[dict[str, Any]]) -> float:
    facs = [f for f in facilities if str(f.get("ticker", "")).upper() == ticker.upper()]
    if not facs:
        return 1.0
    gulf = sum(float(f.get("asset_value_pct", 0)) for f in facs if f.get("region") == "gulf_coast")
    se = sum(float(f.get("asset_value_pct", 0)) for f in facs if f.get("region") == "southeast")
    ca = sum(float(f.get("asset_value_pct", 0)) for f in facs if f.get("region") == "california")
    if hazard == "hurricane":
        return max(0.12, min(1.0, gulf * 0.98 + se * 0.72 + ca * 0.1))
    if hazard == "freeze":
        return max(0.18, min(1.0, gulf * 0.9 + se * 0.35))
    if hazard == "wildfire":
        return max(0.12, min(1.0, ca * 0.95 + se * 0.22 + gulf * 0.06))
    if hazard == "carbon":
        return 1.0
    return 0.75


def sensitivity_underlying_pct(symbol: str, hazard: str, facilities: list[dict[str, Any]], asset_class: str) -> float:
    key = (symbol, hazard)
    base = SENSITIVITY_PCT.get(key)
    if base is None:
        base = 0.0
    if asset_class == "commodity":
        return round(base, 3)
    fp = facility_footprint_score(symbol, hazard, facilities)
    return round(base * fp, 3)


def position_return_from_underlying(underlying_pct: float, direction: str) -> float:
    sign = 1.0 if str(direction).lower() == "long" else -1.0
    return round(underlying_pct * sign, 3)


def _yf_close_pairs(symbol: str, start: date, end: date) -> list[tuple[date, float]]:
    try:
        hist = yf.download(
            symbol,
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),
            progress=False,
            auto_adjust=True,
        )
        if hist is None or hist.empty or "Close" not in hist.columns:
            return []
        closes = hist["Close"].dropna()
        if getattr(closes, "ndim", 1) > 1:
            closes = closes.iloc[:, 0]
        out: list[tuple[date, float]] = []
        for ts, val in closes.items():
            if hasattr(ts, "date"):
                tdate = ts.date()
            else:
                tdate = datetime.fromisoformat(str(ts)[:10]).date()
            if start <= tdate <= end:
                out.append((tdate, float(val)))
        out.sort(key=lambda x: x[0])
        return out
    except Exception:
        return []


def _return_decimal_in_window(pairs: list[tuple[date, float]], w0: date, w1: date) -> float | None:
    vals = [v for d, v in pairs if w0 <= d <= w1]
    if len(vals) < 2:
        return None
    a, b = vals[0], vals[-1]
    if a == 0:
        return None
    return b / a - 1.0


def yf_dual_window_returns(symbol: str, anchor: str) -> tuple[float | None, float | None]:
    mid = datetime.strptime(anchor, "%Y-%m-%d").date()
    start = mid - timedelta(days=14)
    end = mid + timedelta(days=14)
    pairs = _yf_close_pairs(symbol, start, end)
    if not pairs:
        return None, None
    w_wide = _return_decimal_in_window(pairs, mid - timedelta(days=7), mid + timedelta(days=7))
    w_evt = _return_decimal_in_window(pairs, mid - timedelta(days=2), mid + timedelta(days=2))
    return w_wide, w_evt


def compute_all_scenario_dual_returns(
    symbols: list[str],
    scenarios: list[dict[str, str]],
) -> tuple[dict[str, dict[str, float | None]], dict[str, dict[str, float | None]]]:
    wide: dict[str, dict[str, float | None]] = {}
    event: dict[str, dict[str, float | None]] = {}
    for sc in scenarios:
        aid = sc["id"]
        anchor = sc["anchor_date"]
        wide[aid] = {}
        event[aid] = {}
        if aid == CARBON_SCENARIO_ID:
            for sym in symbols:
                d = CARBON_RETURN_DECIMAL.get(sym)
                wide[aid][sym] = d
                event[aid][sym] = d
            continue
        for sym in symbols:
            w, e = yf_dual_window_returns(sym, anchor)
            wide[aid][sym] = w
            event[aid][sym] = e
    return wide, event


def _mispricing_signal(gap_pct: float) -> str:
    if abs(gap_pct) <= 1.5:
        return "fairly_priced"
    if gap_pct < 0:
        return "risk_underpriced"
    return "risk_over_shoot"


def _mispricing_narrative(
    symbol: str,
    predicted_pos: float,
    actual_pos: float,
    gap: float,
    signal: str,
) -> str:
    if signal == "fairly_priced":
        return f"{symbol}: model ({predicted_pos:+.1f}%) ≈ tape ({actual_pos:+.1f}%) in the event window."
    if signal == "risk_underpriced":
        return (
            f"{symbol}: model {predicted_pos:+.1f}% vs market {actual_pos:+.1f}% (gap {gap:+.1f}pp) — "
            "tape under-moved vs structural prior."
        )
    return (
        f"{symbol}: realized {actual_pos:+.1f}% vs model {predicted_pos:+.1f}% (gap {gap:+.1f}pp) — possible overshoot."
    )


def _row_risk_score(predicted_pos: float, gap: float, asset_class: str) -> int:
    base = 36 + min(30, abs(predicted_pos) * 1.6) + min(24, abs(gap) * 0.85)
    if asset_class == "equity":
        base += 5
    return int(max(12, min(100, base)))


def build_mispricing_actions(rows: list[dict[str, Any]]) -> list[str]:
    """Rule-based playbook lines (demo)."""
    by_sym = {r["symbol"]: r for r in rows}
    lines: list[str] = []

    ng = by_sym.get("NG=F")
    if ng and ng.get("gap_pct") is not None and abs(float(ng["gap_pct"])) <= 1.5:
        lines.append(f"✓ HOLD      GAS short — hedge working, gap {float(ng['gap_pct']):+.1f}%")

    egp = by_sym.get("EGP")
    if egp and egp.get("gap_pct") is not None and str(egp.get("direction")) == "long":
        g = float(egp["gap_pct"])
        if g < -1.5:
            lines.append(f"⚠ REDUCE    EGP long 25% — model gap {g:.1f}%, underpriced")

    vlo = by_sym.get("VLO")
    if vlo and vlo.get("gap_pct") is not None and str(vlo.get("direction")) == "long":
        g = float(vlo["gap_pct"])
        if g < -1.5:
            lines.append(f"⚠ ADD HEDGE VLO puts — gap {g:.1f}%, market lagging model")

    all_r = by_sym.get("ALL")
    if all_r and all_r.get("gap_pct") is not None:
        g = float(all_r["gap_pct"])
        if abs(g) <= 1.5:
            lines.append(f"✓ MONITOR   ALL — gap {g:+.1f}%, fairly priced")

    # Pad to 4 lines with fallbacks
    fallbacks = [
        "✓ MONITOR   Book — review mispricing table for secondary names.",
        "⚠ REVIEW    CL=F vs scenario hazard — commodity gap drives sleeve beta.",
        "✓ HOLD      Core book — no extreme gap flags on remaining legs.",
    ]
    i = 0
    while len(lines) < 4 and i < len(fallbacks):
        if fallbacks[i] not in lines:
            lines.append(fallbacks[i])
        i += 1
    return lines[:4]


def build_mispricing_by_scenario(
    positions: list[dict[str, Any]],
    scenarios: list[dict[str, str]],
    event_returns: dict[str, dict[str, float | None]],
    facilities: list[dict[str, Any]],
) -> dict[str, Any]:
    by_scenario: dict[str, Any] = {}
    for sc in scenarios:
        aid = sc["id"]
        hazard = str(sc.get("hazard", "hurricane"))
        per_sym_evt = event_returns.get(aid, {})
        rows: list[dict[str, Any]] = []
        for p in positions:
            sym = p["symbol"]
            direction = str(p.get("direction", "long"))
            ac = str(p.get("asset_class", "equity"))
            name = str(p.get("name", sym))
            und_pred = sensitivity_underlying_pct(sym, hazard, facilities, ac)
            pred_pos = position_return_from_underlying(und_pred, direction)
            ev_dec = per_sym_evt.get(sym)
            if ev_dec is None:
                rows.append(
                    {
                        "symbol": sym,
                        "name": name,
                        "direction": direction,
                        "asset_class": ac,
                        "predicted_position_return_pct": pred_pos,
                        "actual_position_return_pct": None,
                        "underlying_actual_return_pct": None,
                        "gap_pct": None,
                        "signal": "no_data",
                        "risk_score_0_100": _row_risk_score(pred_pos, 0.0, ac),
                        "narrative": f"{sym}: no yfinance bars in anchor ±2d window — cannot score mispricing.",
                    }
                )
                continue
            und_act_pct = round(float(ev_dec) * 100.0, 3)
            act_pos = position_return_from_underlying(und_act_pct, direction)
            gap = round(pred_pos - act_pos, 3)
            sig = _mispricing_signal(gap)
            rows.append(
                {
                    "symbol": sym,
                    "name": name,
                    "direction": direction,
                    "asset_class": ac,
                    "predicted_position_return_pct": pred_pos,
                    "actual_position_return_pct": act_pos,
                    "underlying_actual_return_pct": und_act_pct,
                    "gap_pct": gap,
                    "signal": sig,
                    "risk_score_0_100": _row_risk_score(pred_pos, gap, ac),
                    "narrative": _mispricing_narrative(sym, pred_pos, act_pos, gap, sig),
                }
            )
        rows.sort(key=lambda r: abs(float(r.get("gap_pct") or 0)), reverse=True)
        actions = build_mispricing_actions(rows)
        by_scenario[aid] = {
            "label": sc["label"],
            "hazard": hazard,
            "anchor_date": sc["anchor_date"],
            "rows": rows,
            "actions": actions,
        }
    return {
        "methodology": (
            "predicted = hardcoded hazard sensitivity × facility footprint score (equities) or full sensitivity "
            "(commodities); actual = yfinance underlying return over anchor ±2 calendar days (position return "
            "applies long/short); gap = predicted − actual. Carbon scenario uses hardcoded path (gap ~0)."
        ),
        "event_window": "anchor_date ± 2 calendar days",
        "by_scenario": by_scenario,
    }


def build_diversification_fiction() -> dict[str, Any]:
    return json.loads(json.dumps(DIVERSIFICATION_FICTION))


def live_risk_score_for_position(position: dict[str, Any], facilities: list[dict[str, Any]]) -> int:
    sym = str(position["symbol"])
    ac = str(position.get("asset_class", "equity"))
    q = position.get("quote") or {}
    chg = abs(q.get("change_pct_1d") or 0)
    if ac == "commodity":
        sens = max(abs(SENSITIVITY_PCT.get((sym, "hurricane"), 0)), abs(SENSITIVITY_PCT.get((sym, "freeze"), 0)))
        return int(max(18, min(100, 48 + sens * 0.85 + min(18, chg * 0.38))))
    fp = facility_footprint_score(sym, "hurricane", facilities)
    return int(max(14, min(100, 30 + fp * 48 + min(22, chg * 0.36))))
