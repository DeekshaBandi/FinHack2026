export type ScenarioType = "hurricane" | "wildfire" | "flood" | "drought" | "carbon";
export type PositionType = "LONG" | "SHORT";
export type SeverityLevel = 1 | 2 | 3 | 4 | 5;
export type TimeHorizon = "1w" | "1m" | "1q" | "1y";
export type MarkerSize = "large" | "medium" | "small";
export type CreditPressure = "Low" | "Moderate" | "Elevated" | "Severe";
export type ResilienceVerdict = "Absorbs Shock" | "Struggles to Recover" | "Faces Distress";

export interface ScenarioEvent {
  id: ScenarioType;
  icon: string;
  label: string;
  summaryLabel: string;
  epicenter?: [number, number];
  footprintType: "radius" | "systemic";
  primaryDrivers: string[];
}

export interface ClimateSensitivity {
  physicalDamage: number;
  revenue: number;
  cost: number;
  credit: number;
  valuation: number;
}

export interface PortfolioHolding {
  id: string;
  ticker: string;
  companyName: string;
  positionType: PositionType;
  markerSize: MarkerSize;
  coordinates: [number, number];
  sector: string;
  positionMarketValue: number;
  portfolioWeight: number;
  annualRevenue: number;
  ebitdaMargin: number;
  debt: number;
  interestExpense: number;
  sharesOrExposureUnits: number;
  baselineValuationMultiple: number;
  dailyRevenue: number;
  repairCostSensitivity: number;
  recoverySpeed: number;
  hedgeRelevanceScore: number;
  geographicExposure: Record<ScenarioType, number>;
  facilitiesInImpactZonePct: Record<ScenarioType, number>;
  climateSensitivity: ClimateSensitivity;
  thematicDrivers: string[];
}

export interface ScenarioAssumptions {
  damageRate: number;
  downtimeDays: number;
  costMultiplier: number;
  spreadExpansionBps: number;
  valuationCompressionPct: number;
  timeHorizon: TimeHorizon;
}

export type ScenarioAssumptionOverride = Partial<ScenarioAssumptions>;

export interface ScenarioInputs {
  scenarioType: ScenarioType;
  severity: SeverityLevel;
  timeHorizon: TimeHorizon;
  overrides?: ScenarioAssumptionOverride;
}

export interface HoldingStressResult {
  ticker: string;
  companyName: string;
  positionType: PositionType;
  sector: string;
  markerSize: MarkerSize;
  coordinates: [number, number];
  exposureScore: number;
  exposurePct: number;
  physicalDamage: number;
  revenueLoss: number;
  costSpike: number;
  baselineEbitda: number;
  stressedEbitda: number;
  ebitdaDeltaPct: number;
  baselineInterestCoverage: number;
  stressedInterestCoverage: number;
  creditPressure: CreditPressure;
  equityMovePct: number;
  positionPnL: number;
  resilienceVerdict: ResilienceVerdict;
  impacted: boolean;
  diagnosticDrivers: string[];
}

export interface PortfolioStressSummary {
  totalPortfolioPnL: number;
  longBookImpact: number;
  shortBookImpact: number;
  netExposureAtRisk: number;
  holdingsImpactedCount: number;
  capitalAffected: number;
  hedgeEfficiencyPct: number;
  stressCoverageRatio: number;
  residualUnhedgedRisk: number;
}

export interface ResilienceDistribution {
  absorbsShock: number;
  strugglesToRecover: number;
  facesDistress: number;
}

export interface StressDiagnostics {
  concentrationAlerts: string[];
  underhedgedWarning: string | null;
  resilienceDistribution: ResilienceDistribution;
  hiddenConcentrationAlerts: string[];
}

export interface StressMapContext {
  impactedTickers: string[];
  unaffectedTickers: string[];
  footprintLabel: string;
  affectsAllHoldings: boolean;
  impactZoneRadiusMeters: number | null;
  impactZoneCenter?: [number, number];
}

export interface StressTestResult {
  scenario: ScenarioEvent & { severity: SeverityLevel };
  assumptions: ScenarioAssumptions;
  holdings: HoldingStressResult[];
  portfolio: PortfolioStressSummary;
  diagnostics: StressDiagnostics;
  mapContext: StressMapContext;
}
