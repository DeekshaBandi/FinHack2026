import L from "leaflet";
import { MOCK_PORTFOLIO, SCENARIO_EVENTS, SEVERITY_LABELS, SEVERITY_RADII, TIME_HORIZON_LABELS, TOTAL_PORTFOLIO_MARKET_VALUE } from "./mockData";
import { getScenarioDefaults } from "./scenarioDefaults";
import type {
  CreditPressure,
  HoldingStressResult,
  PortfolioHolding,
  ResilienceVerdict,
  ScenarioAssumptionOverride,
  ScenarioInputs,
  ScenarioType,
  StressDiagnostics,
  StressMapContext,
  StressTestResult,
} from "./types";

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function safeDivide(numerator: number, denominator: number, fallback = 0) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return fallback;
  return numerator / denominator;
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

function distanceInMeters(a: [number, number], b: [number, number]) {
  return L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]));
}

function getScenarioEvent(scenarioType: ScenarioType) {
  return SCENARIO_EVENTS.find((event) => event.id === scenarioType) ?? SCENARIO_EVENTS[0];
}

function getImpactGate(holding: PortfolioHolding, inputs: ScenarioInputs) {
  const event = getScenarioEvent(inputs.scenarioType);
  if (inputs.scenarioType === "carbon") return 1;
  if (!event.epicenter) return 0;
  const radius = SEVERITY_RADII[inputs.severity];
  return distanceInMeters(holding.coordinates, event.epicenter) <= radius ? 1 : 0;
}

function getSectorSensitivityMultiplier(holding: PortfolioHolding, scenarioType: ScenarioType) {
  const sectorBase: Record<string, Record<ScenarioType, number>> = {
    "Integrated Energy": { hurricane: 1.3, wildfire: 0.85, flood: 1.15, drought: 1.05, carbon: 1.25 },
    "Oil & Gas Refining": { hurricane: 1.38, wildfire: 0.78, flood: 1.20, drought: 1.08, carbon: 1.32 },
    "Independent Power": { hurricane: 1.22, wildfire: 0.88, flood: 1.12, drought: 1.18, carbon: 1.05 },
    "Industrial REIT": { hurricane: 1.10, wildfire: 0.95, flood: 1.25, drought: 0.72, carbon: 0.82 },
    "P&C Insurance": { hurricane: 1.35, wildfire: 1.30, flood: 1.28, drought: 0.82, carbon: 0.92 },
    "Oilfield Services": { hurricane: 1.28, wildfire: 0.8, flood: 1.05, drought: 0.98, carbon: 1.1 },
    "Retail REIT": { hurricane: 1.08, wildfire: 0.96, flood: 1.22, drought: 0.74, carbon: 0.85 },
    Utility: { hurricane: 1.15, wildfire: 0.9, flood: 1.18, drought: 1.1, carbon: 0.94 },
    "Communications Infrastructure": { hurricane: 0.82, wildfire: 1.2, flood: 0.76, drought: 0.9, carbon: 0.96 },
    Chemicals: { hurricane: 1.22, wildfire: 0.82, flood: 1.08, drought: 1.16, carbon: 1.18 },
    Packaging: { hurricane: 0.72, wildfire: 0.76, flood: 0.74, drought: 0.82, carbon: 0.88 },
  };

  return sectorBase[holding.sector]?.[scenarioType] ?? 1;
}

export function getExposureScore(holding: PortfolioHolding, scenarioType: ScenarioType, severity: ScenarioInputs["severity"]) {
  const geographic = holding.geographicExposure[scenarioType];
  const facility = holding.facilitiesInImpactZonePct[scenarioType];
  const sector = getSectorSensitivityMultiplier(holding, scenarioType);
  const severityBonus = 0.82 + severity * 0.06;
  const score = clamp((geographic * 0.4 + facility * 0.4 + (sector - 0.7) * 0.2) * severityBonus, 0, 1);
  return { score, displayPct: round2(score * 100) };
}

function getCreditPressureCategory(score: number): CreditPressure {
  if (score >= 0.8) return "Severe";
  if (score >= 0.55) return "Elevated";
  if (score >= 0.3) return "Moderate";
  return "Low";
}

