from __future__ import annotations
"""
Risk Engine — Climate VaR calculator, portfolio-level stress test aggregation,
long/short P&L accounting, and hidden concentration detection.
"""

import json
from pathlib import Path

from app.models.schemas import StressTestRequest, StressTestResponse
from app.services.contagion_engine import build_merged_graph, propagate
from app.services.financial_chain import run_financial_chain, _load_facilities

DATA_DIR = Path(__file__).parent.parent / "data"

# Default demo portfolio (hedge fund style: longs + shorts)
DEFAULT_PORTFOLIO = [
    {"ticker": "AAPL", "shares": 5000, "direction": "long", "weight": 0.08},
    {"ticker": "MSFT", "shares": 4000, "direction": "long", "weight": 0.07},
    {"ticker": "GOOGL", "shares": 2000, "direction": "long", "weight": 0.06},
    {"ticker": "NVDA", "shares": 3000, "direction": "long", "weight": 0.07},
    {"ticker": "AMZN", "shares": 3500, "direction": "long", "weight": 0.06},
    {"ticker": "JPM", "shares": 6000, "direction": "long", "weight": 0.06},
    {"ticker": "NEE", "shares": 8000, "direction": "long", "weight": 0.05},
    {"ticker": "UNH", "shares": 2000, "direction": "long", "weight": 0.05},
    {"ticker": "HD", "shares": 4000, "direction": "long", "weight": 0.04},
    {"ticker": "TSLA", "shares": 3000, "direction": "long", "weight": 0.05},
    {"ticker": "PLD", "shares": 5000, "direction": "long", "weight": 0.04},
    {"ticker": "CAT", "shares": 3000, "direction": "long", "weight": 0.03},
    {"ticker": "ADM", "shares": 6000, "direction": "long", "weight": 0.03},
    {"ticker": "AWK", "shares": 4000, "direction": "long", "weight": 0.02},
    {"ticker": "ENPH", "shares": 5000, "direction": "long", "weight": 0.02},
    # Short positions (hedges against climate risk)
    {"ticker": "XOM", "shares": 5000, "direction": "short", "weight": 0.06},
    {"ticker": "CVX", "shares": 4000, "direction": "short", "weight": 0.05},
    {"ticker": "VLO", "shares": 6000, "direction": "short", "weight": 0.04},
    {"ticker": "MPC", "shares": 5000, "direction": "short", "weight": 0.03},
    {"ticker": "HES", "shares": 4000, "direction": "short", "weight": 0.02},
    {"ticker": "AIG", "shares": 5000, "direction": "short", "weight": 0.03},
    {"ticker": "LYB", "shares": 4000, "direction": "short", "weight": 0.02},
    {"ticker": "SPG", "shares": 3000, "direction": "short", "weight": 0.02},
]


def _load_companies() -> dict[str, dict]:
    with open(DATA_DIR / "companies.json", "r") as f:
        companies = json.load(f)
    return {c["ticker"]: c for c in companies}


def run_portfolio_stress_test(
    request: StressTestRequest,
    portfolio: list[dict] | None = None,
) -> StressTestResponse:
    """Run stress test across entire portfolio with contagion and financial chain."""
    if portfolio is None:
        portfolio = DEFAULT_PORTFOLIO

    companies = _load_companies()
    facilities_map = _load_facilities()

    # Get scenario metadata
    scenarios = _load_scenarios()
    scenario = None
    if request.scenario_id:
        scenario = next((s for s in scenarios if s["id"] == request.scenario_id), None)

    scenario_name = scenario["name"] if scenario else f"{request.event_type.title()} — Severity {request.severity}"

    # Step 1: Run contagion to get indirect impact scores
    portfolio_tickers = [h["ticker"] for h in portfolio]
    _, adjacency = build_merged_graph()

    # Find epicenter companies (in target region with high exposure)
    epicenter_tickers = []
    for h in portfolio:
        company = companies.get(h["ticker"])
        if not company:
            continue
        if company["hq_region"] == request.target_region or request.target_region in ("nationwide", "coastal"):
            exposure = company["climate_exposure"].get(request.event_type, 0.0)
            if exposure > 0.5:
                epicenter_tickers.append(h["ticker"])

    if not epicenter_tickers:
        epicenter_tickers = portfolio_tickers[:3]

    _, contagion_impacts = propagate(
        epicenter_tickers, request.event_type, request.severity,
        companies, adjacency,
    )

    # Step 2: Run financial chain for each holding
    company_results = []
    long_book_pnl = 0.0
    short_book_pnl = 0.0

    for holding in portfolio:
        company = companies.get(holding["ticker"])
        if not company:
            continue

        contagion_score = contagion_impacts.get(holding["ticker"], 0.0)

        result = run_financial_chain(
            company=company,
            event_type=request.event_type,
            severity=request.severity,
            target_region=request.target_region,
            contagion_score=contagion_score,
            facilities_map=facilities_map,
        )

        # Adjust for position direction
        result.direction = holding["direction"]
        position_pnl = result.pnl_impact * holding["weight"]

        if holding["direction"] == "short":
            position_pnl = -position_pnl  # Shorts profit when stocks drop
            result.pnl_impact = -result.pnl_impact

        if holding["direction"] == "long":
            long_book_pnl += position_pnl
        else:
            short_book_pnl += position_pnl

        company_results.append(result)

    portfolio_pnl = long_book_pnl + short_book_pnl

    # Hedge effectiveness: how much of long losses offset by short gains
    long_losses = abs(min(long_book_pnl, 0))
    short_gains = max(short_book_pnl, 0)
    hedge_effectiveness = (short_gains / max(long_losses, 1.0)) * 100
    hedge_effectiveness = min(hedge_effectiveness, 100.0)

    # Concentration alerts
    alerts = _detect_concentration(company_results, companies, request)

    # Sort by absolute impact
    company_results.sort(key=lambda r: abs(r.pnl_impact), reverse=True)

    return StressTestResponse(
        scenario_name=scenario_name,
        event_type=request.event_type,
        severity=request.severity,
        target_region=request.target_region,
        company_results=company_results,
        portfolio_pnl=round(portfolio_pnl, 1),
        long_book_pnl=round(long_book_pnl, 1),
        short_book_pnl=round(short_book_pnl, 1),
        hedge_effectiveness=round(hedge_effectiveness, 1),
        concentration_alerts=alerts,
    )


