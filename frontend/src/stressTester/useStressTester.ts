import { useEffect, useMemo, useState } from "react";
import { getDefaultTimeHorizon, getScenarioDefaults } from "./scenarioDefaults";
import { buildStressTestResult, getStressSummaryMetrics, mergeScenarioInputs } from "./calculations";
import type { ScenarioAssumptionOverride, ScenarioInputs, ScenarioType, SeverityLevel, StressTestResult, TimeHorizon } from "./types";

export function useStressTester() {
  const [scenarioType, setScenarioTypeState] = useState<ScenarioType>("hurricane");
  const [severity, setSeverityState] = useState<SeverityLevel>(4);
  const [timeHorizon, setTimeHorizonState] = useState<TimeHorizon>(getDefaultTimeHorizon("hurricane"));
  const [overrides, setOverrides] = useState<ScenarioAssumptionOverride>({});
  const [result, setResult] = useState<StressTestResult>(() =>
    buildStressTestResult(mergeScenarioInputs("hurricane", 4, getDefaultTimeHorizon("hurricane"))),
  );

  const effectiveAssumptions = useMemo(
    () => ({
      ...getScenarioDefaults(scenarioType, severity, timeHorizon),
      ...overrides,
      timeHorizon,
    }),
    [overrides, scenarioType, severity, timeHorizon],
  );

  const summaryMetrics = useMemo(() => getStressSummaryMetrics(result), [result]);

  useEffect(() => {
    setResult(buildStressTestResult(mergeScenarioInputs(scenarioType, severity, timeHorizon, overrides)));
  }, [overrides, scenarioType, severity, timeHorizon]);

  const runStressTest = (inputOverrides?: Partial<ScenarioInputs>) => {
    const inputs = mergeScenarioInputs(
      inputOverrides?.scenarioType ?? scenarioType,
      inputOverrides?.severity ?? severity,
      inputOverrides?.timeHorizon ?? timeHorizon,
      inputOverrides?.overrides ?? overrides,
    );
    const nextResult = buildStressTestResult(inputs);
    setResult(nextResult);
    return nextResult;
  };

  const resetAssumptions = () => {
    const defaultsHorizon = getDefaultTimeHorizon(scenarioType);
    setTimeHorizonState(defaultsHorizon);
    setOverrides({});
    const nextResult = buildStressTestResult(mergeScenarioInputs(scenarioType, severity, defaultsHorizon));
    setResult(nextResult);
    return nextResult;
  };

  const setScenarioType = (nextScenarioType: ScenarioType) => {
    const nextHorizon = getDefaultTimeHorizon(nextScenarioType);
    setScenarioTypeState(nextScenarioType);
    setTimeHorizonState(nextHorizon);
    setOverrides({});
  };

  const setSeverity = (nextSeverity: SeverityLevel) => {
    setSeverityState(nextSeverity);
  };

  const setTimeHorizon = (nextTimeHorizon: TimeHorizon) => {
    setTimeHorizonState(nextTimeHorizon);
  };

  const setOverride = <K extends keyof typeof effectiveAssumptions>(key: K, value: (typeof effectiveAssumptions)[K]) => {
    setOverrides((prev) => ({ ...prev, [key]: value }));
  };

  return {
    scenarioType,
    severity,
    timeHorizon,
    overrides,
    effectiveAssumptions,
    result,
    summaryMetrics,
    runStressTest,
    resetAssumptions,
    setScenarioType,
    setSeverity,
    setTimeHorizon,
    setOverride,
  };
}
