"""
7-Step Deterministic Financial Chain

Input: climate_event, severity (1-5), company data
Output: equity valuation impact + full chain breakdown

Steps:
1. Physical Asset Damage
2. Revenue Disruption
3. Operating Cost Spike
4. EBITDA Compression
5. Debt Coverage Deterioration
6. Credit Rating Pressure
7. Equity Valuation Impact
"""

import json
from pathlib import Path

from app.models.schemas import CompanyStressResult, FinancialChainStep

DATA_DIR = Path(__file__).parent.parent / "data"

# Severity → damage rate by event type (fraction of assets damaged)
DAMAGE_RATES: dict[str, dict[int, float]] = {
    "hurricane": {1: 0.05, 2: 0.12, 3: 0.22, 4: 0.38, 5: 0.55},
    "wildfire": {1: 0.03, 2: 0.08, 3: 0.18, 4: 0.32, 5: 0.48},
    "flood": {1: 0.04, 2: 0.10, 3: 0.20, 4: 0.35, 5: 0.50},
    "drought": {1: 0.02, 2: 0.05, 3: 0.12, 4: 0.22, 5: 0.35},
    "sea_level_rise": {1: 0.02, 2: 0.06, 3: 0.14, 4: 0.25, 5: 0.40},
    "carbon_tax": {1: 0.01, 2: 0.03, 3: 0.08, 4: 0.15, 5: 0.25},
    "compound": {1: 0.06, 2: 0.15, 3: 0.28, 4: 0.45, 5: 0.65},
}

# Severity → days offline
DOWNTIME_DAYS: dict[str, dict[int, int]] = {
    "hurricane": {1: 5, 2: 14, 3: 30, 4: 60, 5: 90},
    "wildfire": {1: 3, 2: 10, 3: 21, 4: 45, 5: 75},
    "flood": {1: 4, 2: 12, 3: 25, 4: 50, 5: 80},
    "drought": {1: 0, 2: 5, 3: 15, 4: 30, 5: 60},
    "sea_level_rise": {1: 2, 2: 7, 3: 14, 4: 28, 5: 45},
    "carbon_tax": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
    "compound": {1: 7, 2: 18, 3: 35, 4: 70, 5: 100},
}

REPAIR_RATE = 0.15
SUPPLY_CHAIN_DISRUPTION_RATE = 0.08

# Credit rating thresholds (coverage ratio → potential downgrade notches)
COVERAGE_THRESHOLDS = [
    (1.0, 3),  # Below 1.0x → 3 notch downgrade
    (1.5, 2),  # Below 1.5x → 2 notch downgrade
    (2.5, 1),  # Below 2.5x → 1 notch downgrade
]


def _load_facilities() -> dict[str, list[dict]]:
    with open(DATA_DIR / "facility_locations.json", "r") as f:
        facilities = json.load(f)
    result: dict[str, list[dict]] = {}
    for fac in facilities:
        result.setdefault(fac["ticker"], []).append(fac)
    return result


def _facilities_in_region(
    facilities: list[dict], target_region: str
) -> tuple[int, float]:
    """Count facilities and asset exposure in the target region."""
    total = len(facilities)
    in_zone = 0
    asset_exposure = 0.0
    for fac in facilities:
        if fac["region"] == target_region or target_region == "nationwide" or target_region == "coastal":
            if target_region == "coastal" and fac["region"] not in (
                "gulf_coast", "southeast", "northeast", "california", "pacific_northwest"
            ):
                continue
            in_zone += 1
            asset_exposure += fac["asset_value_pct"]
    return in_zone, min(asset_exposure, 1.0)


