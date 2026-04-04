import { useEffect, useState } from "react";

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
      className={`rounded-xl border border-white/[0.08] bg-black/40 backdrop-blur-md p-5
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

/* ── Panel 1: Climate Risk Score ────────────────────────────── */

function RiskScorePanel() {
  const [gaugeWidth, setGaugeWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setGaugeWidth(67), 400);
    return () => clearTimeout(t);
  }, []);

  const secondaryMetrics = [
    { label: "Physical Risk VaR", value: "$14.2M", sub: "Hurricane, flood, wildfire" },
    { label: "Transition Risk VaR", value: "$6.8M", sub: "Carbon regulation, stranded assets" },
    { label: "Contagion Risk VaR", value: "$2.4M", sub: "Indirect supply chain" },
  ];

  return (
    <>
      <div className="mb-1">
        <div className="flex items-baseline gap-3 mb-1">
          <span className="text-4xl md:text-5xl font-bold text-white tracking-tight">
            CVaR-95: $23.4M
          </span>
          <span className="flex items-center gap-1 text-xs font-medium text-red-400">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M5 1L9 7H1L5 1Z" />
            </svg>
            +$2.1M vs last week
          </span>
        </div>
        <p className="text-xs text-white/35 leading-relaxed max-w-lg">
          5% probability of losing $23.4M or more in a single quarter under current climate trajectory
        </p>
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-3 gap-3 my-5">
        {secondaryMetrics.map((m) => (
          <div key={m.label} className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
            <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">{m.label}</p>
            <p className="text-lg font-bold text-white">{m.value}</p>
            <p className="text-[10px] text-white/25 mt-0.5">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Risk gauge */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-white/30">Portfolio Risk Level</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Moderate-High</span>
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

interface Holding {
  rank: number;
  ticker: string;
  name: string;
  position: "LONG" | "SHORT";
  riskScore: number;
  physical: number;
  transition: number;
  exposure: string;
}

const HOLDINGS: Holding[] = [
  { rank: 1, ticker: "CVX", name: "Chevron Corp", position: "LONG", riskScore: 87, physical: 71, transition: 94, exposure: "$8.2M" },
  { rank: 2, ticker: "SPG", name: "Simon Property Group", position: "LONG", riskScore: 79, physical: 88, transition: 52, exposure: "$5.6M" },
  { rank: 3, ticker: "NEE", name: "NextEra Energy", position: "LONG", riskScore: 71, physical: 65, transition: 79, exposure: "$4.1M" },
  { rank: 4, ticker: "XOM", name: "ExxonMobil", position: "SHORT", riskScore: 68, physical: 59, transition: 91, exposure: "-$3.8M" },
  { rank: 5, ticker: "AMT", name: "American Tower", position: "LONG", riskScore: 54, physical: 61, transition: 43, exposure: "$2.9M" },
];

function ExposedHoldingsPanel() {
  return (
    <>
      <h3 className="text-base font-semibold text-white mb-4">Top 5 Most Exposed Holdings</h3>

      {/* Header row */}
      <div className="grid grid-cols-[24px_1fr_60px_minmax(80px,1fr)_60px_60px_80px] gap-x-2 items-center
                      text-[9px] uppercase tracking-wider text-white/25 mb-2 px-1">
        <span>#</span>
        <span>Holding</span>
        <span>Type</span>
        <span>Risk Score</span>
        <span className="text-center">Phys</span>
        <span className="text-center">Trans</span>
        <span className="text-right">Exposure</span>
      </div>

      <div className="space-y-1">
        {HOLDINGS.map((h) => (
          <div
            key={h.ticker}
            className="grid grid-cols-[24px_1fr_60px_minmax(80px,1fr)_60px_60px_80px] gap-x-2 items-center
                       rounded-lg px-1 py-2.5 hover:bg-white/[0.04] transition-colors group cursor-pointer"
          >
            <span className="text-xs text-white/20 font-mono">{h.rank}</span>

            <div className="min-w-0">
              <span className="text-sm font-semibold text-white">{h.ticker}</span>
              <span className="text-xs text-white/30 ml-1.5 hidden lg:inline">{h.name}</span>
            </div>

            <span
              className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded text-center
                ${h.position === "LONG"
                  ? "bg-amber-500/15 text-amber-400"
                  : "bg-blue-500/15 text-blue-400"}`}
            >
              {h.position}
            </span>

            {/* Risk bar */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${h.riskScore}%`,
                    background: h.riskScore > 75
                      ? "linear-gradient(90deg, #f97316, #ef4444)"
                      : h.riskScore > 60
                        ? "linear-gradient(90deg, #eab308, #f97316)"
                        : "linear-gradient(90deg, #22c55e, #eab308)",
                  }}
                />
              </div>
              <span className="text-[11px] font-mono text-white/50 w-7 text-right">{h.riskScore}</span>
            </div>

            <span className="text-[11px] font-mono text-center text-orange-400/70">{h.physical}</span>
            <span className="text-[11px] font-mono text-center text-purple-400/70">{h.transition}</span>

            <span className={`text-xs font-mono text-right font-medium
              ${h.exposure.startsWith("-") ? "text-blue-400" : "text-red-400"}`}>
              {h.exposure}
            </span>
          </div>
        ))}
      </div>

      <div className="flex justify-end mt-3">
        <button className="text-[11px] text-white/30 hover:text-white/60 transition-colors cursor-pointer">
          View Full Portfolio &rarr;
        </button>
      </div>
    </>
  );
}

/* ── Panel 3: Active Contagion Pathways ─────────────────────── */

interface ContagionNode {
  id: string;
  x: number;
  y: number;
  size: number;
  hit?: boolean;
}

interface ContagionEdge {
  from: string;
  to: string;
  severity: "high" | "medium";
}

const C_NODES: ContagionNode[] = [
  { id: "CVX", x: 60, y: 90, size: 22, hit: true },
  { id: "VAL", x: 170, y: 40, size: 16 },
  { id: "LYB", x: 180, y: 140, size: 16 },
  { id: "DOW", x: 300, y: 120, size: 14 },
  { id: "PKG", x: 400, y: 90, size: 12 },
];

const C_EDGES: ContagionEdge[] = [
  { from: "CVX", to: "VAL", severity: "high" },
  { from: "CVX", to: "LYB", severity: "high" },
  { from: "LYB", to: "DOW", severity: "medium" },
  { from: "DOW", to: "PKG", severity: "medium" },
];

function ContagionPanel() {
  const nodeMap = Object.fromEntries(C_NODES.map((n) => [n.id, n]));

  const alerts = [
    "Gulf Coast hurricane season elevates CVX → VAL pathway to HIGH risk",
    "Carbon tax proposal increases CVX → LYB → DOW transition contagion",
    "PKG shows indirect exposure through 3-hop supply chain dependency",
  ];

  return (
    <>
      <h3 className="text-base font-semibold text-white mb-3">Active Contagion Pathways</h3>

      <svg viewBox="0 0 460 180" className="w-full h-auto mb-4">
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
        {C_EDGES.map((e) => {
          const from = nodeMap[e.from];
          const to = nodeMap[e.to];
          const color = e.severity === "high" ? "#ef4444" : "#f59e0b";
          return (
            <line
              key={`${e.from}-${e.to}`}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke={color}
              strokeWidth={e.severity === "high" ? 2 : 1.5}
              strokeDasharray="6 4"
              opacity={0.6}
              filter={e.severity === "high" ? "url(#glow-red)" : "url(#glow-amber)"}
            >
              <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="1.5s" repeatCount="indefinite" />
            </line>
          );
        })}

        {/* Nodes */}
        {C_NODES.map((n) => (
          <g key={n.id}>
            {n.hit && (
              <circle cx={n.x} cy={n.y} r={n.size + 8} fill="none" stroke="#ef4444" strokeWidth={1} opacity={0.3}>
                <animate attributeName="r" values={`${n.size + 5};${n.size + 12};${n.size + 5}`} dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
            <circle
              cx={n.x} cy={n.y} r={n.size}
              fill={n.hit ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.05)"}
              stroke={n.hit ? "#ef4444" : "rgba(255,255,255,0.15)"}
              strokeWidth={1.5}
            />
            <text
              x={n.x} y={n.y + 1}
              textAnchor="middle" dominantBaseline="middle"
              className="text-[11px] font-bold fill-white"
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
  const [fill, setFill] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setFill(38), 500);
    return () => clearTimeout(t);
  }, []);

  const RADIUS = 70;
  const STROKE = 10;
  const CENTER_X = 100;
  const CENTER_Y = 85;
  const circumference = Math.PI * RADIUS;
  const offset = circumference - (fill / 100) * circumference;

  const rows = [
    { label: "Total Climate Tail Risk", value: "$23.4M", color: "text-white" },
    { label: "Currently Hedged", value: "$8.9M", color: "text-blue-400", sub: "via XOM, HES short positions" },
    { label: "Unhedged Exposure", value: "$14.5M", color: "text-red-400" },
  ];

  return (
    <>
      <h3 className="text-base font-semibold text-white mb-4">Hedge Adequacy</h3>

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
            Underhedged
          </text>
        </svg>
      </div>

      <div className="space-y-2.5 mb-4">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <div>
              <span className="text-xs text-white/40">{r.label}</span>
              {r.sub && <span className="text-[10px] text-white/20 block">{r.sub}</span>}
            </div>
            <span className={`text-sm font-bold font-mono ${r.color}`}>{r.value}</span>
          </div>
        ))}
      </div>

      {/* AI recommendation */}
      <div className="rounded-lg border-l-2 border-amber-500/60 bg-amber-500/[0.05] px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wider text-amber-400/60 mb-1 font-semibold">AI Recommendation</p>
        <p className="text-[11px] text-white/50 leading-relaxed">
          Adding short positions in HES and MPC would increase hedge coverage to ~61% and reduce unhedged exposure by $5.4M
        </p>
      </div>
    </>
  );
}

/* ── Panel 5: Event Monitor ─────────────────────────────────── */

interface ClimateEvent {
  icon: string;
  name: string;
  location: string;
  time: string;
  severity: "high" | "medium" | "low";
  hit: boolean;
  tickers?: string[];
}

const EVENTS: ClimateEvent[] = [
  { icon: "\u{1F300}", name: "Tropical Storm Vera", location: "Gulf of Mexico", time: "2 hours ago", severity: "high", hit: true, tickers: ["CVX", "VAL"] },
  { icon: "\u{1F525}", name: "Caldor Complex Wildfire", location: "Northern California", time: "6 hours ago", severity: "high", hit: true, tickers: ["AMT"] },
  { icon: "\u{1F30A}", name: "Flash Flood Warning", location: "Harris County TX", time: "1 day ago", severity: "medium", hit: false },
  { icon: "\u2600\uFE0F", name: "Exceptional Drought", location: "West Texas", time: "2 days ago", severity: "medium", hit: true, tickers: ["CVX"] },
  { icon: "\u{1F300}", name: "Hurricane Watch", location: "Caribbean Basin", time: "3 days ago", severity: "low", hit: false },
  { icon: "\u{1F525}", name: "Park Fire", location: "Butte County CA", time: "4 days ago", severity: "low", hit: false },
];

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]",
  medium: "bg-amber-500",
  low: "bg-emerald-500",
};

function EventMonitorPanel() {
  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-base font-semibold text-white">Event Monitor</h3>
        <span className="flex items-center gap-1.5 ml-auto text-[10px] font-bold uppercase tracking-widest text-red-400">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
          Live
        </span>
      </div>

      <div className="space-y-1 max-h-[320px] overflow-y-auto no-scrollbar">
        {EVENTS.map((e, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 hover:bg-white/[0.03] transition-colors"
          >
            {/* Severity dot */}
            <span className={`w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT[e.severity]}`} />

            {/* Icon */}
            <span className="text-base shrink-0">{e.icon}</span>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs font-semibold text-white truncate">{e.name}</span>
                <span className="text-[10px] text-white/20">{e.location}</span>
              </div>
              <span className="text-[10px] text-white/20 font-mono">{e.time}</span>
            </div>

            {/* Status */}
            {e.hit ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-red-500/15 text-red-400">
                  Portfolio Hit
                </span>
                <span className="text-[10px] text-white/30 font-mono">
                  {e.tickers?.join(", ")}
                </span>
              </div>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-white/[0.04] text-white/20 shrink-0">
                Monitoring
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Panel 6: Scenario Library ──────────────────────────────── */

interface Scenario {
  name: string;
  runDate: string;
  impact: string;
  status: "REVIEWED" | "SHARED" | "DRAFT";
}

const SCENARIOS: Scenario[] = [
  { name: "Gulf Coast Cat 4 Hurricane", runDate: "Run 2 days ago", impact: "-$15.3M", status: "REVIEWED" },
  { name: "Carbon Tax $150/ton by 2030", runDate: "Run 5 days ago", impact: "-$22.7M", status: "SHARED" },
  { name: "California Megadrought 2025", runDate: "Run 1 week ago", impact: "-$8.1M", status: "DRAFT" },
  { name: "Combined Physical + Transition Shock", runDate: "Run 2 weeks ago", impact: "-$31.4M", status: "REVIEWED" },
];

const STATUS_STYLE: Record<string, string> = {
  REVIEWED: "bg-blue-500/15 text-blue-400",
  SHARED: "bg-emerald-500/15 text-emerald-400",
  DRAFT: "bg-amber-500/15 text-amber-400",
};

function ScenarioLibraryPanel() {
  return (
    <>
      <h3 className="text-base font-semibold text-white mb-3">Saved Scenarios</h3>

      <div className="space-y-2">
        {SCENARIOS.map((s) => (
          <div
            key={s.name}
            className="group rounded-lg border border-white/[0.05] bg-white/[0.02] p-3
                       hover:bg-white/[0.05] hover:border-white/[0.1] transition-all cursor-pointer"
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <span className="text-xs font-semibold text-white leading-snug">{s.name}</span>
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${STATUS_STYLE[s.status]}`}>
                {s.status}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/25">{s.runDate}</span>
              <span className="text-xs font-mono font-bold text-red-400">{s.impact}</span>
            </div>
            {/* Hover actions */}
            <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button className="text-[10px] text-white/30 hover:text-white/60 transition-colors cursor-pointer">
                Re-run
              </button>
              <button className="text-[10px] text-white/30 hover:text-white/60 transition-colors cursor-pointer">
                Share
              </button>
            </div>
          </div>
        ))}
      </div>

      <button className="w-full mt-3 py-2 rounded-lg border border-dashed border-white/[0.08]
                         text-[11px] text-white/25 hover:text-white/50 hover:border-white/[0.15]
                         transition-all cursor-pointer">
        + New Scenario
      </button>
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

      {/* Row 2: Contagion (1/2) | Hedge Adequacy (1/2) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassCard label="Network" delay={200}>
          <ContagionPanel />
        </GlassCard>
        <GlassCard label="Hedging" delay={300}>
          <HedgeAdequacyPanel />
        </GlassCard>
      </div>

      {/* Row 3: Event Monitor (2/3) | Scenario Library (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GlassCard label="Events" className="lg:col-span-2" delay={400}>
          <EventMonitorPanel />
        </GlassCard>
        <GlassCard label="Scenarios" className="lg:col-span-1" delay={500}>
          <ScenarioLibraryPanel />
        </GlassCard>
      </div>
    </div>
  );
}

export default PortfolioDashboard;