function getResilienceVerdict(
  ebitdaDeltaPct: number,
  baselineCoverage: number,
  stressedCoverage: number,
  creditPressure: CreditPressure,
  recoverySpeed: number,
  downtimeDays: number,
): ResilienceVerdict {
  if (ebitdaDeltaPct <= -32 || stressedCoverage < 1.5 || creditPressure === "Severe" || (recoverySpeed < 0.55 && downtimeDays > 35)) {
    return "Faces Distress";
  }
  if (ebitdaDeltaPct <= -16 || stressedCoverage < baselineCoverage * 0.55 || creditPressure === "Elevated" || downtimeDays > 20) {
    return "Struggles to Recover";
  }
  return "Absorbs Shock";
}

function getCreditPenaltyPct(creditPressure: CreditPressure) {
  return { Low: 1, Moderate: 3, Elevated: 6, Severe: 10 }[creditPressure];
}

function buildHoldingResult(holding: PortfolioHolding, inputs: ScenarioInputs): HoldingStressResult {
  const assumptions = {
    ...getScenarioDefaults(inputs.scenarioType, inputs.severity, inputs.timeHorizon),
    ...inputs.overrides,
    timeHorizon: inputs.timeHorizon,
  };
  const impactGate = getImpactGate(holding, inputs);
  const { score: exposureScore, displayPct } = getExposureScore(holding, inputs.scenarioType, inputs.severity);
  const impacted = inputs.scenarioType === "carbon" ? exposureScore > 0.08 : impactGate === 1 && exposureScore > 0.08;

  const assetBase = holding.annualRevenue * (0.22 + holding.ebitdaMargin * 0.45);
  const physicalDamage = impacted
    ? assetBase * holding.facilitiesInImpactZonePct[inputs.scenarioType] * assumptions.damageRate * holding.climateSensitivity.physicalDamage * Math.max(exposureScore, 0.18)
    : 0;

  const revenueLoss = impacted
    ? holding.dailyRevenue * assumptions.downtimeDays * exposureScore * holding.climateSensitivity.revenue * (0.7 + holding.facilitiesInImpactZonePct[inputs.scenarioType] * 0.6)
    : 0;

  const reroutingPenalty = impacted ? holding.dailyRevenue * 0.8 * (assumptions.costMultiplier - 1) * exposureScore : 0;
  const repairCostBase = holding.annualRevenue * 0.035 * holding.repairCostSensitivity;
  const costSpike = impacted
    ? repairCostBase * assumptions.damageRate * holding.climateSensitivity.cost * Math.max(1, assumptions.costMultiplier) + reroutingPenalty
    : 0;

  const baselineEbitda = holding.annualRevenue * holding.ebitdaMargin;
  const revenueMarginLoss = revenueLoss * clamp(holding.ebitdaMargin + 0.22, 0.25, 0.7);
  const totalEbitdaDrag = revenueMarginLoss + costSpike;
  const stressedEbitda = baselineEbitda - totalEbitdaDrag;
  const ebitdaDeltaPct = baselineEbitda > 0 ? clamp((stressedEbitda - baselineEbitda) / baselineEbitda * 100, -100, 15) : 0;

  const baselineInterestCoverage = safeDivide(baselineEbitda, holding.interestExpense, holding.interestExpense === 0 ? 99 : 0);
  const stressedInterestCoverage = safeDivide(stressedEbitda, holding.interestExpense, holding.interestExpense === 0 ? 99 : 0);
  const leverageBase = safeDivide(holding.debt, baselineEbitda, 20);
  const leverageStressed = safeDivide(holding.debt, Math.max(stressedEbitda, 1), 30);
  const coverageDeterioration = baselineInterestCoverage > 0 ? clamp((baselineInterestCoverage - stressedInterestCoverage) / baselineInterestCoverage, 0, 1.5) : 0;

  // Credit pressure is driven by weaker debt service, higher leverage and slower recovery.
  const creditScore =
    coverageDeterioration * 0.42 +
    clamp((leverageStressed - leverageBase) / 4, 0, 1) * 0.24 +
    clamp(assumptions.spreadExpansionBps / 220, 0, 1) * 0.18 +
    clamp((1 - holding.recoverySpeed) * 1.1, 0, 1) * 0.1 +
    clamp((inputs.severity - 1) / 4, 0, 1) * 0.06;

  const creditPressure = getCreditPressureCategory(creditScore);
  const scenarioPenaltyPct = inputs.scenarioType === "carbon" ? 4.5 : inputs.scenarioType === "drought" ? 2.5 : 1.8;
  const equityMovePctRaw =
    ebitdaDeltaPct * 0.72 -
    assumptions.valuationCompressionPct * holding.climateSensitivity.valuation -
    getCreditPenaltyPct(creditPressure) -
    scenarioPenaltyPct;
  const equityMovePct = round2(clamp(equityMovePctRaw, -85, 10));
  const positionPnL =
    holding.positionType === "LONG"
      ? round2(holding.positionMarketValue * (equityMovePct / 100))
      : round2(-1 * holding.positionMarketValue * (equityMovePct / 100));

  const resilienceVerdict = impacted
    ? getResilienceVerdict(ebitdaDeltaPct, baselineInterestCoverage, stressedInterestCoverage, creditPressure, holding.recoverySpeed, assumptions.downtimeDays)
    : "Absorbs Shock";

  const diagnosticDrivers = Array.from(
    new Set([
      ...getScenarioEvent(inputs.scenarioType).primaryDrivers,
      ...holding.thematicDrivers.slice(0, 2),
      creditPressure === "Severe" ? "Debt coverage deterioration" : creditPressure === "Elevated" ? "Refinancing sensitivity" : "",
    ].filter(Boolean)),
  );

  return {
    ticker: holding.ticker,
    companyName: holding.companyName,
    positionType: holding.positionType,
    sector: holding.sector,
    markerSize: holding.markerSize,
    coordinates: holding.coordinates,
    exposureScore: round2(exposureScore),
    exposurePct: displayPct,
    physicalDamage: round2(physicalDamage),
    revenueLoss: round2(revenueLoss),
    costSpike: round2(costSpike),
    baselineEbitda: round2(baselineEbitda),
    stressedEbitda: round2(stressedEbitda),
    ebitdaDeltaPct: round2(ebitdaDeltaPct),
    baselineInterestCoverage: round2(baselineInterestCoverage),
    stressedInterestCoverage: round2(stressedInterestCoverage),
    creditPressure,
    equityMovePct,
    positionPnL,
    resilienceVerdict,
    impacted,
    diagnosticDrivers,
  };
}

