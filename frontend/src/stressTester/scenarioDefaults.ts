import type { ScenarioAssumptions, ScenarioType, SeverityLevel, TimeHorizon } from "./types";

const BASE_DEFAULTS: Record<ScenarioType, Omit<ScenarioAssumptions, "timeHorizon"> & { defaultHorizon: TimeHorizon }> = {
  hurricane: {
    damageRate: 0.18,
    downtimeDays: 14,
    costMultiplier: 1.18,
    spreadExpansionBps: 55,
    valuationCompressionPct: 8,
    defaultHorizon: "1m",
  },
  wildfire: {
    damageRate: 0.2,
    downtimeDays: 12,
    costMultiplier: 1.15,
    spreadExpansionBps: 50,
    valuationCompressionPct: 7,
    defaultHorizon: "1m",
  },
  flood: {
    damageRate: 0.16,
    downtimeDays: 11,
    costMultiplier: 1.12,
    spreadExpansionBps: 42,
    valuationCompressionPct: 6,
    defaultHorizon: "1m",
  },
  drought: {
    damageRate: 0.06,
    downtimeDays: 20,
    costMultiplier: 1.1,
    spreadExpansionBps: 35,
    valuationCompressionPct: 5,
    defaultHorizon: "1q",
  },
  carbon: {
    damageRate: 0,
    downtimeDays: 0,
    costMultiplier: 1.12,
    spreadExpansionBps: 70,
    valuationCompressionPct: 9,
    defaultHorizon: "1y",
  },
};

const SEVERITY_MULTIPLIER: Record<SeverityLevel, number> = {
  1: 0.7,
  2: 0.9,
  3: 1.1,
  4: 1.35,
  5: 1.7,
};

const HORIZON_MULTIPLIER: Record<TimeHorizon, number> = {
  "1w": 0.45,
  "1m": 1,
  "1q": 1.35,
  "1y": 1.8,
};

const COST_HORIZON_MULTIPLIER: Record<TimeHorizon, number> = {
  "1w": 0.55,
  "1m": 1,
  "1q": 1.2,
  "1y": 1.35,
};

export function getDefaultTimeHorizon(scenarioType: ScenarioType): TimeHorizon {
  return BASE_DEFAULTS[scenarioType].defaultHorizon;
}

export function getScenarioDefaults(
  scenarioType: ScenarioType,
  severity: SeverityLevel,
  timeHorizon?: TimeHorizon,
): ScenarioAssumptions {
  const base = BASE_DEFAULTS[scenarioType];
  const horizon = timeHorizon ?? base.defaultHorizon;
  const severityScale = SEVERITY_MULTIPLIER[severity];
  const horizonScale = HORIZON_MULTIPLIER[horizon];
  const costHorizonScale = COST_HORIZON_MULTIPLIER[horizon];

  return {
    damageRate: Number(Math.min(0.65, base.damageRate * severityScale * Math.min(horizonScale, 1.2)).toFixed(3)),
    downtimeDays: Math.max(0, Math.round(base.downtimeDays * severityScale * horizonScale)),
    costMultiplier: Number((1 + (base.costMultiplier - 1) * severityScale * costHorizonScale).toFixed(2)),
    spreadExpansionBps: Math.max(0, Math.round(base.spreadExpansionBps * severityScale * Math.max(0.8, horizonScale))),
    valuationCompressionPct: Number(Math.min(45, base.valuationCompressionPct * severityScale * Math.max(0.9, horizonScale)).toFixed(1)),
    timeHorizon: horizon,
  };
}