def _detect_concentration(
    results: list, companies: dict[str, dict], request: StressTestRequest
) -> list[str]:
    """Detect hidden concentration risks."""
    alerts: list[str] = []

    # Group by sector impact
    sector_impacts: dict[str, float] = {}
    for r in results:
        company = companies.get(r.ticker)
        if company:
            sector = company["sector"]
            sector_impacts[sector] = sector_impacts.get(sector, 0) + abs(r.pnl_impact)

    total_impact = sum(sector_impacts.values()) or 1.0
    for sector, impact in sorted(sector_impacts.items(), key=lambda x: -x[1]):
        pct = (impact / total_impact) * 100
        if pct > 40:
            alerts.append(
                f"Hidden concentration: {sector} accounts for {pct:.0f}% of total stress impact"
            )

    # Check correlated movements
    high_impact = [r for r in results if abs(r.equity_impact_pct) > 10]
    if len(high_impact) > 5:
        alerts.append(
            f"{len(high_impact)} holdings show >10% equity impact — portfolio is highly correlated to {request.event_type} risk"
        )

    # Check if shorts are in same region as longs
    long_regions = set()
    short_regions = set()
    for r in results:
        company = companies.get(r.ticker)
        if company:
            if r.direction == "long":
                long_regions.add(company["hq_region"])
            else:
                short_regions.add(company["hq_region"])

    overlap = long_regions & short_regions
    if overlap and request.target_region in overlap:
        alerts.append(
            f"Warning: Both long and short positions concentrated in {request.target_region} — hedge may not provide protection"
        )

    return alerts


def _load_scenarios() -> list[dict]:
    with open(DATA_DIR / "scenarios.json", "r") as f:
        return json.load(f)


def calculate_climate_var(portfolio: list[dict] | None = None) -> dict:
    """Calculate Climate VaR (95th percentile) across all hazard types."""
    if portfolio is None:
        portfolio = DEFAULT_PORTFOLIO

    companies = _load_companies()

    physical_var = 0.0
    transition_var = 0.0
    contagion_var = 0.0

    for holding in portfolio:
        company = companies.get(holding["ticker"])
        if not company:
            continue

        exposure = company["climate_exposure"]
        weight = holding["weight"]
        market_val = company["market_cap"] * weight

        # Physical risk: weighted average of physical hazard exposures
        physical_score = (
            exposure["hurricane"] * 0.30
            + exposure["wildfire"] * 0.20
            + exposure["flood"] * 0.25
            + exposure["drought"] * 0.15
            + exposure["sea_level_rise"] * 0.10
        )
        physical_var += market_val * physical_score * 0.05

        # Transition risk: carbon-intensive sectors
        transition_score = 0.0
        if company["sector"] in ("Energy", "Materials", "Industrials"):
            transition_score = 0.15
        elif company["sector"] in ("Utilities",):
            transition_score = 0.08
        transition_var += market_val * transition_score * 0.05

    # Contagion VaR (simplified — based on average supply chain density)
    contagion_var = (physical_var + transition_var) * 0.12

    total_var = physical_var + transition_var + contagion_var

    return {
        "climate_var_95": round(total_var, 1),
        "physical_risk_var": round(physical_var, 1),
        "transition_risk_var": round(transition_var, 1),
        "contagion_risk_var": round(contagion_var, 1),
    }
