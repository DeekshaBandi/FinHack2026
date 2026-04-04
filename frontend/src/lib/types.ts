export interface ContagionNode {
  id: string;
  name: string;
  sector: string;
  hq_lat: number;
  hq_lng: number;
  market_cap: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  direct_exposure: number;
  contagion_score: number;
  risk_level: "low" | "medium" | "high" | "critical";
}

export interface ContagionEdge {
  source: string | ContagionNode;
  target: string | ContagionNode;
  weight: number;
  is_active: boolean;
}

export interface ContagionTimelineStep {
  step: number;
  nodes: Array<{ ticker: string; impact: number }>;
}

export interface ContagionResponse {
  nodes: ContagionNode[];
  edges: ContagionEdge[];
  timeline: ContagionTimelineStep[];
  total_contagion_risk: number;
}

export interface SimulateRequest {
  epicenter_tickers: string[];
  event_type: string;
  severity: number;
}

export interface StressTestRequest {
  scenario_id?: string;
  event_type: string;
  severity: number;
  target_region: string;
}

export interface FinancialChainStep {
  step_name: string;
  description: string;
  value: number;
  unit: string;
}

export interface CompanyStressResult {
  ticker: string;
  name: string;
  direction: string;
  chain_steps: FinancialChainStep[];
  equity_impact_pct: number;
  pnl_impact: number;
  resilience: string;
}

export interface StressTestResponse {
  scenario_name: string;
  event_type: string;
  severity: number;
  target_region: string;
  company_results: CompanyStressResult[];
  portfolio_pnl: number;
  long_book_pnl: number;
  short_book_pnl: number;
  hedge_effectiveness: number;
  concentration_alerts: string[];
}

export interface Scenario {
  id: string;
  name: string;
  event_type: string;
  severity: number;
  target_region: string;
  description: string;
  affected_sectors: string[];
  historical_reference: string;
}

export interface ChatRequest {
  message: string;
  context?: string;
}

export interface ChatResponse {
  response: string;
  sources: string[];
}
