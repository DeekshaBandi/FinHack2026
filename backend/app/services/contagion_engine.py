from __future__ import annotations
"""
Contagion Engine — BFS cascade propagation through supply chain graph.

Builds a merged graph from 3 edge sources:
1. Direct supply chain relationships (curated)
2. BEA Input-Output inter-industry flows
3. Geographic co-exposure (facilities in same hazard zone)

Then runs BFS propagation from epicenter nodes with decay.
"""

import json
from collections import defaultdict
from pathlib import Path

from app.models.schemas import (
    ContagionEdge,
    ContagionNode,
    ContagionResponse,
    ContagionTimelineStep,
)

DATA_DIR = Path(__file__).parent.parent / "data"

DECAY_FACTOR = 0.6
CONTAGION_THRESHOLD = 0.05
GEO_CO_EXPOSURE_WEIGHT = 0.25


def _load_json(filename: str) -> list | dict:
    with open(DATA_DIR / filename, "r") as f:
        return json.load(f)


def _build_company_lookup() -> dict[str, dict]:
    companies = _load_json("companies.json")
    return {c["ticker"]: c for c in companies}


def _build_industry_map(companies: dict[str, dict]) -> dict[str, str]:
    return {ticker: c["industry"] for ticker, c in companies.items()}


def _build_supply_chain_edges() -> list[dict]:
    return _load_json("supply_chain.json")


def _build_bea_edges(
    companies: dict[str, dict], industry_map: dict[str, str]
) -> list[dict]:
    """Map BEA inter-industry flows to company-to-company edges."""
    bea = _load_json("bea_io_table.json")
    flow_lookup: dict[tuple[str, str], float] = {}
    for flow in bea["flows"]:
        flow_lookup[(flow["from"], flow["to"])] = flow["weight"]

    edges: list[dict] = []
    tickers = list(companies.keys())
    for i, t1 in enumerate(tickers):
        for t2 in tickers[i + 1 :]:
            ind1 = industry_map[t1]
            ind2 = industry_map[t2]
            w_forward = flow_lookup.get((ind1, ind2), 0.0)
            w_backward = flow_lookup.get((ind2, ind1), 0.0)
            if w_forward > 0:
                edges.append(
                    {
                        "source": t1,
                        "target": t2,
                        "weight": w_forward * 0.5,
                        "relationship_type": "bea_io",
                    }
                )
            if w_backward > 0:
                edges.append(
                    {
                        "source": t2,
                        "target": t1,
                        "weight": w_backward * 0.5,
                        "relationship_type": "bea_io",
                    }
                )
    return edges


def _build_geo_edges(companies: dict[str, dict]) -> list[dict]:
    """Companies with facilities in the same hazard region get a co-exposure edge."""
    facilities = _load_json("facility_locations.json")
    region_tickers: dict[str, set[str]] = defaultdict(set)
    for f in facilities:
        region_tickers[f["region"]].add(f["ticker"])

    edges: list[dict] = []
    for region, tickers in region_tickers.items():
        ticker_list = sorted(tickers)
        for i, t1 in enumerate(ticker_list):
            for t2 in ticker_list[i + 1 :]:
                edges.append(
                    {
                        "source": t1,
                        "target": t2,
                        "weight": GEO_CO_EXPOSURE_WEIGHT,
                        "relationship_type": f"geo_co_exposure_{region}",
                    }
                )
    return edges


def build_merged_graph() -> tuple[dict[str, dict], dict[str, list[tuple[str, float]]]]:
    """Build the merged graph from all 3 edge sources.

    Returns:
        companies: ticker -> company dict
        adjacency: ticker -> [(neighbor_ticker, weight)]
    """
    companies = _build_company_lookup()
    industry_map = _build_industry_map(companies)

    all_edges = (
        _build_supply_chain_edges()
        + _build_bea_edges(companies, industry_map)
        + _build_geo_edges(companies)
    )

    adjacency: dict[str, list[tuple[str, float]]] = defaultdict(list)
    edge_max: dict[tuple[str, str], float] = {}

    for e in all_edges:
        src, tgt = e["source"], e["target"]
        if src not in companies or tgt not in companies:
            continue
        key = (src, tgt)
        edge_max[key] = max(edge_max.get(key, 0.0), e["weight"])

    for (src, tgt), weight in edge_max.items():
        adjacency[src].append((tgt, weight))
        adjacency[tgt].append((src, weight))

    return companies, adjacency