def run_financial_chain(
    company: dict,
    event_type: str,
    severity: int,
    target_region: str,
    contagion_score: float = 0.0,
    facilities_map: dict[str, list[dict]] | None = None,
) -> CompanyStressResult:
    """Run the 7-step deterministic financial chain for a single company."""
    ticker = company["ticker"]

    if facilities_map is None:
        facilities_map = _load_facilities()
    company_facilities = facilities_map.get(ticker, [])

    damage_table = DAMAGE_RATES.get(event_type, DAMAGE_RATES["hurricane"])
    downtime_table = DOWNTIME_DAYS.get(event_type, DOWNTIME_DAYS["hurricane"])

    # Step 1: Physical Asset Damage
    total_facilities = max(len(company_facilities), 1)
    in_zone, asset_exposure = _facilities_in_region(company_facilities, target_region)
    damage_rate = damage_table.get(severity, 0.22)

    # Factor in company's climate exposure for this event type
    exposure_score = company["climate_exposure"].get(event_type, 0.3)
    asset_damage_pct = asset_exposure * damage_rate * exposure_score
    asset_damage_value = asset_damage_pct * company["total_assets"]

    # Step 2: Revenue Disruption
    days_offline = downtime_table.get(severity, 30)
    daily_revenue = company["annual_revenue"] / 365
    revenue_loss = days_offline * daily_revenue * asset_damage_pct

    # Step 3: Operating Cost Spike
    repair_cost = asset_damage_pct * company["total_assets"] * REPAIR_RATE
    supply_chain_cost = contagion_score * company["annual_revenue"] * SUPPLY_CHAIN_DISRUPTION_RATE
    cost_spike = repair_cost + supply_chain_cost

    # Step 4: EBITDA Compression
    ebitda_impact = -(revenue_loss + cost_spike)
    new_ebitda = max(company["ebitda"] + ebitda_impact, 1.0)

    # Step 5: Debt Coverage Deterioration
    interest = max(company["interest_expense"], 1.0)
    baseline_coverage = company["ebitda"] / interest
    new_coverage = new_ebitda / interest
    coverage_delta = new_coverage - baseline_coverage

    # Step 6: Credit Rating Pressure
    notches_downgrade = 0
    for threshold, notches in COVERAGE_THRESHOLDS:
        if new_coverage < threshold:
            notches_downgrade = notches
            break

    # Step 7: Equity Valuation Impact
    ev_multiple = company["ev_ebitda_multiple"]
    new_ev = new_ebitda * ev_multiple
    new_equity = new_ev - company["net_debt"]
    current_equity = company["market_cap"]
    equity_impact_pct = (new_equity - current_equity) / max(current_equity, 1.0)
    equity_impact_pct = max(min(equity_impact_pct, 0.5), -0.95)

    # Resilience verdict
    if equity_impact_pct > -0.05:
        resilience = "absorbs_shock"
    elif equity_impact_pct > -0.15:
        resilience = "moderate_stress"
    elif equity_impact_pct > -0.30:
        resilience = "significant_stress"
    else:
        resilience = "faces_distress"

    chain_steps = [
        FinancialChainStep(
            step_name="Physical Asset Damage",
            description=f"{in_zone}/{total_facilities} facilities in {target_region}, {damage_rate*100:.0f}% damage rate",
            value=round(asset_damage_value, 1),
            unit="$M",
        ),
        FinancialChainStep(
            step_name="Revenue Disruption",
            description=f"{days_offline} days offline, ${daily_revenue:.1f}M/day affected",
            value=round(-revenue_loss, 1),
            unit="$M",
        ),
        FinancialChainStep(
            step_name="Operating Cost Spike",
            description=f"Repair: ${repair_cost:.1f}M + Supply chain: ${supply_chain_cost:.1f}M",
            value=round(-cost_spike, 1),
            unit="$M",
        ),
        FinancialChainStep(
            step_name="EBITDA Compression",
            description=f"${company['ebitda']:.0f}M → ${new_ebitda:.0f}M",
            value=round(ebitda_impact, 1),
            unit="$M",
        ),
        FinancialChainStep(
            step_name="Debt Coverage",
            description=f"Coverage ratio: {baseline_coverage:.1f}x → {new_coverage:.1f}x",
            value=round(coverage_delta, 2),
            unit="x",
        ),
        FinancialChainStep(
            step_name="Credit Pressure",
            description=f"{notches_downgrade} notch{'es' if notches_downgrade != 1 else ''} potential downgrade",
            value=float(-notches_downgrade),
            unit="notches",
        ),
        FinancialChainStep(
            step_name="Equity Impact",
            description=f"EV/EBITDA {ev_multiple}x → equity change {equity_impact_pct*100:.1f}%",
            value=round(equity_impact_pct * 100, 2),
            unit="%",
        ),
    ]

    pnl_impact = equity_impact_pct * current_equity

    return CompanyStressResult(
        ticker=ticker,
        name=company["name"],
        direction="long",
        chain_steps=chain_steps,
        equity_impact_pct=round(equity_impact_pct * 100, 2),
        pnl_impact=round(pnl_impact, 1),
        resilience=resilience,
    )
