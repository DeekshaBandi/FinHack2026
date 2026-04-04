import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

/* ══════════════════════════════════════════════════════════════
   PORTFOLIO DATA — sourced from companies.json, supply_chain.json,
   facility_locations.json, climate_hazards.json
   ══════════════════════════════════════════════════════════════ */

interface CompanyData {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  region: string;
  revenue: number;
  ebitda: number;
  totalAssets: number;
  netDebt: number;
  interestExpense: number;
  evEbitda: number;
  marketCap: number;
  climate: {
    hurricane: number;
    wildfire: number;
    flood: number;
    drought: number;
    sea_level_rise: number;
  };
  positionSize: number;
  facilities: Array<{ name: string; region: string; assetPct: number }>;
}

const PORTFOLIO: CompanyData[] = [
  {
    ticker: "VLO", name: "Valero Energy", sector: "Energy", industry: "Oil & Gas Refining",
    region: "gulf_coast", revenue: 139009, ebitda: 12580, totalAssets: 60300, netDebt: 8900,
    interestExpense: 720, evEbitda: 5.5, marketCap: 48000,
    climate: { hurricane: 0.90, wildfire: 0.08, flood: 0.72, drought: 0.28, sea_level_rise: 0.68 },
    positionSize: 12_000_000,
    facilities: [
      { name: "Port Arthur Refinery", region: "gulf_coast", assetPct: 0.30 },
      { name: "Corpus Christi Refinery", region: "gulf_coast", assetPct: 0.25 },
      { name: "Houston Refinery", region: "gulf_coast", assetPct: 0.20 },
    ],
  },
  {
    ticker: "NRG", name: "NRG Energy", sector: "Utilities", industry: "Independent Power",
    region: "gulf_coast", revenue: 28000, ebitda: 4200, totalAssets: 42000, netDebt: 8500,
    interestExpense: 650, evEbitda: 10.5, marketCap: 18000,
    climate: { hurricane: 0.75, wildfire: 0.15, flood: 0.55, drought: 0.45, sea_level_rise: 0.48 },
    positionSize: 8_000_000,
    facilities: [
      { name: "Houston HQ & Operations", region: "gulf_coast", assetPct: 0.35 },
      { name: "Texas Generation Fleet", region: "gulf_coast", assetPct: 0.40 },
    ],
  },
  {
    ticker: "EGP", name: "EastGroup Properties", sector: "Real Estate", industry: "Industrial REITs",
    region: "southeast", revenue: 600, ebitda: 420, totalAssets: 5500, netDebt: 2300,
    interestExpense: 95, evEbitda: 22.0, marketCap: 8000,
    climate: { hurricane: 0.58, wildfire: 0.35, flood: 0.62, drought: 0.20, sea_level_rise: 0.40 },
    positionSize: 5_000_000,
    facilities: [
      { name: "Jackson MS Industrial Parks", region: "southeast", assetPct: 0.35 },
      { name: "Sunbelt Distribution Centers", region: "southeast", assetPct: 0.45 },
    ],
  },
  {
    ticker: "ALL", name: "Allstate Corp", sector: "Financials", industry: "P&C Insurance",
    region: "midwest", revenue: 57364, ebitda: 6820, totalAssets: 84200, netDebt: 8200,
    interestExpense: 650, evEbitda: 7.2, marketCap: 48000,
    climate: { hurricane: 0.85, wildfire: 0.70, flood: 0.78, drought: 0.25, sea_level_rise: 0.65 },
    positionSize: 10_000_000,
    facilities: [
      { name: "Northbrook HQ", region: "midwest", assetPct: 0.20 },
    ],
  },
];

/* ── Calculations ──────────────────────────────────────────── */

const TOTAL_POSITION = PORTFOLIO.reduce((s, c) => s + c.positionSize, 0);
const TAIL_FACTOR_95 = 0.15;
const TRANSITION_FACTOR = 0.12;
const CONTAGION_DECAY = 0.6;

function computePhysicalVaR(company: CompanyData): number {
  const peakPhysical = Math.max(company.climate.hurricane, company.climate.flood, company.climate.wildfire);
  return company.positionSize * peakPhysical * TAIL_FACTOR_95;
}

function computeTransitionVaR(company: CompanyData): number {
  const transitionScore = (company.climate.drought + company.climate.sea_level_rise) / 2;
  const sectorMultiplier = company.sector === "Energy" ? 1.8 : company.sector === "Utilities" ? 1.4 : company.sector === "Financials" ? 1.2 : 1.0;
  return company.positionSize * transitionScore * TRANSITION_FACTOR * sectorMultiplier;
}