def propagate(
    epicenter_tickers: list[str],
    event_type: str,
    severity: int,
    companies: dict[str, dict],
    adjacency: dict[str, list[tuple[str, float]]],
) -> tuple[list[ContagionTimelineStep], dict[str, float]]:
    """BFS cascade propagation from epicenter nodes.

    Returns:
        timeline: list of steps with affected nodes
        impacts: ticker -> total contagion impact score
    """
    severity_multiplier = severity / 5.0

    queue: list[tuple[str, float]] = []
    for ticker in epicenter_tickers:
        if ticker not in companies:
            continue
        company = companies[ticker]
        exposure = company["climate_exposure"].get(event_type, 0.3)
        direct_impact = severity_multiplier * exposure
        queue.append((ticker, direct_impact))

    visited: dict[str, float] = {}
    timeline: list[ContagionTimelineStep] = []
    step = 0

    while queue:
        next_queue: list[tuple[str, float]] = []
        step_nodes: list[dict[str, float]] = []

        for ticker, impact in queue:
            if ticker in visited:
                continue
            visited[ticker] = impact
            step_nodes.append({"ticker": ticker, "impact": round(impact, 4)})

            for neighbor, edge_weight in adjacency.get(ticker, []):
                propagated = impact * edge_weight * DECAY_FACTOR
                if propagated > CONTAGION_THRESHOLD and neighbor not in visited:
                    next_queue.append((neighbor, propagated))

        if step_nodes:
            timeline.append(
                ContagionTimelineStep(step=step, nodes=step_nodes)
            )
        queue = next_queue
        step += 1

    return timeline, visited


def get_full_network(
    epicenter_tickers: list[str] | None = None,
    event_type: str = "hurricane",
    severity: int = 3,
) -> ContagionResponse:
    """Get the full contagion network with optional simulation."""
    companies, adjacency = build_merged_graph()

    if epicenter_tickers:
        timeline, impacts = propagate(
            epicenter_tickers, event_type, severity, companies, adjacency
        )
    else:
        timeline = []
        impacts = {}

    nodes: list[ContagionNode] = []
    for ticker, company in companies.items():
        score = impacts.get(ticker, 0.0)
        risk_level = (
            "critical" if score > 0.5
            else "high" if score > 0.3
            else "medium" if score > 0.1
            else "low"
        )
        nodes.append(
            ContagionNode(
                id=ticker,
                name=company["name"],
                sector=company["sector"],
                hq_lat=company["hq_lat"],
                hq_lng=company["hq_lng"],
                market_cap=company["market_cap"],
                direct_exposure=sum(company["climate_exposure"].values()) / 5,
                contagion_score=round(score, 4),
                risk_level=risk_level,
            )
        )

    seen_edges: set[tuple[str, str]] = set()
    edges: list[ContagionEdge] = []
    for ticker in companies:
        for neighbor, weight in adjacency.get(ticker, []):
            edge_key = tuple(sorted([ticker, neighbor]))
            if edge_key not in seen_edges:
                seen_edges.add(edge_key)
                is_active = ticker in impacts and neighbor in impacts
                edges.append(
                    ContagionEdge(
                        source=ticker,
                        target=neighbor,
                        weight=round(weight, 3),
                        is_active=is_active,
                    )
                )

    total_contagion = sum(
        v for k, v in impacts.items()
        if epicenter_tickers and k not in epicenter_tickers
    )

    return ContagionResponse(
        nodes=nodes,
        edges=edges,
        timeline=timeline,
        total_contagion_risk=round(total_contagion, 4),
    )
