"""Post-stress-test recommendation engine."""

from app.models.schemas import RecommendationItem, RecommendationsResponse, StressTestResponse


def generate_recommendations(stress_result: StressTestResponse) -> RecommendationsResponse:
    hedging: list[RecommendationItem] = []
    rebalancing: list[RecommendationItem] = []
    opportunistic: list[RecommendationItem] = []

    worst = [r for r in stress_result.company_results if r.equity_impact_pct < -10 and r.direction == "long"]
    best_shorts = [r for r in stress_result.company_results if r.direction == "short" and r.pnl_impact > 0]

    if stress_result.hedge_effectiveness < 50:
        hedging.append(RecommendationItem(
            category="hedging", priority="high",
            action=f"Increase short exposure — current hedge covers only {stress_result.hedge_effectiveness:.0f}% of tail risk",
            rationale="Portfolio is underhedged against this climate scenario",
        ))

    for r in worst[:3]:
        hedging.append(RecommendationItem(
            category="hedging", priority="high",
            action=f"Add put protection on {r.ticker} (equity impact: {r.equity_impact_pct:.1f}%)",
            rationale=f"{r.name} shows {r.resilience.replace('_', ' ')} under this scenario",
        ))

    for r in worst[:2]:
        rebalancing.append(RecommendationItem(
            category="rebalancing", priority="medium",
            action=f"Reduce {r.ticker} weight — high vulnerability to {stress_result.event_type}",
            rationale=f"Equity impact of {r.equity_impact_pct:.1f}% exceeds risk tolerance",
        ))

    resilient = [r for r in stress_result.company_results if r.resilience == "absorbs_shock" and r.direction == "long"]
    for r in resilient[:2]:
        opportunistic.append(RecommendationItem(
            category="opportunistic", priority="low",
            action=f"Increase {r.ticker} — resilient to {stress_result.event_type} events",
            rationale=f"{r.name} absorbs shock with only {r.equity_impact_pct:.1f}% impact",
        ))

    if stress_result.concentration_alerts:
        rebalancing.append(RecommendationItem(
            category="rebalancing", priority="high",
            action="Diversify sector concentration identified in stress test",
            rationale=stress_result.concentration_alerts[0],
        ))

    return RecommendationsResponse(hedging=hedging, rebalancing=rebalancing, opportunistic=opportunistic)