function buildDiagnostics(holdings: HoldingStressResult[], portfolio: StressTestResult["portfolio"], scenarioType: ScenarioType): StressDiagnostics {
  const impacted = holdings.filter((holding) => holding.impacted);
  const resilienceDistribution = {
    absorbsShock: holdings.filter((holding) => holding.resilienceVerdict === "Absorbs Shock").length,
    strugglesToRecover: holdings.filter((holding) => holding.resilienceVerdict === "Struggles to Recover").length,
    facesDistress: holdings.filter((holding) => holding.resilienceVerdict === "Faces Distress").length,
  };

  const driverCounts = new Map<string, number>();
  impacted.forEach((holding) => {
    holding.diagnosticDrivers.forEach((driver) => driverCounts.set(driver, (driverCounts.get(driver) ?? 0) + 1));
  });

  const sharedDrivers = Array.from(driverCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1]);

  const concentrationAlerts = sharedDrivers.slice(0, 3).map(
    ([driver, count]) => `${count} holdings share ${driver.toLowerCase()} under the active ${scenarioType} scenario.`,
  );

  const underhedgedWarning =
    portfolio.residualUnhedgedRisk > 6
      ? `Residual unhedged climate loss remains ${portfolio.residualUnhedgedRisk.toFixed(1)}M after short-book offsets.`
      : null;

  return {
    concentrationAlerts,
    hiddenConcentrationAlerts: concentrationAlerts,
    underhedgedWarning,
    resilienceDistribution,
  };
}

function buildMapContext(holdings: HoldingStressResult[], inputs: ScenarioInputs): StressMapContext {
  const event = getScenarioEvent(inputs.scenarioType);
  const impactedTickers = holdings.filter((holding) => holding.impacted).map((holding) => holding.ticker);
  const unaffectedTickers = holdings.filter((holding) => !holding.impacted).map((holding) => holding.ticker);

  return {
    impactedTickers,
    unaffectedTickers,
    footprintLabel:
      inputs.scenarioType === "carbon"
        ? `${event.summaryLabel} — ${TIME_HORIZON_LABELS[inputs.timeHorizon]}`
        : `${event.summaryLabel} (${SEVERITY_LABELS[inputs.severity]})`,
    affectsAllHoldings: inputs.scenarioType === "carbon",
    impactZoneRadiusMeters: inputs.scenarioType === "carbon" ? null : SEVERITY_RADII[inputs.severity],
    impactZoneCenter: event.epicenter,
  };
}

