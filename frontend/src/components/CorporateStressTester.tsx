import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, TileLayer } from "react-leaflet";
import { INITIAL_ZOOM, MAP_CENTER, MARKER_PIXELS, SCENARIO_EVENTS, SEVERITY_LABELS } from "@/stressTester/mockData";
import { useStressTester } from "@/stressTester/useStressTester";
import type { MarkerSize, PositionType, ScenarioType, SeverityLevel } from "@/stressTester/types";

interface CorporateStressTesterProps {
  initialTicker?: string | null;
}

function FadePanel({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timeout);
  }, [delay]);

  return (
    <div className={`transition-all duration-500 ${visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"} ${className}`}>
      {children}
    </div>
  );
}

function sectionTitle(title: string) {
  return <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/35">{title}</h3>;
}

function formatMoney(value: number) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(1)}M`;
}

function getUiCreditLabel(label: string) {
  if (label === "Elevated" || label === "Severe") return "High";
  return label;
}

function buildMarkerIcon({
  markerSize,
  ticker,
  positionType,
  impacted,
  scenarioType,
  focused,
}: {
  markerSize: MarkerSize;
  ticker: string;
  positionType: PositionType;
  impacted: boolean;
  scenarioType: ScenarioType;
  focused: boolean;
}) {
  const size = MARKER_PIXELS[markerSize];
  const isCarbon = scenarioType === "carbon";
  const fillColor = impacted ? (isCarbon ? "#f59e0b" : "#ef4444") : "#6b7280";
  const borderColor = positionType === "SHORT" ? "#60a5fa" : "#f8fafc";
  const pulseClass = impacted ? (isCarbon ? "risk-marker--pulse-amber" : "risk-marker--pulse-red") : "";
  const opacity = impacted ? 1 : 0.34;
  const ring = focused ? "0 0 0 2px rgba(245,158,11,0.35), " : "";

  return L.divIcon({
    className: "risk-marker-icon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `
      <div
        class="risk-marker ${pulseClass}"
        style="
          width:${size}px;
          height:${size}px;
          opacity:${opacity};
          border-color:${borderColor};
          background:radial-gradient(circle at 30% 25%, rgba(255,255,255,0.18), ${fillColor});
          box-shadow:${ring}0 0 0 1px rgba(255,255,255,0.08), 0 0 24px rgba(255,255,255,0.10);
          color:#ffffff;
        "
      >
        <span class="risk-marker__ticker">${ticker}</span>
      </div>
    `,
  });
}

function CorporateStressTester({ initialTicker = null }: CorporateStressTesterProps) {
  const [focusedTicker, setFocusedTicker] = useState<string | null>(initialTicker);
  const [showCustomAssumptions, setShowCustomAssumptions] = useState(false);
  const {
    scenarioType,
    severity,
    effectiveAssumptions,
    result,
    summaryMetrics,
    runStressTest,
    resetAssumptions,
    setScenarioType,
    setSeverity,
    setOverride,
  } = useStressTester();

  useEffect(() => {
    if (initialTicker) {
      setFocusedTicker(initialTicker);
    }
  }, [initialTicker]);

  const selectedTicker = focusedTicker ?? initialTicker;
  const focusedResult = selectedTicker ? result.holdings.find((holding) => holding.ticker === selectedTicker) : null;
  const highCreditCount = result.holdings.filter((holding) => getUiCreditLabel(holding.creditPressure) === "High").length;
  const resilienceSummary =
    result.diagnostics.resilienceDistribution.facesDistress > 0
      ? `${result.diagnostics.resilienceDistribution.facesDistress} holdings face distress under this path.`
      : result.diagnostics.resilienceDistribution.strugglesToRecover > 0
        ? `${result.diagnostics.resilienceDistribution.strugglesToRecover} holdings struggle to recover.`
        : "Most holdings absorb the modeled shock.";

  const riskFlags = [
    {
      title: "Underhedged Exposure Warning",
      body:
        result.diagnostics.underhedgedWarning ??
        `Short book currently offsets ${result.portfolio.hedgeEfficiencyPct.toFixed(0)}% of gross long stress losses.`,
    },
    {
      title: "Concentration Alert",
      body:
        result.diagnostics.hiddenConcentrationAlerts[0] ??
        "Stress propagation remains diversified across the current book under this scenario path.",
    },
    {
      title: "Resilience Summary",
      body:
        highCreditCount > 0
          ? `${resilienceSummary} ${highCreditCount} holdings show High credit pressure.`
          : resilienceSummary,
    },
  ];

  const causalSteps = [
    {
      label: "Damage",
      metric: formatMoney(summaryMetrics.avgPhysicalDamage),
      detail: "Physical damage concentrated in exposed assets",
    },
    {
      label: "Revenue",
      metric: formatMoney(summaryMetrics.avgRevenueLoss),
      detail: `${result.assumptions.downtimeDays} day disruption assumption`,
    },
    {
      label: "EBITDA",
      metric: `${summaryMetrics.avgEbitdaDeltaPct.toFixed(1)}%`,
      detail: "Operating earnings compression after costs and downtime",
    },
    {
      label: "Equity",
      metric: formatMoney(result.portfolio.totalPortfolioPnL),
      detail: "Net equity impact after long and short translation",
    },
  ];

  return (
    <div className="h-full min-h-0 p-4 sm:p-6">
      <div className="grid h-full min-h-[calc(100vh-6rem)] grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,30%)_minmax(0,70%)]">
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1 no-scrollbar">
          <FadePanel delay={0} className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            {sectionTitle("Scenario Setup")}
            <div className="space-y-4">
              <select
                value={scenarioType}
                onChange={(event) => setScenarioType(event.target.value as ScenarioType)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none"
              >
                {SCENARIO_EVENTS.map((eventOption) => (
                  <option key={eventOption.id} value={eventOption.id} className="bg-slate-900 text-white">
                    {eventOption.icon} {eventOption.label}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-5 gap-2">
                {([1, 2, 3, 4, 5] as SeverityLevel[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setSeverity(level)}
                    className={`rounded-full border px-2 py-2 text-[11px] font-medium transition ${
                      severity === level
                        ? "border-amber-300/50 bg-amber-400/20 text-amber-200"
                        : "border-white/10 bg-white/5 text-white/55 hover:text-white/80"
                    }`}
                  >
                    {SEVERITY_LABELS[level]}
                  </button>
                ))}
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/80">
                <span>Customize Assumptions</span>
                <input
                  type="checkbox"
                  checked={showCustomAssumptions}
                  onChange={(event) => setShowCustomAssumptions(event.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-transparent accent-amber-400"
                />
              </label>

              {showCustomAssumptions && (
                <div className="space-y-4">
                  {[
                    {
                      label: "Asset Damage %",
                      value: Number((effectiveAssumptions.damageRate * 100).toFixed(1)),
                      min: 0,
                      max: 65,
                      step: 1,
                      onChange: (value: number) => setOverride("damageRate", value / 100),
                      suffix: "%",
                    },
                    {
                      label: "Revenue Downtime",
                      value: effectiveAssumptions.downtimeDays,
                      min: 0,
                      max: 120,
                      step: 1,
                      onChange: (value: number) => setOverride("downtimeDays", value),
                      suffix: " days",
                    },
                    {
                      label: "Cost Multiplier",
                      value: effectiveAssumptions.costMultiplier,
                      min: 1,
                      max: 3,
                      step: 0.05,
                      onChange: (value: number) => setOverride("costMultiplier", value),
                      suffix: "x",
                    },
                    {
                      label: "Credit Spread Expansion",
                      value: effectiveAssumptions.spreadExpansionBps,
                      min: 0,
                      max: 300,
                      step: 5,
                      onChange: (value: number) => setOverride("spreadExpansionBps", value),
                      suffix: " bps",
                    },
                    {
                      label: "Valuation Compression",
                      value: effectiveAssumptions.valuationCompressionPct,
                      min: 0,
                      max: 45,
                      step: 1,
                      onChange: (value: number) => setOverride("valuationCompressionPct", value),
                      suffix: "%",
                    },
                  ].map((slider) => (
                    <div key={slider.label}>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-white/65">{slider.label}</span>
                        <span className="font-medium text-amber-300">{slider.value}{slider.suffix}</span>
                      </div>
                      <input
                        type="range"
                        min={slider.min}
                        max={slider.max}
                        step={slider.step}
                        value={slider.value}
                        onChange={(event) => slider.onChange(Number(event.target.value))}
                        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-amber-400"
                      />
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => runStressTest()}
                className="w-full rounded-xl border border-amber-300/40 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-200 transition hover:bg-amber-400/15"
              >
                Run Portfolio Stress Test
              </button>

              <button
                type="button"
                onClick={() => resetAssumptions()}
                className="text-sm text-white/45 transition hover:text-white/80"
              >
                Reset Assumptions
              </button>
            </div>
          </FadePanel>
        </div>

        <div className="min-h-0 space-y-4 overflow-y-auto pr-1 no-scrollbar">
          <FadePanel delay={100} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Total Portfolio P&L", value: formatMoney(result.portfolio.totalPortfolioPnL), tone: result.portfolio.totalPortfolioPnL <= 0 ? "text-white" : "text-blue-300" },
              { label: "Long Book Impact", value: formatMoney(result.portfolio.longBookImpact), tone: "text-white" },
              { label: "Short Book Offset", value: formatMoney(result.portfolio.shortBookImpact), tone: "text-amber-300" },
              { label: "Hedge Efficiency", value: `${result.portfolio.hedgeEfficiencyPct.toFixed(0)}%`, tone: "text-amber-300" },
            ].map((metric) => (
              <div key={metric.label} className="rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md">
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/35">{metric.label}</p>
                <p className={`mt-2 text-2xl font-semibold ${metric.tone}`}>{metric.value}</p>
              </div>
            ))}
          </FadePanel>

          <FadePanel delay={200} className="rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/35">Scenario Footprint</p>
                <p className="mt-1 text-sm text-white/80">Scenario Impact Zone — {result.mapContext.footprintLabel}</p>
              </div>
              {focusedResult && (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-amber-300">
                  Focus: {focusedResult.ticker}
                </div>
              )}
            </div>
            <div className="relative h-[340px] overflow-hidden rounded-xl border border-white/10 bg-white/5">
              <MapContainer center={MAP_CENTER} zoom={INITIAL_ZOOM} scrollWheelZoom className="h-full w-full" zoomControl={false}>
                <TileLayer
                  attribution="&copy; OpenStreetMap contributors &copy; CARTO"
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />
                {result.mapContext.impactZoneCenter && result.mapContext.impactZoneRadiusMeters && (
                  <Circle
                    center={result.mapContext.impactZoneCenter}
                    radius={result.mapContext.impactZoneRadiusMeters}
                    pathOptions={{ color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.08, weight: 2, dashArray: "10 10" }}
                  />
                )}
                {result.holdings.map((holding) => (
                  <Marker
                    key={holding.ticker}
                    position={holding.coordinates}
                    icon={buildMarkerIcon({
                      markerSize: holding.markerSize,
                      ticker: holding.ticker,
                      positionType: holding.positionType,
                      impacted: result.mapContext.impactedTickers.includes(holding.ticker),
                      scenarioType: result.scenario.id,
                      focused: selectedTicker === holding.ticker,
                    })}
                    eventHandlers={{ click: () => setFocusedTicker(holding.ticker) }}
                  />
                ))}
              </MapContainer>
              <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/80 backdrop-blur-md">
                Scenario Impact Zone — {result.mapContext.footprintLabel}
              </div>
            </div>
          </FadePanel>

          <FadePanel delay={300} className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            {sectionTitle("Deterministic Impact Chain")}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {causalSteps.map((step) => (
                <div key={step.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">{step.label}</p>
                  <p className="mt-2 text-lg font-semibold text-white">{step.metric}</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/45">{step.detail}</p>
                </div>
              ))}
            </div>
          </FadePanel>

          <FadePanel delay={400} className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            {sectionTitle("Company Stress Output")}
            <div className="overflow-x-auto no-scrollbar">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[90px_100px_110px_120px_180px] gap-3 px-2 pb-2 text-[10px] uppercase tracking-[0.2em] text-white/30">
                  <span>Ticker</span>
                  <span>Position</span>
                  <span>Exposure</span>
                  <span>P&amp;L</span>
                  <span>Resilience Verdict</span>
                </div>
                <div className="space-y-2">
                  {result.holdings.map((holding) => (
                    <button
                      key={holding.ticker}
                      type="button"
                      onClick={() => setFocusedTicker(holding.ticker)}
                      className={`grid w-full grid-cols-[90px_100px_110px_120px_180px] gap-3 rounded-xl border px-2 py-3 text-left text-sm ${selectedTicker === holding.ticker ? "border-amber-300/30" : "border-white/10"} bg-white/5`}
                    >
                      <span className="font-semibold text-white">{holding.ticker}</span>
                      <span className={`rounded-full border px-2 py-1 text-center text-[10px] font-semibold tracking-[0.15em] ${holding.positionType === "SHORT" ? "border-blue-400/30 bg-blue-500/15 text-blue-300" : "border-white/10 bg-white/10 text-white/75"}`}>{holding.positionType}</span>
                      <span className="text-white/65">{holding.exposurePct.toFixed(1)}%</span>
                      <span className={holding.positionPnL >= 0 ? "text-blue-300" : "text-red-300"}>{formatMoney(holding.positionPnL)}</span>
                      <div className="flex items-center justify-between gap-3">
                        <span className={`${holding.resilienceVerdict === "Absorbs Shock" ? "text-emerald-300" : holding.resilienceVerdict === "Struggles to Recover" ? "text-amber-300" : "text-red-300"}`}>{holding.resilienceVerdict}</span>
                        <span className="text-[11px] text-white/40">{getUiCreditLabel(holding.creditPressure)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </FadePanel>

          <FadePanel delay={500} className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            {sectionTitle("Risk Flags")}
            <div className="grid gap-3 md:grid-cols-3">
              {riskFlags.map((flag) => (
                <div key={flag.title} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-sm font-medium text-white">{flag.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-white/50">{flag.body}</p>
                </div>
              ))}
            </div>
          </FadePanel>
        </div>
      </div>
    </div>
  );
}

export default CorporateStressTester;