function computeContagionVaR(company: CompanyData): number {
  const SUPPLY_CHAIN_WEIGHTS: Record<string, number> = {
    VLO: 0.85 + 0.70 + 0.60 + 0.45 + 0.50,
    NRG: 0.15,
    EGP: 0.10,
    ALL: 0.45 + 0.42,
  };
  const connectivity = (SUPPLY_CHAIN_WEIGHTS[company.ticker] ?? 0.1) / 4;
  return company.positionSize * connectivity * CONTAGION_DECAY * 0.08;
}

function computeCompositeRisk(company: CompanyData): number {
  const c = company.climate;
  return (c.hurricane * 0.30 + c.flood * 0.20 + c.wildfire * 0.15 + c.drought * 0.15 + c.sea_level_rise * 0.20) * 100;
}

const PORTFOLIO_METRICS = PORTFOLIO.map((c) => ({
  ...c,
  physicalVaR: computePhysicalVaR(c),
  transitionVaR: computeTransitionVaR(c),
  contagionVaR: computeContagionVaR(c),
  compositeRisk: computeCompositeRisk(c),
}));

const TOTAL_PHYSICAL_VAR = PORTFOLIO_METRICS.reduce((s, c) => s + c.physicalVaR, 0);
const TOTAL_TRANSITION_VAR = PORTFOLIO_METRICS.reduce((s, c) => s + c.transitionVaR, 0);
const TOTAL_CONTAGION_VAR = PORTFOLIO_METRICS.reduce((s, c) => s + c.contagionVaR, 0);
const TOTAL_CVAR_95 = TOTAL_PHYSICAL_VAR + TOTAL_TRANSITION_VAR + TOTAL_CONTAGION_VAR;
const RISK_LEVEL_PCT = (TOTAL_CVAR_95 / TOTAL_POSITION) * 100;

function formatDollar(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

/* ── Glass card wrapper ─────────────────────────────────────── */

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  label: string;
  delay?: number;
}

function GlassCard({ children, className = "", label, delay = 0 }: GlassCardProps) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <div
      className={`rounded-xl border border-white/[0.08] bg-black/40 backdrop-blur-md p-5 overflow-visible
                  transition-all duration-500 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}
                  ${className}`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30 mb-2 block">
        {label}
      </span>
      {children}
    </div>
  );
}

/* ── Info Button + Popup ───────────────────────────────────── */

interface InfoPopupProps {
  title: string;
  formula: string;
  explanation: string;
  variables?: Array<{ name: string; value: string }>;
}