export function buildStressTestResult(inputs: ScenarioInputs): StressTestResult {
  const event = getScenarioEvent(inputs.scenarioType);
  const assumptions = {
    ...getScenarioDefaults(inputs.scenarioType, inputs.severity, inputs.timeHorizon),
    ...inputs.overrides,
    timeHorizon: inputs.timeHorizon,
  };

  const holdings = MOCK_PORTFOLIO.map((holding) => buildHoldingResult(holding, { ...inputs, overrides: assumptions }));
  const impacted = holdings.filter((holding) => holding.impacted);

  const totalPortfolioPnL = round2(holdings.reduce((sum, holding) => sum + holding.positionPnL, 0));
  const longBookImpact = round2(
    holdings
      .filter((holding) => holding.positionType === "LONG")
      .reduce((sum, holding) => sum + Math.min(holding.positionPnL, 0), 0),
  );
  const shortBookImpact = round2(
    holdings
      .filter((holding) => holding.positionType === "SHORT")
      .reduce((sum, holding) => sum + Math.max(holding.positionPnL, 0), 0),
  );
  const netExposureAtRisk = round2(
    impacted.reduce((sum, holding) => {
      const portfolioHolding = MOCK_PORTFOLIO.find((item) => item.ticker === holding.ticker)!;
      return sum + portfolioHolding.positionMarketValue * holding.exposureScore;
    }, 0),
  );
  const capitalAffected = round2(
    impacted.reduce((sum, holding) => {
      const portfolioHolding = MOCK_PORTFOLIO.find((item) => item.ticker === holding.ticker)!;
      return sum + portfolioHolding.positionMarketValue;
    }, 0),
  );
  const grossLongLosses = Math.abs(longBookImpact);
  const hedgeEfficiencyPct = round2(clamp(safeDivide(shortBookImpact, grossLongLosses, 0) * 100, 0, 200));
  const residualUnhedgedRisk = round2(Math.max(0, grossLongLosses - shortBookImpact));
  const stressCoverageRatio = round2(clamp(safeDivide(shortBookImpact, Math.max(Math.abs(totalPortfolioPnL), 0.01), 0) * 100, 0, 300));

  const portfolio = {
    totalPortfolioPnL,
    longBookImpact,
    shortBookImpact,
    netExposureAtRisk,
    holdingsImpactedCount: impacted.length,
    capitalAffected,
    hedgeEfficiencyPct,
    stressCoverageRatio,
    residualUnhedgedRisk,
  };

  return {
    scenario: { ...event, severity: inputs.severity },
    assumptions,
    holdings,
    portfolio,
    diagnostics: buildDiagnostics(holdings, portfolio, inputs.scenarioType),
    mapContext: buildMapContext(holdings, inputs),
  };
}

export function getStressSummaryMetrics(result: StressTestResult) {
  const impacted = result.holdings.filter((holding) => holding.impacted);

  return {
    avgPhysicalDamage: round2(safeDivide(impacted.reduce((sum, holding) => sum + holding.physicalDamage, 0), impacted.length, 0)),
    avgRevenueLoss: round2(safeDivide(impacted.reduce((sum, holding) => sum + holding.revenueLoss, 0), impacted.length, 0)),
    avgCostSpike: round2(safeDivide(impacted.reduce((sum, holding) => sum + holding.costSpike, 0), impacted.length, 0)),
    avgEbitdaDeltaPct: round2(safeDivide(impacted.reduce((sum, holding) => sum + holding.ebitdaDeltaPct, 0), impacted.length, 0)),
    avgBaselineCoverage: round2(safeDivide(impacted.reduce((sum, holding) => sum + holding.baselineInterestCoverage, 0), impacted.length, 0)),
    avgStressedCoverage: round2(safeDivide(impacted.reduce((sum, holding) => sum + holding.stressedInterestCoverage, 0), impacted.length, 0)),
    avgEquityMovePct: round2(safeDivide(impacted.reduce((sum, holding) => sum + holding.equityMovePct, 0), impacted.length, 0)),
    capitalAffectedPct: round2(safeDivide(result.portfolio.capitalAffected, TOTAL_PORTFOLIO_MARKET_VALUE, 0) * 100),
  };
}

export function mergeScenarioInputs(
  scenarioType: ScenarioType,
  severity: ScenarioInputs["severity"],
  timeHorizon: ScenarioInputs["timeHorizon"],
  overrides?: ScenarioAssumptionOverride,
): ScenarioInputs {
  return { scenarioType, severity, timeHorizon, overrides };
}
