from __future__ import annotations
import json
from pathlib import Path

from fastapi import APIRouter

from app.services.risk_engine import calculate_climate_var, DEFAULT_PORTFOLIO

router = APIRouter()
DATA_DIR = Path(__file__).parent.parent / "data"


@router.get("/summary")
async def get_dashboard_summary() -> dict:
    var_data = calculate_climate_var()

    with open(DATA_DIR / "companies.json") as f:
        companies = {c["ticker"]: c for c in json.load(f)}

    # Top exposures
    top_exposures = []
    for h in DEFAULT_PORTFOLIO:
        c = companies.get(h["ticker"])
        if not c:
            continue
        exp = c["climate_exposure"]
        score = sum(exp.values()) / len(exp)
        top_exposures.append({
            "ticker": h["ticker"], "name": c["name"], "direction": h["direction"],
            "risk_score": round(score * 100, 0),
            "physical": round((exp["hurricane"] + exp["wildfire"] + exp["flood"]) / 3 * 100, 0),
            "transition": round((exp["drought"] + exp["sea_level_rise"]) / 2 * 100, 0),
            "weight": h["weight"],
        })
    top_exposures.sort(key=lambda x: x["risk_score"], reverse=True)

    # Hedge adequacy
    long_weight = sum(h["weight"] for h in DEFAULT_PORTFOLIO if h["direction"] == "long")
    short_weight = sum(h["weight"] for h in DEFAULT_PORTFOLIO if h["direction"] == "short")
    hedge_pct = (short_weight / max(long_weight, 0.01)) * 100

    risk_level = (
        "critical" if var_data["climate_var_95"] > 30
        else "high" if var_data["climate_var_95"] > 20
        else "moderate" if var_data["climate_var_95"] > 10
        else "low"
    )

    return {
        **var_data,
        "risk_level": risk_level,
        "top_exposures": top_exposures[:10],
        "hedge_adequacy_pct": round(hedge_pct, 1),
        "hedged_amount": round(var_data["climate_var_95"] * hedge_pct / 100, 1),
        "unhedged_amount": round(var_data["climate_var_95"] * (100 - hedge_pct) / 100, 1),
    }