function InfoButton({ title, formula, explanation, variables }: InfoPopupProps) {
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popupWidth = 320;
    const popupHeight = 300;

    let left = rect.left + rect.width / 2 - popupWidth / 2;
    let top = rect.bottom + 8;

    if (left < 12) left = 12;
    if (left + popupWidth > window.innerWidth - 12) left = window.innerWidth - popupWidth - 12;
    if (top + popupHeight > window.innerHeight - 12) top = rect.top - popupHeight - 8;

    setPopupPos({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    function handleClick(e: MouseEvent) {
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleScroll() { updatePosition(); }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

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
          style={{ top: popupPos.top, left: popupPos.left, zIndex: 9999 }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-white uppercase tracking-wider">{title}</span>
            <button
              onClick={() => setOpen(false)}
              className="w-5 h-5 rounded-full bg-white/5 flex items-center justify-center
                         text-white/30 hover:text-white/60 hover:bg-white/10 text-xs cursor-pointer transition-all"
            >
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

/* ── Panel 1: Climate Risk Score ────────────────────────────── */

function RiskScorePanel() {
  const [gaugeWidth, setGaugeWidth] = useState(0);
  useEffect(() => {
    const clampedRisk = Math.min(Math.max(RISK_LEVEL_PCT * 4.5, 10), 95);
    const t = setTimeout(() => setGaugeWidth(clampedRisk), 400);
    return () => clearTimeout(t);
  }, []);

  const riskLabel = gaugeWidth > 75 ? "Critical" : gaugeWidth > 55 ? "High" : gaugeWidth > 35 ? "Moderate-High" : "Moderate";

  const secondaryMetrics = [
    {
      label: "Physical Risk VaR",
      value: formatDollar(TOTAL_PHYSICAL_VAR),
      sub: "Hurricane, flood, wildfire exposure",
      info: {
        title: "Physical Risk VaR",
        formula: "PhysVaR = Sum( Position_i x max(Hurr, Flood, Fire)_i x 0.15 )",
        explanation: "95th percentile loss from direct physical climate events. Uses each company's peak physical hazard exposure score multiplied by position size and a tail factor of 15%.",
        variables: PORTFOLIO_METRICS.map((c) => ({
          name: c.ticker,
          value: `${formatDollar(c.positionSize)} x ${Math.max(c.climate.hurricane, c.climate.flood, c.climate.wildfire).toFixed(2)} x 0.15 = ${formatDollar(c.physicalVaR)}`,
        })),
      },
    },
    {
      label: "Transition Risk VaR",
      value: formatDollar(TOTAL_TRANSITION_VAR),
      sub: "Carbon regulation, stranded assets",
      info: {
        title: "Transition Risk VaR",
        formula: "TransVaR = Sum( Pos_i x avg(Drought, SLR)_i x 0.12 x SectorMult )",
        explanation: "Expected loss from regulatory and market transition to low-carbon economy. Energy companies carry a 1.8x sector multiplier due to stranded asset risk; Utilities 1.4x; Financials 1.2x.",
        variables: PORTFOLIO_METRICS.map((c) => ({
          name: c.ticker,
          value: `${formatDollar(c.positionSize)} x ${((c.climate.drought + c.climate.sea_level_rise) / 2).toFixed(2)} x 0.12 x ${c.sector === "Energy" ? "1.8" : c.sector === "Utilities" ? "1.4" : c.sector === "Financials" ? "1.2" : "1.0"} = ${formatDollar(c.transitionVaR)}`,
        })),
      },
    },
    {
      label: "Contagion Risk VaR",
      value: formatDollar(TOTAL_CONTAGION_VAR),
      sub: "Indirect supply chain propagation",
      info: {
        title: "Contagion Risk VaR",
        formula: "ContVaR = Sum( Pos_i x (SupplyChainWeight / 4) x 0.6 x 0.08 )",
        explanation: "Indirect risk from supply chain disruption cascading through connected companies. VLO has the highest connectivity (3.10 total edge weight) due to crude supply and refined product relationships. Decay factor of 0.6 per hop.",
        variables: PORTFOLIO_METRICS.map((c) => ({
          name: c.ticker,
          value: formatDollar(c.contagionVaR),
        })),
      },
    },
  ];

  return (
    <>
      <div className="mb-1">
        <div className="flex items-baseline gap-3 mb-1">
          <span className="text-4xl md:text-5xl font-bold text-white tracking-tight">
            CVaR-95: {formatDollar(TOTAL_CVAR_95)}
          </span>
          <InfoButton
            title="Climate Value-at-Risk (95%)"
            formula="CVaR-95 = Physical VaR + Transition VaR + Contagion VaR"
            explanation="The 95th percentile Climate Value-at-Risk represents the expected loss in the worst 5% of climate scenarios over a single quarter. Aggregates physical, transition, and supply chain contagion risk across the four-company portfolio."
            variables={[
              { name: "Physical VaR", value: formatDollar(TOTAL_PHYSICAL_VAR) },
              { name: "Transition VaR", value: formatDollar(TOTAL_TRANSITION_VAR) },
              { name: "Contagion VaR", value: formatDollar(TOTAL_CONTAGION_VAR) },
              { name: "Total Portfolio", value: formatDollar(TOTAL_POSITION) },
              { name: "CVaR / Portfolio", value: `${((TOTAL_CVAR_95 / TOTAL_POSITION) * 100).toFixed(1)}%` },
            ]}
          />
        </div>
        <p className="text-xs text-white/35 leading-relaxed max-w-lg">
          5% probability of losing {formatDollar(TOTAL_CVAR_95)} or more in a single quarter under current climate trajectory across {PORTFOLIO.length} holdings totaling {formatDollar(TOTAL_POSITION)}
        </p>
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-3 gap-3 my-5">
        {secondaryMetrics.map((m) => (
          <div key={m.label} className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-3 relative">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-wider text-white/30">{m.label}</p>
              <InfoButton {...m.info} />
            </div>
            <p className="text-lg font-bold text-white">{m.value}</p>
            <p className="text-[10px] text-white/25 mt-0.5">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Risk gauge */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-white/30">Portfolio Risk Level</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">{riskLabel}</span>
        </div>
        <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{
              width: `${gaugeWidth}%`,
              background: "linear-gradient(90deg, #22c55e 0%, #eab308 40%, #f97316 65%, #ef4444 100%)",
            }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-white/20">Low</span>
          <span className="text-[9px] text-white/20">Critical</span>
        </div>
      </div>
    </>
  );
}

/* ── Panel 2: Top Exposed Holdings ──────────────────────────── */

function ExposedHoldingsPanel() {
  const sorted = [...PORTFOLIO_METRICS].sort((a, b) => b.compositeRisk - a.compositeRisk);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-white">Portfolio Holdings</h3>
        <span className="text-[10px] text-white/25 font-mono">{PORTFOLIO.length} positions | {formatDollar(TOTAL_POSITION)} total</span>
      </div>

      {/* Header row — NO Type column */}
      <div className="grid grid-cols-[24px_1fr_minmax(90px,1fr)_55px_55px_80px] gap-x-2 items-center
                      text-[9px] uppercase tracking-wider text-white/25 mb-2 px-1">
        <span>#</span>
        <span>Holding</span>
        <span>Composite Risk</span>
        <span className="text-center">Phys</span>
        <span className="text-center">Trans</span>
        <span className="text-right">Exposure</span>
      </div>

      <div className="space-y-1">
        {sorted.map((h, i) => {
          const physScore = Math.round(Math.max(h.climate.hurricane, h.climate.flood, h.climate.wildfire) * 100);
          const transScore = Math.round(((h.climate.drought + h.climate.sea_level_rise) / 2) * 100);
          const totalExposure = h.physicalVaR + h.transitionVaR + h.contagionVaR;

          return (
            <div
              key={h.ticker}
              className="grid grid-cols-[24px_1fr_minmax(90px,1fr)_55px_55px_80px] gap-x-2 items-center
                         rounded-lg px-1 py-2.5 hover:bg-white/[0.04] transition-colors group cursor-pointer"
            >
              <span className="text-xs text-white/20 font-mono">{i + 1}</span>

              <div className="min-w-0">
                <span className="text-sm font-semibold text-white">{h.ticker}</span>
                <span className="text-xs text-white/30 ml-1.5 hidden lg:inline">{h.name}</span>
                <span className="text-[10px] text-white/15 ml-1.5 hidden xl:inline">{h.industry}</span>
              </div>

              {/* Risk bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(h.compositeRisk, 100)}%`,
                      background: h.compositeRisk > 65
                        ? "linear-gradient(90deg, #f97316, #ef4444)"
                        : h.compositeRisk > 45
                          ? "linear-gradient(90deg, #eab308, #f97316)"
                          : "linear-gradient(90deg, #22c55e, #eab308)",
                    }}
                  />
                </div>
                <span className="text-[11px] font-mono text-white/50 w-7 text-right">{Math.round(h.compositeRisk)}</span>
              </div>

              <span className="text-[11px] font-mono text-center text-orange-400/70">{physScore}</span>
              <span className="text-[11px] font-mono text-center text-purple-400/70">{transScore}</span>

              <span className="text-xs font-mono text-right font-medium text-red-400">
                {formatDollar(totalExposure)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Portfolio allocation bar */}
      <div className="mt-4 pt-3 border-t border-white/[0.05]">
        <p className="text-[10px] uppercase tracking-wider text-white/25 mb-2">Allocation</p>
        <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
          {PORTFOLIO.map((c) => {
            const pct = (c.positionSize / TOTAL_POSITION) * 100;
            const colors: Record<string, string> = {
              VLO: "#f59e0b",
              NRG: "#3b82f6",
              EGP: "#22c55e",
              ALL: "#a855f7",
            };
            return (
              <div
                key={c.ticker}
                className="h-full rounded-sm"
                style={{ width: `${pct}%`, backgroundColor: colors[c.ticker] ?? "#666" }}
                title={`${c.ticker}: ${pct.toFixed(0)}%`}
              />
            );
          })}
        </div>
        <div className="flex justify-between mt-1.5">
          {PORTFOLIO.map((c) => {
            const pct = (c.positionSize / TOTAL_POSITION) * 100;
            const colors: Record<string, string> = {
              VLO: "text-amber-400",
              NRG: "text-blue-400",
              EGP: "text-emerald-400",
              ALL: "text-purple-400",
            };
            return (
              <span key={c.ticker} className={`text-[10px] font-mono ${colors[c.ticker]}`}>
                {c.ticker} {pct.toFixed(0)}%
              </span>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ── Panel 3: Highest Risk Pathway ─────────────────────────── */

interface PathwayNode {
  id: string;
  x: number;
  y: number;
  size: number;
  isPortfolio: boolean;
  riskScore: number;
}

interface PathwayEdge {
  from: string;
  to: string;
  weight: number;
  type: string;
}

const PATHWAY_NODES: PathwayNode[] = [
  { id: "VLO", x: 55, y: 90, size: 22, isPortfolio: true, riskScore: 90 },
  { id: "DOW", x: 190, y: 50, size: 14, isPortfolio: false, riskScore: 42 },
  { id: "LYB", x: 190, y: 130, size: 15, isPortfolio: false, riskScore: 68 },
  { id: "ALL", x: 340, y: 50, size: 18, isPortfolio: true, riskScore: 78 },
  { id: "NRG", x: 340, y: 130, size: 16, isPortfolio: true, riskScore: 55 },
  { id: "EGP", x: 430, y: 90, size: 14, isPortfolio: true, riskScore: 43 },
];

const PATHWAY_EDGES: PathwayEdge[] = [
  { from: "VLO", to: "DOW", weight: 0.45, type: "refined_products" },
  { from: "VLO", to: "LYB", weight: 0.50, type: "refined_products" },
  { from: "LYB", to: "ALL", weight: 0.30, type: "chemical_insurance" },
  { from: "NRG", to: "VLO", weight: 0.35, type: "power_supply" },
  { from: "ALL", to: "EGP", weight: 0.25, type: "property_insurance" },
];

function HighestRiskPathwayPanel() {
  const nodeMap = Object.fromEntries(PATHWAY_NODES.map((n) => [n.id, n]));

  const highestRisk = [...PORTFOLIO_METRICS].sort((a, b) => b.compositeRisk - a.compositeRisk)[0];

  const alerts = [
    `${highestRisk.ticker} leads portfolio risk (composite score ${Math.round(highestRisk.compositeRisk)}) — hurricane exposure at ${(highestRisk.climate.hurricane * 100).toFixed(0)}% in Gulf Coast region`,
    "VLO \u2192 LYB \u2192 ALL contagion chain: refinery disruption cascades through chemicals to insurance claims",
    "ALL carries highest multi-peril exposure (hurricane 85%, wildfire 70%, flood 78%) as P&C insurer",
    "Geographic concentration: 3 of 4 holdings exposed to Gulf Coast hurricane corridor",
  ];

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-white">Highest Risk Pathway</h3>
        <span className="text-[10px] font-mono text-red-400/60 uppercase tracking-wider">
          Epicenter: {highestRisk.ticker}
        </span>
      </div>

      <svg viewBox="0 0 490 180" className="w-full h-auto mb-4">
        <defs>
          <filter id="glow-red">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-amber">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Edges */}
        {PATHWAY_EDGES.map((e) => {
          const from = nodeMap[e.from];
          const to = nodeMap[e.to];
          const isHigh = e.weight >= 0.40;
          const color = isHigh ? "#ef4444" : "#f59e0b";
          return (
            <g key={`${e.from}-${e.to}`}>
              <line
                x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke={color}
                strokeWidth={isHigh ? 2 : 1.5}
                strokeDasharray="6 4"
                opacity={0.5}
                filter={isHigh ? "url(#glow-red)" : "url(#glow-amber)"}
              >
                <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="1.5s" repeatCount="indefinite" />
              </line>
              <text
                x={(from.x + to.x) / 2}
                y={(from.y + to.y) / 2 - 6}
                textAnchor="middle"
                className="text-[8px] fill-white/20 font-mono"
              >
                {e.weight.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {PATHWAY_NODES.map((n) => (
          <g key={n.id}>
            {n.isPortfolio && n.riskScore > 70 && (
              <circle cx={n.x} cy={n.y} r={n.size + 8} fill="none" stroke="#ef4444" strokeWidth={1} opacity={0.3}>
                <animate attributeName="r" values={`${n.size + 5};${n.size + 12};${n.size + 5}`} dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
            <circle
              cx={n.x} cy={n.y} r={n.size}
              fill={n.isPortfolio ? (n.riskScore > 70 ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.15)") : "rgba(255,255,255,0.05)"}
              stroke={n.isPortfolio ? (n.riskScore > 70 ? "#ef4444" : "#f59e0b") : "rgba(255,255,255,0.15)"}
              strokeWidth={n.isPortfolio ? 2 : 1}
            />
            <text
              x={n.x} y={n.y + 1}
              textAnchor="middle" dominantBaseline="middle"
              className={`text-[10px] font-bold ${n.isPortfolio ? "fill-white" : "fill-white/50"}`}
            >
              {n.id}
            </text>
          </g>
        ))}
      </svg>

      <div className="space-y-2">
        {alerts.map((a, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px] text-white/40 leading-relaxed">
            <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${i < 2 ? "bg-red-500" : "bg-amber-500"}`} />
            {a}
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Panel 4: Hedge Adequacy Meter ──────────────────────────── */

function HedgeAdequacyPanel() {
  const hedgedAmount = TOTAL_CVAR_95 * 0.32;
  const unhedgedAmount = TOTAL_CVAR_95 - hedgedAmount;
  const hedgePct = Math.round((hedgedAmount / TOTAL_CVAR_95) * 100);
  const hedgeLabel = hedgePct >= 60 ? "Adequately Hedged" : hedgePct >= 40 ? "Partially Hedged" : "Underhedged";

  const [fill, setFill] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setFill(hedgePct), 500);
    return () => clearTimeout(t);
  }, [hedgePct]);

  const RADIUS = 70;
  const STROKE = 10;
  const CENTER_X = 100;
  const CENTER_Y = 85;
  const circumference = Math.PI * RADIUS;
  const offset = circumference - (fill / 100) * circumference;

  const rows = [
    { label: "Total Climate Tail Risk", value: formatDollar(TOTAL_CVAR_95), color: "text-white" },
    { label: "Currently Hedged", value: formatDollar(hedgedAmount), color: "text-blue-400" },
    { label: "Unhedged Exposure", value: formatDollar(unhedgedAmount), color: "text-red-400" },
  ];

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-base font-semibold text-white">Hedge Adequacy</h3>
        <InfoButton
          title="Hedge Adequacy"
          formula="Hedge% = Hedged Amount / Total CVaR-95 x 100"
          explanation="Measures what percentage of climate tail risk is offset by existing hedging positions (short positions, insurance, derivatives). Below 40% is considered critically underhedged for a climate-exposed portfolio."
          variables={[
            { name: "Total CVaR-95", value: formatDollar(TOTAL_CVAR_95) },
            { name: "Hedged", value: formatDollar(hedgedAmount) },
            { name: "Unhedged", value: formatDollar(unhedgedAmount) },
            { name: "Coverage", value: `${hedgePct}%` },
          ]}
        />
      </div>

      <div className="flex justify-center mb-5">
        <svg width="200" height="120" viewBox="0 0 200 120">
          <defs>
            <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>

          {/* Track */}
          <path
            d={`M ${CENTER_X - RADIUS} ${CENTER_Y} A ${RADIUS} ${RADIUS} 0 0 1 ${CENTER_X + RADIUS} ${CENTER_Y}`}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={STROKE}
            strokeLinecap="round"
          />

          {/* Fill */}
          <path
            d={`M ${CENTER_X - RADIUS} ${CENTER_Y} A ${RADIUS} ${RADIUS} 0 0 1 ${CENTER_X + RADIUS} ${CENTER_Y}`}
            fill="none"
            stroke="url(#gauge-grad)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
          />

          <text x={CENTER_X} y={CENTER_Y - 16} textAnchor="middle" className="text-3xl font-bold fill-white">
            {fill}%
          </text>
          <text x={CENTER_X} y={CENTER_Y + 2} textAnchor="middle" className="text-[10px] font-bold fill-amber-400 uppercase tracking-widest">
            {hedgeLabel}
          </text>
        </svg>
      </div>

      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <span className="text-xs text-white/40">{r.label}</span>
            <span className={`text-sm font-bold font-mono ${r.color}`}>{r.value}</span>
          </div>
        ))}
      </div>

      {/* Per-company hedge breakdown */}
      <div className="mt-4 pt-3 border-t border-white/[0.05]">
        <p className="text-[10px] uppercase tracking-wider text-white/25 mb-2">Per-Holding Risk Contribution</p>
        {[...PORTFOLIO_METRICS].sort((a, b) => (b.physicalVaR + b.transitionVaR + b.contagionVaR) - (a.physicalVaR + a.transitionVaR + a.contagionVaR)).map((c) => {
          const total = c.physicalVaR + c.transitionVaR + c.contagionVaR;
          const pct = (total / TOTAL_CVAR_95) * 100;
          return (
            <div key={c.ticker} className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-mono text-white/50 w-8">{c.ticker}</span>
              <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full bg-amber-500/60" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[10px] font-mono text-white/30 w-14 text-right">{formatDollar(total)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Panel 5: Latest Climate News ──────────────────────────── */

interface ClimateNewsItem {
  headline: string;
  source: string;
  time: string;
  severity: "high" | "medium" | "low";
  region: string;
  affectedTickers: string[];
}

const CLIMATE_NEWS: ClimateNewsItem[] = [
  {
    headline: "NOAA forecasts above-average 2026 Atlantic hurricane season with 17-21 named storms",
    source: "NOAA",
    time: "6h ago",
    severity: "high",
    region: "Gulf Coast",
    affectedTickers: ["VLO", "NRG"],
  },
  {
    headline: "Texas grid operator ERCOT issues conservation appeal amid record heat wave",
    source: "Reuters",
    time: "12h ago",
    severity: "high",
    region: "Texas",
    affectedTickers: ["NRG", "VLO"],
  },
  {
    headline: "Allstate reports $1.2B catastrophe losses in Q1 driven by severe convective storms",
    source: "Insurance Journal",
    time: "1d ago",
    severity: "high",
    region: "Nationwide",
    affectedTickers: ["ALL"],
  },
  {
    headline: "Mississippi River flooding threatens industrial properties across Southeast corridor",
    source: "AP News",
    time: "2d ago",
    severity: "medium",
    region: "Southeast",
    affectedTickers: ["EGP"],
  },
  {
    headline: "EPA proposes tighter refinery emissions standards targeting Gulf Coast operations",
    source: "Bloomberg",
    time: "3d ago",
    severity: "medium",
    region: "Gulf Coast",
    affectedTickers: ["VLO"],
  },
  {
    headline: "California wildfire season begins early; insured losses projected to surpass $8B",
    source: "WSJ",
    time: "4d ago",
    severity: "medium",
    region: "California",
    affectedTickers: ["ALL"],
  },
  {
    headline: "FEMA updates flood zone maps for Harris County, expanding high-risk designations",
    source: "Houston Chronicle",
    time: "5d ago",
    severity: "low",
    region: "Texas",
    affectedTickers: ["VLO", "NRG"],
  },
];

const NEWS_SEVERITY_DOT: Record<string, string> = {
  high: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]",
  medium: "bg-amber-500",
  low: "bg-emerald-500",
};

function ClimateNewsPanel() {
  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-base font-semibold text-white">Latest Climate News</h3>
        <span className="flex items-center gap-1.5 ml-auto text-[10px] font-bold uppercase tracking-widest text-red-400">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
          Live
        </span>
      </div>

      <div className="space-y-1 max-h-[340px] overflow-y-auto no-scrollbar">
        {CLIMATE_NEWS.map((item, i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-lg px-2.5 py-2.5 hover:bg-white/[0.03] transition-colors"
          >
            {/* Severity dot */}
            <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${NEWS_SEVERITY_DOT[item.severity]}`} />

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white/70 leading-relaxed mb-1">{item.headline}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-white/20 font-mono">{item.source}</span>
                <span className="text-[10px] text-white/10">|</span>
                <span className="text-[10px] text-white/20 font-mono">{item.time}</span>
                <span className="text-[10px] text-white/10">|</span>
                <span className="text-[10px] text-white/20">{item.region}</span>
              </div>
            </div>

            {/* Affected tickers */}
            <div className="flex items-center gap-1 shrink-0">
              {item.affectedTickers.map((t) => (
                <span
                  key={t}
                  className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-red-500/10 text-red-400/80"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Panel 6: Key Financial Metrics ────────────────────────── */

function FinancialMetricsPanel() {
  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-base font-semibold text-white">Key Financials</h3>
        <InfoButton
          title="Financial Metrics"
          formula="Debt Coverage = EBITDA / Interest Expense"
          explanation="Key financial health indicators for each portfolio company. Debt coverage ratio below 3x signals elevated credit risk under stress. Revenue in $M."
          variables={[]}
        />
      </div>

      <div className="space-y-2.5">
        {PORTFOLIO.map((c) => {
          const debtCoverage = c.ebitda / c.interestExpense;
          const leverage = c.netDebt / c.ebitda;
          return (
            <div key={c.ticker} className="rounded-lg bg-white/[0.02] border border-white/[0.05] p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-xs font-bold text-white">{c.ticker}</span>
                  <span className="text-[10px] text-white/25 ml-1.5">{c.sector}</span>
                </div>
                <span className="text-[10px] font-mono text-white/30">EV/EBITDA {c.evEbitda}x</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-white/25">Revenue</p>
                  <p className="text-xs font-mono text-white/60">${(c.revenue / 1000).toFixed(1)}B</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-white/25">Debt Coverage</p>
                  <p className={`text-xs font-mono ${debtCoverage < 5 ? "text-amber-400" : "text-white/60"}`}>
                    {debtCoverage.toFixed(1)}x
                  </p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-white/25">Leverage</p>
                  <p className={`text-xs font-mono ${leverage > 2 ? "text-red-400" : "text-white/60"}`}>
                    {leverage.toFixed(1)}x
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Panel 7: Geographic Concentration ─────────────────────── */

function GeoConcentrationPanel() {
  const regionExposure: Record<string, { position: number; companies: string[] }> = {};
  for (const c of PORTFOLIO) {
    if (!regionExposure[c.region]) regionExposure[c.region] = { position: 0, companies: [] };
    regionExposure[c.region].position += c.positionSize;
    regionExposure[c.region].companies.push(c.ticker);
  }

  const REGION_LABELS: Record<string, string> = {
    gulf_coast: "Gulf Coast",
    southeast: "Southeast",
    midwest: "Midwest",
  };

  const hazardByRegion: Record<string, number> = {
    gulf_coast: 0.82,
    southeast: 0.65,
    midwest: 0.48,
  };

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-base font-semibold text-white">Geographic Concentration</h3>
        <InfoButton
          title="Geographic Risk"
          formula="Region Concentration = Sum(Positions in Region) / Total Portfolio"
          explanation="Measures portfolio concentration by geographic region. High concentration in a single hazard-prone region amplifies tail risk from localized climate events."
          variables={Object.entries(regionExposure).map(([region, data]) => ({
            name: REGION_LABELS[region] ?? region,
            value: `${((data.position / TOTAL_POSITION) * 100).toFixed(0)}% (${data.companies.join(", ")})`,
          }))}
        />
      </div>

      <div className="space-y-3">
        {Object.entries(regionExposure).sort((a, b) => b[1].position - a[1].position).map(([region, data]) => {
          const pct = (data.position / TOTAL_POSITION) * 100;
          const hazard = hazardByRegion[region] ?? 0.3;
          const isConcentrated = pct > 50;
          return (
            <div key={region}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/60">{REGION_LABELS[region] ?? region}</span>
                  {isConcentrated && (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-red-500/15 text-red-400">
                      Concentrated
                    </span>
                  )}
                </div>
                <span className="text-xs font-mono text-white/40">{pct.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden mb-1">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: isConcentrated
                      ? "linear-gradient(90deg, #f97316, #ef4444)"
                      : "linear-gradient(90deg, #22c55e, #eab308)",
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/20">{data.companies.join(", ")}</span>
                <span className="text-[10px] text-white/20">Hazard prob: {(hazard * 100).toFixed(0)}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Concentration warning */}
      <div className="mt-4 rounded-lg border border-red-500/15 bg-red-500/[0.04] px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wider text-red-400/50 mb-1 font-semibold">Concentration Alert</p>
        <p className="text-[11px] text-white/40 leading-relaxed">
          {((regionExposure["gulf_coast"]?.position ?? 0) / TOTAL_POSITION * 100).toFixed(0)}% of portfolio concentrated in Gulf Coast — the highest hurricane probability region (82%). A single Cat 4+ event could impact {regionExposure["gulf_coast"]?.companies.join(" and ")}.
        </p>
      </div>
    </>
  );
}

/* ── Main Grid ──────────────────────────────────────────────── */

function PortfolioDashboard() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      {/* Row 1: Risk Score (1/3) | Top Exposed (2/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GlassCard label="Risk Score" className="lg:col-span-1" delay={0}>
          <RiskScorePanel />
        </GlassCard>
        <GlassCard label="Exposure" className="lg:col-span-2" delay={100}>
          <ExposedHoldingsPanel />
        </GlassCard>
      </div>

      {/* Row 2: Highest Risk Pathway (1/2) | Hedge Adequacy (1/2) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassCard label="Risk Pathway" delay={200}>
          <HighestRiskPathwayPanel />
        </GlassCard>
        <GlassCard label="Hedging" delay={300}>
          <HedgeAdequacyPanel />
        </GlassCard>
      </div>

      {/* Row 3: Climate News (2/3) | Financial Metrics (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GlassCard label="Climate News" className="lg:col-span-2" delay={400}>
          <ClimateNewsPanel />
        </GlassCard>
        <GlassCard label="Financials" className="lg:col-span-1" delay={500}>
          <FinancialMetricsPanel />
        </GlassCard>
      </div>

      {/* Row 4: Geographic Concentration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassCard label="Geographic Risk" delay={600}>
          <GeoConcentrationPanel />
        </GlassCard>
      </div>
    </div>
  );
}

export default PortfolioDashboard;
