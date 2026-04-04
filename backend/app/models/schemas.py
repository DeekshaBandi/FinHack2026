from __future__ import annotations
from pydantic import BaseModel, Field


# ── Company & Portfolio ────────────────────────────────────────

class ClimateExposure(BaseModel):
    hurricane: float = Field(ge=0.0, le=1.0)
    wildfire: float = Field(ge=0.0, le=1.0)
    flood: float = Field(ge=0.0, le=1.0)
    drought: float = Field(ge=0.0, le=1.0)
    sea_level_rise: float = Field(ge=0.0, le=1.0)


class Company(BaseModel):
    ticker: str
    name: str
    sector: str
    industry: str
    hq_lat: float
    hq_lng: float
    hq_region: str
    annual_revenue: float
    ebitda: float
    total_assets: float
    net_debt: float
    interest_expense: float
    ev_ebitda_multiple: float
    market_cap: float
    climate_exposure: ClimateExposure


class PortfolioHolding(BaseModel):
    ticker: str
    shares: int
    direction: str = Field(pattern="^(long|short)$")
    weight: float = Field(ge=0.0, le=1.0)


class PortfolioRequest(BaseModel):
    holdings: list[PortfolioHolding]


# ── Supply Chain ───────────────────────────────────────────────

class SupplyChainEdge(BaseModel):
    source: str
    target: str
    weight: float = Field(ge=0.0, le=1.0)
    relationship_type: str


# ── Contagion ──────────────────────────────────────────────────

class ContagionNode(BaseModel):
    id: str
    name: str
    sector: str
    hq_lat: float = 0.0
    hq_lng: float = 0.0
    market_cap: float = 0.0
    x: float | None = None
    y: float | None = None
    direct_exposure: float = 0.0
    contagion_score: float = 0.0
    risk_level: str = "low"


class ContagionEdge(BaseModel):
    source: str
    target: str
    weight: float
    is_active: bool = False


class ContagionTimelineStep(BaseModel):
    step: int
    nodes: list[dict[str, float]]


class ContagionResponse(BaseModel):
    nodes: list[ContagionNode]
    edges: list[ContagionEdge]
    timeline: list[ContagionTimelineStep]
    total_contagion_risk: float


class ContagionSimulateRequest(BaseModel):
    epicenter_tickers: list[str]
    event_type: str
    severity: int = Field(ge=1, le=5, default=3)


# ── Stress Test ────────────────────────────────────────────────

class StressTestRequest(BaseModel):
    scenario_id: str | None = None
    event_type: str
    severity: int = Field(ge=1, le=5)
    target_region: str


class FinancialChainStep(BaseModel):
    step_name: str
    description: str
    value: float
    unit: str


class CompanyStressResult(BaseModel):
    ticker: str
    name: str
    direction: str
    chain_steps: list[FinancialChainStep]
    equity_impact_pct: float
    pnl_impact: float
    resilience: str


class StressTestResponse(BaseModel):
    scenario_name: str
    event_type: str
    severity: int
    target_region: str
    company_results: list[CompanyStressResult]
    portfolio_pnl: float
    long_book_pnl: float
    short_book_pnl: float
    hedge_effectiveness: float
    concentration_alerts: list[str]


# ── Heatmap ────────────────────────────────────────────────────

class FacilityLocation(BaseModel):
    ticker: str
    facility_name: str
    lat: float
    lng: float
    region: str
    asset_value_pct: float


class HazardZone(BaseModel):
    hazard_type: str
    region: str
    probability: float
    severity_range: list[int]
    lat: float
    lng: float
    radius_km: float


class HeatmapResponse(BaseModel):
    facilities: list[FacilityLocation]
    hazard_zones: list[HazardZone]


# ── Chat ───────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    context: str | None = None


class ChatResponse(BaseModel):
    response: str
    sources: list[str]


class RecommendationItem(BaseModel):
    category: str
    action: str
    rationale: str
    priority: str


class RecommendationsResponse(BaseModel):
    hedging: list[RecommendationItem]
    rebalancing: list[RecommendationItem]
    opportunistic: list[RecommendationItem]


# ── Dashboard ──────────────────────────────────────────────────

class DashboardResponse(BaseModel):
    climate_var_95: float
    physical_risk_var: float
    transition_risk_var: float
    contagion_risk_var: float
    risk_level: str
    top_exposures: list[dict]
    hedge_adequacy_pct: float
    hedged_amount: float
    unhedged_amount: float
    active_events: list[dict]
    recent_scenarios: list[dict]
