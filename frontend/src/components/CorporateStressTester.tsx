import "leaflet/dist/leaflet.css";
import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { Circle, MapContainer, Marker, TileLayer } from "react-leaflet";
import { INITIAL_ZOOM, MAP_CENTER, MARKER_PIXELS, SCENARIO_EVENTS, SEVERITY_LABELS, SEVERITY_RADII } from "@/stressTester/mockData";
import { useStressTester } from "@/stressTester/useStressTester";
import type { MarkerSize, PositionType, ScenarioType, SeverityLevel } from "@/stressTester/types";

/* ── Info Button (portal-based, renders above all cards) ──── */

interface InfoPopupProps {
  title: string;
  formula: string;
  explanation: string;
  variables?: Array<{ name: string; value: string }>;
}

function InfoButton({ title, formula, explanation, variables }: InfoPopupProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const pw = 320;
    const ph = 280;
    let left = r.left + r.width / 2 - pw / 2;
    let top = r.bottom + 8;
    if (left < 12) left = 12;
    if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
    if (top + ph > window.innerHeight - 12) top = r.top - ph - 8;
    setPos({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
    function onClickOutside(e: MouseEvent) {
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="w-4 h-4 rounded-full border border-white/15 bg-white/5 flex items-center justify-center
                   text-[9px] text-white/30 hover:text-white/60 hover:border-white/30 hover:bg-white/10
                   transition-all cursor-pointer ml-1.5 shrink-0"
        title="How is this calculated?"
      >
        i
      </button>
      {open && createPortal(
        <div
          ref={popupRef}
          className="fixed w-80 rounded-xl border border-white/10 bg-[#0a0a0a]/95 backdrop-blur-xl p-4
                     shadow-[0_12px_48px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.05)]"
          style={{ top: pos.top, left: pos.left, zIndex: 9999 }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-white uppercase tracking-wider">{title}</span>
            <button onClick={() => setOpen(false)}
              className="w-5 h-5 rounded-full bg-white/5 flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/10 text-xs cursor-pointer transition-all">
              x
            </button>
          </div>
          <div className="rounded-lg bg-amber-500/[0.06] border border-amber-500/20 px-3 py-2 mb-3">
            <code className="text-[11px] text-amber-400 font-mono leading-relaxed block">{formula}</code>
          </div>
          <p className="text-[11px] text-white/40 leading-relaxed mb-2">{explanation}</p>
          {variables && variables.length > 0 && (
            <div className="space-y-1.5 mt-2 pt-2 border-t border-white/5 max-h-40 overflow-y-auto">
              {variables.map((v) => (
                <div key={v.name} className="flex items-start justify-between gap-2">
                  <span className="text-[10px] text-white/30 font-mono shrink-0">{v.name}</span>
                  <span className="text-[10px] text-white/50 font-mono text-right">{v.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ── Helpers ───────────────────────────────────────────────── */

interface CorporateStressTesterProps {
  initialTicker?: string | null;
}

function FadePanel({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const [v, setV] = useState(false);
  useEffect(() => { const t = setTimeout(() => setV(true), delay); return () => clearTimeout(t); }, [delay]);
  return (
    <div className={`transition-all duration-500 ${v ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"} ${className}`}>
      {children}
    </div>
  );
}

function fmt(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}B`;
  if (abs >= 1) return `${sign}$${abs.toFixed(1)}M`;
  if (abs >= 0.01) return `${sign}$${(abs * 1000).toFixed(0)}K`;
  return "$0";
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function buildMarkerIcon({ markerSize, ticker, impacted, scenarioType, focused }: {
  markerSize: MarkerSize; ticker: string; positionType: PositionType;
  impacted: boolean; scenarioType: ScenarioType; focused: boolean;
}) {
  const size = MARKER_PIXELS[markerSize];
  const isCarbon = scenarioType === "carbon";
  const fillColor = impacted ? (isCarbon ? "#f59e0b" : "#ef4444") : "#6b7280";
  const borderColor = "#f8fafc";
  const pulseClass = impacted ? (isCarbon ? "risk-marker--pulse-amber" : "risk-marker--pulse-red") : "";
  const opacity = impacted ? 1 : 0.34;
  const ring = focused ? "0 0 0 2px rgba(245,158,11,0.35), " : "";

  return L.divIcon({
    className: "risk-marker-icon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="risk-marker ${pulseClass}" style="
      width:${size}px;height:${size}px;opacity:${opacity};border-color:${borderColor};
      background:radial-gradient(circle at 30% 25%, rgba(255,255,255,0.18), ${fillColor});
      box-shadow:${ring}0 0 0 1px rgba(255,255,255,0.08), 0 0 24px rgba(255,255,255,0.10);
      color:#ffffff;">
      <span class="risk-marker__ticker">${ticker}</span>
    </div>`,
  });
}

/* ── Heatmap circles for impact zone ──────────────────────── */

interface HeatmapRing {
  center: [number, number];
  radius: number;
  color: string;
  fillOpacity: number;
  weight: number;
}

function buildHeatmapRings(
  epicenter: [number, number] | undefined,
  baseRadius: number | null,
  impactedHoldings: Array<{ coordinates: [number, number]; exposureScore: number; ticker: string }>,
  scenarioType: ScenarioType,
): HeatmapRing[] {
  const rings: HeatmapRing[] = [];
  const isCarbon = scenarioType === "carbon";
  const baseColor = isCarbon ? "#f59e0b" : "#ef4444";

  if (epicenter && baseRadius) {
    rings.push(
      { center: epicenter, radius: baseRadius * 0.35, color: baseColor, fillOpacity: 0.18, weight: 0 },
      { center: epicenter, radius: baseRadius * 0.65, color: baseColor, fillOpacity: 0.10, weight: 0 },
      { center: epicenter, radius: baseRadius, color: baseColor, fillOpacity: 0.04, weight: 2 },
      { center: epicenter, radius: baseRadius * 1.15, color: baseColor, fillOpacity: 0.02, weight: 1 },
    );
  }

  for (const h of impactedHoldings) {
    const intensity = Math.min(h.exposureScore * 1.2, 1);
    const companyRadius = 60_000 + intensity * 80_000;
    rings.push(
      { center: h.coordinates, radius: companyRadius * 0.5, color: baseColor, fillOpacity: 0.22 * intensity, weight: 0 },
      { center: h.coordinates, radius: companyRadius, color: baseColor, fillOpacity: 0.08 * intensity, weight: 1.5 },
    );
  }

  return rings;
}

/* ── Main Component ───────────────────────────────────────── */

function CorporateStressTester({ initialTicker = null }: CorporateStressTesterProps) {
  const [focusedTicker, setFocusedTicker] = useState<string | null>(initialTicker);
  const [showCustom, setShowCustom] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const {
    scenarioType, severity, effectiveAssumptions, result, summaryMetrics,
    runStressTest, resetAssumptions, setScenarioType, setSeverity, setOverride,
  } = useStressTester();

  useEffect(() => { if (initialTicker) setFocusedTicker(initialTicker); }, [initialTicker]);

  const selectedTicker = focusedTicker ?? initialTicker;
  const focusedResult = selectedTicker ? result.holdings.find((h) => h.ticker === selectedTicker) : null;
  const impactedHoldings = result.holdings.filter((h) => h.impacted);
  const scenarioEvent = SCENARIO_EVENTS.find((e) => e.id === scenarioType);

  const heatmapRings = hasRun ? buildHeatmapRings(
    scenarioEvent?.epicenter,
    scenarioType === "carbon" ? null : SEVERITY_RADII[severity],
    impactedHoldings.map((h) => ({ coordinates: h.coordinates, exposureScore: h.exposureScore, ticker: h.ticker })),
    scenarioType,
  ) : [];

  function handleRun() {
    runStressTest();
    setHasRun(true);
  }

  function handleReset() {
    resetAssumptions();
    setHasRun(false);
  }

  const sLabel = (t: string) => (
    <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/35">{t}</h3>
  );

  /* ── Metric Cards ──────────────────────────────────────── */

  const metricCards = [
    {
      label: "Portfolio P&L",
      value: fmt(result.portfolio.totalPortfolioPnL),
      tone: result.portfolio.totalPortfolioPnL <= 0 ? "text-red-400" : "text-emerald-400",
      info: {
        title: "Total Portfolio P&L",
        formula: "P&L = Sum( Position_i x EquityMove%_i / 100 )",
        explanation: "Net profit/loss across all portfolio holdings under the stress scenario. Each company's equity move is derived from the 7-step financial chain: physical damage, revenue loss, EBITDA compression, credit deterioration, and valuation multiple compression.",
        variables: result.holdings.map((h) => ({
          name: h.ticker,
          value: `${fmt(h.positionPnL)} (equity ${pct(h.equityMovePct)})`,
        })),
      },
    },
    {
      label: "Avg Physical Damage",
      value: fmt(summaryMetrics.avgPhysicalDamage),
      tone: "text-white",
      info: {
        title: "Average Physical Damage",
        formula: "Dmg = AssetBase x FacilityInZone% x DamageRate x ClimateSens x ExposureScore",
        explanation: "Average direct asset damage across impacted holdings. AssetBase is derived from revenue and EBITDA margin. FacilityInZone% reflects how much of each company's facilities fall within the scenario's impact radius.",
        variables: impactedHoldings.map((h) => ({
          name: h.ticker,
          value: `${fmt(h.physicalDamage)} (${h.exposurePct.toFixed(0)}% exposed)`,
        })),
      },
    },
    {
      label: "Avg Revenue Loss",
      value: fmt(summaryMetrics.avgRevenueLoss),
      tone: "text-white",
      info: {
        title: "Average Revenue Loss",
        formula: "RevLoss = DailyRev x DowntimeDays x ExposureScore x RevSensitivity x FacilityFactor",
        explanation: `Revenue loss from operational downtime. Current scenario assumes ${effectiveAssumptions.downtimeDays} days of disruption at severity ${severity}. Companies with higher facility concentration in the impact zone suffer proportionally more.`,
        variables: impactedHoldings.map((h) => ({
          name: h.ticker,
          value: `${fmt(h.revenueLoss)} (${effectiveAssumptions.downtimeDays}d downtime)`,
        })),
      },
    },
    {
      label: "Avg Equity Move",
      value: pct(summaryMetrics.avgEquityMovePct),
      tone: summaryMetrics.avgEquityMovePct < -10 ? "text-red-400" : summaryMetrics.avgEquityMovePct < 0 ? "text-amber-400" : "text-emerald-400",
      info: {
        title: "Average Equity Price Move",
        formula: "Equity% = EBITDA_Delta x 0.72 - ValuationCompress x ValSens - CreditPenalty - ScenarioPenalty",
        explanation: `Weighted equity price movement across impacted holdings. Driven by EBITDA compression (${summaryMetrics.avgEbitdaDeltaPct.toFixed(1)}% avg), valuation multiple compression (${effectiveAssumptions.valuationCompressionPct}%), and credit spread expansion (${effectiveAssumptions.spreadExpansionBps}bps).`,
        variables: result.holdings.map((h) => ({
          name: h.ticker,
          value: `${pct(h.equityMovePct)} | EBITDA ${pct(h.ebitdaDeltaPct)}`,
        })),
      },
    },
  ];

  /* ── Impact Chain ──────────────────────────────────────── */

  const chainSteps = [
    {
      step: "01",
      label: "Asset Damage",
      value: fmt(summaryMetrics.avgPhysicalDamage),
      detail: `${(effectiveAssumptions.damageRate * 100).toFixed(1)}% damage rate applied to facilities in zone`,
      formula: "AssetBase x FacilityInZone% x DamageRate x Sensitivity",
    },
    {
      step: "02",
      label: "Revenue Disruption",
      value: fmt(summaryMetrics.avgRevenueLoss),
      detail: `${effectiveAssumptions.downtimeDays}-day operational downtime modeled`,
      formula: "DailyRevenue x Downtime x ExposureScore x RevSensitivity",
    },
    {
      step: "03",
      label: "EBITDA Compression",
      value: `${summaryMetrics.avgEbitdaDeltaPct.toFixed(1)}%`,
      detail: "Operating margin squeeze from revenue loss + cost spikes",
      formula: "(StressedEBITDA - BaselineEBITDA) / BaselineEBITDA x 100",
    },
    {
      step: "04",
      label: "Credit Pressure",
      value: `${effectiveAssumptions.spreadExpansionBps}bps`,
      detail: `Coverage ratio: ${summaryMetrics.avgBaselineCoverage.toFixed(1)}x → ${summaryMetrics.avgStressedCoverage.toFixed(1)}x`,
      formula: "CoverageDeterioration x 0.42 + LeverageExpansion x 0.24 + SpreadBps x 0.18",
    },
    {
      step: "05",
      label: "Equity Impact",
      value: fmt(result.portfolio.totalPortfolioPnL),
      detail: `Net across ${result.holdings.length} holdings after position-type translation`,
      formula: "Sum( PositionValue x EquityMove% / 100 ) per holding",
    },
  ];

  /* ── Risk Flags ────────────────────────────────────────── */

  const distressCount = result.holdings.filter((h) => h.resilienceVerdict === "Faces Distress").length;
  const struggleCount = result.holdings.filter((h) => h.resilienceVerdict === "Struggles to Recover").length;

  const riskFlags = [
    {
      severity: result.portfolio.hedgeEfficiencyPct < 20 ? "high" : "medium",
      title: "Hedge Coverage",
      body: `Short book offsets ${result.portfolio.hedgeEfficiencyPct.toFixed(0)}% of long stress losses. Residual unhedged: ${fmt(result.portfolio.residualUnhedgedRisk)}.`,
    },
    {
      severity: (result.diagnostics.concentrationAlerts.length > 0 ? "high" : "low") as "high" | "medium" | "low",
      title: "Concentration Risk",
      body: result.diagnostics.concentrationAlerts[0] ?? "No shared risk drivers detected across portfolio holdings.",
    },
    {
      severity: distressCount > 0 ? "high" : struggleCount > 0 ? "medium" : "low",
      title: "Resilience",
      body: distressCount > 0
        ? `${distressCount} holding(s) face distress. ${struggleCount} struggle to recover.`
        : struggleCount > 0
          ? `${struggleCount} holding(s) struggle to recover under this scenario.`
          : "All holdings absorb the modeled shock within recovery parameters.",
    },
  ];

  const flagDotColor: Record<string, string> = {
    high: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]",
    medium: "bg-amber-500",
    low: "bg-emerald-500",
  };

  /* ── Render ────────────────────────────────────────────── */

  return (
    <div className="h-full min-h-0 p-4 sm:p-6">
      <div className="grid h-full min-h-[calc(100vh-6rem)] grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,28%)_minmax(0,72%)]">

        {/* ── LEFT SIDEBAR ─────────────────────────────────── */}
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1 no-scrollbar">

          {/* Scenario Setup */}
          <FadePanel delay={0} className="rounded-xl border border-white/[0.08] bg-black/40 p-5 backdrop-blur-md">
            <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/35">Scenario Setup</h3>
            <div className="space-y-4">
              <select
                value={scenarioType}
                onChange={(e) => { setScenarioType(e.target.value as ScenarioType); setHasRun(false); }}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none"
              >
                {SCENARIO_EVENTS.map((ev) => (
                  <option key={ev.id} value={ev.id} className="bg-slate-900 text-white">
                    {ev.icon} {ev.label}
                  </option>
                ))}
              </select>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-2">Severity Level</p>
                <div className="grid grid-cols-5 gap-2">
                  {([1, 2, 3, 4, 5] as SeverityLevel[]).map((lv) => (
                    <button key={lv} type="button" onClick={() => setSeverity(lv)}
                      className={`rounded-lg border px-2 py-2.5 text-[11px] font-medium transition cursor-pointer
                        ${severity === lv
                          ? "border-amber-300/50 bg-amber-400/20 text-amber-200"
                          : "border-white/10 bg-white/5 text-white/55 hover:text-white/80"}`}>
                      {SEVERITY_LABELS[lv]}
                    </button>
                  ))}
                </div>
              </div>

              <button type="button" onClick={() => setShowCustom(!showCustom)}
                className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/60 hover:text-white/80 transition cursor-pointer">
                <span>Custom Assumptions</span>
                <span className="text-[10px] text-white/30">{showCustom ? "[-]" : "[+]"}</span>
              </button>

              {showCustom && (
                <div className="space-y-4 animate-in fade-in-0 slide-in-from-top-2">
                  {[
                    { label: "Asset Damage %", value: Number((effectiveAssumptions.damageRate * 100).toFixed(1)), min: 0, max: 65, step: 1, onChange: (v: number) => setOverride("damageRate", v / 100), suffix: "%" },
                    { label: "Revenue Downtime", value: effectiveAssumptions.downtimeDays, min: 0, max: 120, step: 1, onChange: (v: number) => setOverride("downtimeDays", v), suffix: " days" },
                    { label: "Cost Multiplier", value: effectiveAssumptions.costMultiplier, min: 1, max: 3, step: 0.05, onChange: (v: number) => setOverride("costMultiplier", v), suffix: "x" },
                    { label: "Spread Expansion", value: effectiveAssumptions.spreadExpansionBps, min: 0, max: 300, step: 5, onChange: (v: number) => setOverride("spreadExpansionBps", v), suffix: " bps" },
                    { label: "Valuation Compress", value: effectiveAssumptions.valuationCompressionPct, min: 0, max: 45, step: 1, onChange: (v: number) => setOverride("valuationCompressionPct", v), suffix: "%" },
                  ].map((s) => (
                    <div key={s.label}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-white/50">{s.label}</span>
                        <span className="text-xs font-mono text-amber-400">{s.value}{s.suffix}</span>
                      </div>
                      <input type="range" min={s.min} max={s.max} step={s.step} value={s.value}
                        onChange={(e) => s.onChange(Number(e.target.value))}
                        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-amber-400" />
                    </div>
                  ))}
                </div>
              )}

              <button type="button" onClick={handleRun}
                className="w-full rounded-xl border border-amber-300/40 bg-amber-400/10 px-4 py-3.5 text-sm font-medium text-amber-200 transition hover:bg-amber-400/20 cursor-pointer">
                Run Portfolio Stress Test
              </button>
              <button type="button" onClick={handleReset}
                className="w-full text-xs text-white/30 hover:text-white/60 transition cursor-pointer py-1">
                Reset to Defaults
              </button>
            </div>
          </FadePanel>

          {/* Impact Chain (sidebar) */}
          <FadePanel delay={100} className="rounded-xl border border-white/[0.08] bg-black/40 p-5 backdrop-blur-md">
            <div className="flex items-center gap-2 mb-4">
              {sLabel("Financial Impact Chain")}
              <InfoButton
                title="7-Step Financial Chain"
                formula="Damage → Revenue → EBITDA → Coverage → Credit → Equity"
                explanation="Deterministic cascade model: a climate event causes physical asset damage, which disrupts revenue through downtime, compresses EBITDA from lost revenue + cost spikes, deteriorates debt coverage ratios, increases credit spread, and ultimately moves equity price through multiple compression."
                variables={chainSteps.map((s) => ({ name: `Step ${s.step}`, value: `${s.label}: ${s.value}` }))}
              />
            </div>
            <div className="space-y-3">
              {chainSteps.map((s, i) => (
                <div key={s.step} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] font-mono text-amber-400/60 w-5 text-center">{s.step}</span>
                    {i < chainSteps.length - 1 && <div className="w-px h-6 bg-white/[0.08] mt-1" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-white/70">{s.label}</span>
                      <span className="text-xs font-mono font-semibold text-white">{s.value}</span>
                    </div>
                    <p className="text-[10px] text-white/25 mt-0.5 leading-relaxed">{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </FadePanel>

          {/* Risk Flags (sidebar) */}
          <FadePanel delay={200} className="rounded-xl border border-white/[0.08] bg-black/40 p-5 backdrop-blur-md">
            {sLabel("Risk Flags")}
            <div className="space-y-3">
              {riskFlags.map((f) => (
                <div key={f.title} className="flex items-start gap-2.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${flagDotColor[f.severity]}`} />
                  <div>
                    <p className="text-xs font-medium text-white/70">{f.title}</p>
                    <p className="text-[11px] text-white/35 leading-relaxed mt-0.5">{f.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </FadePanel>
        </div>

        {/* ── MAIN CONTENT AREA ────────────────────────────── */}
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1 no-scrollbar">

          {/* Top metric cards */}
          <FadePanel delay={50} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metricCards.map((m) => (
              <div key={m.label} className="rounded-xl border border-white/[0.08] bg-black/40 p-4 backdrop-blur-md">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">{m.label}</p>
                  <InfoButton {...m.info} />
                </div>
                <p className={`text-2xl font-semibold ${m.tone}`}>{m.value}</p>
              </div>
            ))}
          </FadePanel>

          {/* Map with heatmap */}
          <FadePanel delay={150} className="rounded-xl border border-white/[0.08] bg-black/40 p-4 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">Scenario Footprint</p>
                <p className="mt-1 text-sm text-white/70">
                  {hasRun ? `${scenarioEvent?.icon ?? ""} ${result.mapContext.footprintLabel}` : "Select a scenario and run the stress test"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {hasRun && (
                  <span className="text-[10px] font-mono text-white/30">
                    {impactedHoldings.length}/{result.holdings.length} holdings impacted
                  </span>
                )}
                {focusedResult && (
                  <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-300 font-mono">
                    {focusedResult.ticker}
                  </div>
                )}
              </div>
            </div>

            <div className="relative h-[380px] overflow-hidden rounded-xl border border-white/[0.08]">
              <MapContainer center={MAP_CENTER} zoom={INITIAL_ZOOM} scrollWheelZoom className="h-full w-full" zoomControl={false}>
                <TileLayer
                  attribution="&copy; OpenStreetMap &copy; CARTO"
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />

                {/* Heatmap rings */}
                {heatmapRings.map((ring, i) => (
                  <Circle
                    key={`heat-${i}`}
                    center={ring.center}
                    radius={ring.radius}
                    pathOptions={{
                      color: ring.color,
                      fillColor: ring.color,
                      fillOpacity: ring.fillOpacity,
                      weight: ring.weight,
                      dashArray: ring.weight > 1 ? "8 6" : undefined,
                    }}
                  />
                ))}

                {/* Impact zone outline */}
                {hasRun && result.mapContext.impactZoneCenter && result.mapContext.impactZoneRadiusMeters && (
                  <Circle
                    center={result.mapContext.impactZoneCenter}
                    radius={result.mapContext.impactZoneRadiusMeters}
                    pathOptions={{ color: "#ef4444", fillColor: "transparent", fillOpacity: 0, weight: 1.5, dashArray: "12 8", opacity: 0.4 }}
                  />
                )}

                {/* Company markers */}
                {result.holdings.map((h) => (
                  <Marker
                    key={h.ticker}
                    position={h.coordinates}
                    icon={buildMarkerIcon({
                      markerSize: h.markerSize,
                      ticker: h.ticker,
                      positionType: h.positionType,
                      impacted: result.mapContext.impactedTickers.includes(h.ticker),
                      scenarioType,
                      focused: selectedTicker === h.ticker,
                    })}
                    eventHandlers={{ click: () => setFocusedTicker(h.ticker) }}
                  />
                ))}
              </MapContainer>

              {/* Legend overlay */}
              {hasRun && (
                <div className="pointer-events-none absolute left-3 bottom-3 rounded-lg border border-white/[0.08] bg-black/60 backdrop-blur-md px-3 py-2">
                  <div className="flex items-center gap-3 text-[10px]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                      <span className="text-white/40">High Impact</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500/20" />
                      <span className="text-white/40">Moderate</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-gray-500/40" />
                      <span className="text-white/40">Unaffected</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </FadePanel>

          {/* Company Stress Results */}
          <FadePanel delay={250} className="rounded-xl border border-white/[0.08] bg-black/40 p-5 backdrop-blur-md">
            <div className="flex items-center justify-between mb-4">
              {sLabel("Company Stress Results")}
              <InfoButton
                title="Company Results"
                formula="Per company: Exposure → Damage → Revenue → EBITDA → Credit → Equity → P&L"
                explanation="Each company is stressed through the full financial chain. Exposure score combines geographic proximity (40%), facility concentration in impact zone (40%), and sector sensitivity (20%). The resulting equity move is translated into P&L based on position size."
                variables={[
                  { name: "Holdings", value: `${result.holdings.length} total` },
                  { name: "Impacted", value: `${impactedHoldings.length}` },
                  { name: "Avg Exposure", value: `${(impactedHoldings.reduce((s, h) => s + h.exposurePct, 0) / Math.max(impactedHoldings.length, 1)).toFixed(1)}%` },
                ]}
              />
            </div>

            <div className="space-y-3">
              {result.holdings.map((h) => {
                const isSelected = selectedTicker === h.ticker;
                const isImpacted = h.impacted;
                return (
                  <button
                    key={h.ticker}
                    type="button"
                    onClick={() => setFocusedTicker(h.ticker)}
                    className={`w-full text-left rounded-xl border p-4 transition-all cursor-pointer
                      ${isSelected ? "border-amber-400/30 bg-amber-400/[0.04]" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"}`}
                  >
                    {/* Header row */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-base font-bold text-white">{h.ticker}</span>
                        <span className="text-xs text-white/30">{h.companyName}</span>
                        <span className="text-[10px] text-white/20">{h.sector}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isImpacted ? (
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase
                            ${h.resilienceVerdict === "Faces Distress" ? "bg-red-500/15 text-red-400"
                              : h.resilienceVerdict === "Struggles to Recover" ? "bg-amber-500/15 text-amber-400"
                              : "bg-emerald-500/15 text-emerald-400"}`}>
                            {h.resilienceVerdict}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-white/[0.04] text-white/20">
                            Not Impacted
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metrics grid */}
                    <div className="grid grid-cols-5 gap-3">
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-white/25">Exposure</p>
                        <p className="text-sm font-mono text-white/60">{h.exposurePct.toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-white/25">Damage</p>
                        <p className="text-sm font-mono text-white/60">{fmt(h.physicalDamage)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-white/25">EBITDA</p>
                        <p className={`text-sm font-mono ${h.ebitdaDeltaPct < -15 ? "text-red-400" : h.ebitdaDeltaPct < 0 ? "text-amber-400" : "text-white/60"}`}>
                          {pct(h.ebitdaDeltaPct)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-white/25">Equity</p>
                        <p className={`text-sm font-mono ${h.equityMovePct < -15 ? "text-red-400" : h.equityMovePct < 0 ? "text-amber-400" : "text-white/60"}`}>
                          {pct(h.equityMovePct)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-white/25">P&L</p>
                        <p className={`text-sm font-mono font-semibold ${h.positionPnL < 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {fmt(h.positionPnL)}
                        </p>
                      </div>
                    </div>

                    {/* Expanded detail for selected company */}
                    {isSelected && isImpacted && (
                      <div className="mt-3 pt-3 border-t border-white/[0.05] grid grid-cols-4 gap-3">
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-white/25">Rev Loss</p>
                          <p className="text-xs font-mono text-white/50">{fmt(h.revenueLoss)}</p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-white/25">Cost Spike</p>
                          <p className="text-xs font-mono text-white/50">{fmt(h.costSpike)}</p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-white/25">Coverage</p>
                          <p className="text-xs font-mono text-white/50">
                            {h.baselineInterestCoverage.toFixed(1)}x → {h.stressedInterestCoverage.toFixed(1)}x
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-white/25">Credit</p>
                          <p className={`text-xs font-mono ${h.creditPressure === "Severe" ? "text-red-400" : h.creditPressure === "Elevated" ? "text-amber-400" : "text-white/50"}`}>
                            {h.creditPressure}
                          </p>
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </FadePanel>

          {/* Scenario Assumptions Summary */}
          <FadePanel delay={350} className="rounded-xl border border-white/[0.08] bg-black/40 p-5 backdrop-blur-md">
            <div className="flex items-center justify-between mb-3">
              {sLabel("Active Assumptions")}
              <InfoButton
                title="Scenario Assumptions"
                formula="Base defaults scaled by: Severity x SeverityMult + Horizon x HorizonMult"
                explanation="Each scenario type has base default assumptions that are scaled by severity (Cat 1-5) and time horizon. Custom overrides replace the computed defaults. These parameters drive the entire financial chain calculation."
                variables={[
                  { name: "Damage Rate", value: `${(effectiveAssumptions.damageRate * 100).toFixed(1)}%` },
                  { name: "Downtime", value: `${effectiveAssumptions.downtimeDays} days` },
                  { name: "Cost Mult", value: `${effectiveAssumptions.costMultiplier}x` },
                  { name: "Spread", value: `${effectiveAssumptions.spreadExpansionBps} bps` },
                  { name: "Valuation", value: `${effectiveAssumptions.valuationCompressionPct}%` },
                ]}
              />
            </div>
            <div className="grid grid-cols-5 gap-3">
              {[
                { label: "Damage Rate", value: `${(effectiveAssumptions.damageRate * 100).toFixed(1)}%` },
                { label: "Downtime", value: `${effectiveAssumptions.downtimeDays}d` },
                { label: "Cost Mult", value: `${effectiveAssumptions.costMultiplier}x` },
                { label: "Spread", value: `${effectiveAssumptions.spreadExpansionBps}bp` },
                { label: "Val Compress", value: `${effectiveAssumptions.valuationCompressionPct}%` },
              ].map((a) => (
                <div key={a.label} className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2.5 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-white/25 mb-1">{a.label}</p>
                  <p className="text-sm font-mono text-amber-400/80">{a.value}</p>
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
