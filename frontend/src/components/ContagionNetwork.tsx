import { useEffect, useState, useCallback, useRef } from "react";

/* ── Types ──────────────────────────────────────────────────── */

interface NetworkNode {
  id: string;
  name: string;
  x: number;
  y: number;
  size: number;
  color: string;
  hop: number;
  position: "LONG" | "SHORT";
  baseScore: number;
  baseImpact: number;
}

interface NetworkEdge {
  from: string;
  to: string;
  label: string;
  severity: "high" | "medium" | "low";
}

interface EventOption {
  id: string;
  icon: string;
  label: string;
}

/* ── Data ───────────────────────────────────────────────────── */

const NODES: NetworkNode[] = [
  { id: "CVX", name: "Chevron Corp", x: 0.35, y: 0.45, size: 28, color: "#ef4444", hop: 0, position: "LONG", baseScore: 100, baseImpact: 0 },
  { id: "VAL", name: "Valaris Ltd", x: 0.18, y: 0.30, size: 20, color: "#f97316", hop: 1, position: "LONG", baseScore: 82, baseImpact: 3.1 },
  { id: "HAL", name: "Halliburton Co", x: 0.20, y: 0.62, size: 20, color: "#f97316", hop: 1, position: "LONG", baseScore: 76, baseImpact: 2.8 },
  { id: "LYB", name: "LyondellBasell", x: 0.55, y: 0.25, size: 20, color: "#eab308", hop: 2, position: "LONG", baseScore: 58, baseImpact: 1.9 },
  { id: "DOW", name: "Dow Inc", x: 0.58, y: 0.60, size: 20, color: "#eab308", hop: 2, position: "LONG", baseScore: 51, baseImpact: 1.6 },
  { id: "PKG", name: "Packaging Corp", x: 0.75, y: 0.20, size: 14, color: "#84cc16", hop: 3, position: "LONG", baseScore: 29, baseImpact: 0.7 },
  { id: "PG", name: "Procter & Gamble", x: 0.78, y: 0.50, size: 14, color: "#84cc16", hop: 3, position: "LONG", baseScore: 24, baseImpact: 0.5 },
  { id: "MCD", name: "McDonald's Corp", x: 0.74, y: 0.75, size: 14, color: "#84cc16", hop: 3, position: "LONG", baseScore: 18, baseImpact: 0.3 },
  { id: "XOM", name: "ExxonMobil Corp", x: 0.15, y: 0.80, size: 20, color: "#3b82f6", hop: -1, position: "SHORT", baseScore: 0, baseImpact: 0 },
  { id: "NEE", name: "NextEra Energy", x: 0.88, y: 0.40, size: 20, color: "#6b7280", hop: -2, position: "LONG", baseScore: 0, baseImpact: 0 },
];

const EDGES: NetworkEdge[] = [
  { from: "CVX", to: "VAL", label: "Offshore drilling contracts", severity: "high" },
  { from: "CVX", to: "HAL", label: "Oilfield services", severity: "high" },
  { from: "CVX", to: "LYB", label: "Petrochemical feedstock", severity: "high" },
  { from: "LYB", to: "DOW", label: "Chemical processing", severity: "medium" },
  { from: "DOW", to: "PKG", label: "Polymer inputs", severity: "low" },
  { from: "DOW", to: "PG", label: "Chemical inputs", severity: "low" },
  { from: "PKG", to: "MCD", label: "Packaging materials", severity: "low" },
];

const EVENTS: EventOption[] = [
  { id: "hurricane", icon: "\u{1F300}", label: "Gulf Coast Hurricane" },
  { id: "wildfire", icon: "\u{1F525}", label: "California Wildfire" },
  { id: "flood", icon: "\u{1F30A}", label: "Mississippi Flood" },
  { id: "drought", icon: "\u2600\uFE0F", label: "Texas Drought" },
  { id: "carbon", icon: "\u26A1", label: "Carbon Tax Shock" },
  { id: "heat", icon: "\u{1F321}\uFE0F", label: "Heatwave Event" },
];

const LOG_ENTRIES = [
  { time: "T+0:00", text: "EVENT INITIATED — Category 4 Hurricane landfall Gulf Coast", color: "text-white" },
  { time: "T+0:03", text: "CVX — Offshore platform operations suspended — 3 of 7 GOM facilities offline", color: "text-red-400" },
  { time: "T+0:07", text: "CVX → VAL — Drilling contract suspension triggered — feedstock flow disrupted", color: "text-orange-400" },
  { time: "T+0:11", text: "CVX → HAL — Oilfield services halted — revenue impact propagating", color: "text-orange-400" },
  { time: "T+0:18", text: "CVX → LYB — Petrochemical feedstock supply cut 60% — production ramp-down initiated", color: "text-yellow-400" },
  { time: "T+0:24", text: "LYB → DOW — Polymer input shortage detected — HOP 2 contagion confirmed", color: "text-yellow-400" },
  { time: "T+0:31", text: "DOW → PKG — Packaging material cost spike +34% — margin compression flagged", color: "text-lime-400" },
  { time: "T+0:35", text: "DOW → PG — Chemical input disruption — consumer goods supply chain stressed", color: "text-lime-400" },
  { time: "T+0:42", text: "PKG → MCD — Packaging supply constraint — HOP 3 boundary reached", color: "text-lime-400" },
  { time: "T+0:47", text: "SIMULATION COMPLETE — 7 holdings affected across 3 hops — Total indirect impact: -$10.9M", color: "text-white" },
];

const SEVERITY_LABELS = ["Mild", "Moderate", "Severe", "Extreme", "Catastrophic"];

const HOP_BADGE: Record<number, { text: string; cls: string }> = {
  1: { text: "HOP 1", cls: "bg-orange-500/15 text-orange-400" },
  2: { text: "HOP 2", cls: "bg-yellow-500/15 text-yellow-400" },
  3: { text: "HOP 3", cls: "bg-lime-500/15 text-lime-400" },
};

const EDGE_STROKE: Record<string, number> = { high: 2.5, medium: 1.8, low: 1.2 };

/* ── Glass Card ─────────────────────────────────────────────── */

interface GlassProps {
  children: React.ReactNode;
  className?: string;
  label: string;
  delay?: number;
}

function Glass({ children, className = "", label, delay = 0 }: GlassProps) {
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVis(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <div className={`rounded-xl border border-white/[0.08] bg-black/40 backdrop-blur-md p-5
                     transition-all duration-500 ${vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}
                     ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30 mb-2 block">{label}</span>
      {children}
    </div>
  );
}

/* ── Network Graph (SVG) ────────────────────────────────────── */

interface GraphProps {
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
}

function NetworkGraph({ selectedNode, onSelectNode }: GraphProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node?: NetworkNode; edge?: NetworkEdge } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 720;
  const H = 460;

  const nodeMap = Object.fromEntries(NODES.map((n) => [n.id, n]));

  const connectedTo = useCallback(
    (id: string) => {
      const ids = new Set<string>();
      ids.add(id);
      for (const e of EDGES) {
        if (e.from === id) ids.add(e.to);
        if (e.to === id) ids.add(e.from);
      }
      return ids;
    },
    [],
  );

  const isHighlighted = (id: string) => !selectedNode || connectedTo(selectedNode).has(id);
  const isEdgeHighlighted = (e: NetworkEdge) => !selectedNode || selectedNode === e.from || selectedNode === e.to;

  const handleBg = () => onSelectNode(null);

  const handleNodeHover = (n: NetworkNode, evt: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setTooltip({ x: evt.clientX - rect.left, y: evt.clientY - rect.top - 10, node: n });
  };

  const handleEdgeHover = (e: NetworkEdge, evt: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setTooltip({ x: evt.clientX - rect.left, y: evt.clientY - rect.top - 10, edge: e });
  };

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" onClick={handleBg}>
        <defs>
          <filter id="c-glow-red">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Animated dot markers */}
          {EDGES.map((e, i) => {
            const from = nodeMap[e.from];
            const to = nodeMap[e.to];
            return (
              <path
                key={`path-${i}`}
                id={`epath-${i}`}
                d={`M${from.x * W},${from.y * H} L${to.x * W},${to.y * H}`}
                fill="none"
                stroke="none"
              />
            );
          })}
        </defs>

        {/* Edges */}
        {EDGES.map((e, i) => {
          const from = nodeMap[e.from];
          const to = nodeMap[e.to];
          const dimmed = !isEdgeHighlighted(e);
          return (
            <g key={`edge-${i}`} opacity={dimmed ? 0.15 : 1} className="transition-opacity duration-300">
              <line
                x1={from.x * W} y1={from.y * H}
                x2={to.x * W} y2={to.y * H}
                stroke={from.color}
                strokeWidth={EDGE_STROKE[e.severity]}
                strokeDasharray="8 5"
                opacity={0.5}
              >
                <animate attributeName="stroke-dashoffset" from="0" to="-26" dur="1.2s" repeatCount="indefinite" />
              </line>

              {/* Traveling glow dot */}
              <circle r="3.5" fill={from.color} opacity={0.9}>
                <animateMotion dur="2.5s" repeatCount="indefinite">
                  <mpath href={`#epath-${i}`} />
                </animateMotion>
              </circle>
              <circle r="7" fill={from.color} opacity={0.2}>
                <animateMotion dur="2.5s" repeatCount="indefinite">
                  <mpath href={`#epath-${i}`} />
                </animateMotion>
              </circle>

              {/* Invisible wide hit area for hover */}
              <line
                x1={from.x * W} y1={from.y * H}
                x2={to.x * W} y2={to.y * H}
                stroke="transparent"
                strokeWidth={14}
                className="cursor-pointer"
                onMouseEnter={(ev) => handleEdgeHover(e, ev)}
                onMouseLeave={() => setTooltip(null)}
              />
            </g>
          );
        })}

        {/* Nodes */}
        {NODES.map((n) => {
          const cx = n.x * W;
          const cy = n.y * H;
          const dimmed = !isHighlighted(n.id);
          const isDirectHit = n.hop === 0;

          return (
            <g
              key={n.id}
              opacity={dimmed ? 0.2 : 1}
              className="transition-opacity duration-300 cursor-pointer"
              onClick={(ev) => { ev.stopPropagation(); onSelectNode(selectedNode === n.id ? null : n.id); }}
              onMouseEnter={(ev) => handleNodeHover(n, ev)}
              onMouseLeave={() => setTooltip(null)}
            >
              {/* Pulse ring for direct hit */}
              {isDirectHit && (
                <>
                  <circle cx={cx} cy={cy} r={n.size + 12} fill="none" stroke="#ef4444" strokeWidth={1.5} opacity={0.3}>
                    <animate attributeName="r" values={`${n.size + 8};${n.size + 18};${n.size + 8}`} dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.35;0.08;0.35" dur="2s" repeatCount="indefinite" />
                  </circle>
                  <circle cx={cx} cy={cy} r={n.size + 4} fill="none" stroke="#ef4444" strokeWidth={1} opacity={0.15}>
                    <animate attributeName="r" values={`${n.size + 3};${n.size + 9};${n.size + 3}`} dur="1.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.2;0.05;0.2" dur="1.5s" repeatCount="indefinite" />
                  </circle>
                </>
              )}

              {/* Glow */}
              <circle cx={cx} cy={cy} r={n.size + 2} fill={n.color} opacity={0.12}
                      filter={isDirectHit ? "url(#c-glow-red)" : undefined} />

              {/* Body */}
              <circle cx={cx} cy={cy} r={n.size} fill="rgba(0,0,0,0.5)" stroke={n.color}
                      strokeWidth={selectedNode === n.id ? 2.5 : 1.5} />

              {/* Label */}
              <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
                    className="text-[11px] font-bold fill-white select-none pointer-events-none">
                {n.id}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-50 pointer-events-none rounded-lg bg-black/70 backdrop-blur-xl
                     border border-white/[0.1] px-3 py-2 text-[11px] max-w-[200px]"
          style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-50%, -100%)" }}
        >
          {tooltip.node && (
            <>
              <p className="font-bold text-white">{tooltip.node.id} — {tooltip.node.name}</p>
              <p className="text-white/40">
                {tooltip.node.position === "SHORT" ? "SHORT position" : "LONG position"}
                {tooltip.node.hop >= 0 && ` · Hop ${tooltip.node.hop}`}
                {tooltip.node.hop === 0 && " (Direct Hit)"}
                {tooltip.node.hop === -1 && " · Isolated"}
                {tooltip.node.hop === -2 && " · Unaffected"}
              </p>
              {tooltip.node.hop > 0 && (
                <p className="text-white/40">Contagion Score: {tooltip.node.baseScore}/100</p>
              )}
            </>
          )}
          {tooltip.edge && (
            <p className="text-white/60">{tooltip.edge.label}</p>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 px-1">
        {[
          { color: "#ef4444", label: "Directly Hit" },
          { color: "#f97316", label: "Hop 1" },
          { color: "#eab308", label: "Hop 2" },
          { color: "#84cc16", label: "Hop 3" },
          { color: "#3b82f6", label: "Short Position" },
          { color: "#6b7280", label: "Unaffected" },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: l.color }} />
            <span className="text-[10px] text-white/30">{l.label}</span>
          </div>
        ))}
        <span className="text-[10px] text-white/15 ml-auto hidden lg:inline">
          Node size = position size · Edge width = dependency strength
        </span>
      </div>
    </div>
  );
}

/* ── Event Trigger Selector ─────────────────────────────────── */

interface TriggerProps {
  activeEvent: string;
  severity: number;
  onEventChange: (id: string) => void;
  onSeverityChange: (v: number) => void;
}

function EventTrigger({ activeEvent, severity, onEventChange, onSeverityChange }: TriggerProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {EVENTS.map((e) => {
          const active = activeEvent === e.id;
          return (
            <button
              key={e.id}
              onClick={() => onEventChange(e.id)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-[11px]
                         transition-all duration-200 cursor-pointer
                ${active
                  ? "border-amber-500/40 bg-amber-500/[0.08] text-white shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                  : "border-white/[0.06] bg-white/[0.02] text-white/40 hover:bg-white/[0.05] hover:text-white/60"
                }`}
            >
              <span className="text-base">{e.icon}</span>
              <span className="font-medium leading-tight">{e.label}</span>
            </button>
          );
        })}
      </div>

      {/* Severity slider */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider text-white/30">Event Severity</span>
          <span className="text-xs font-bold text-amber-400">{severity} — {SEVERITY_LABELS[severity - 1]}</span>
        </div>
        <input
          type="range"
          min={1}
          max={5}
          value={severity}
          onChange={(e) => onSeverityChange(Number(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                     bg-gradient-to-r from-emerald-500/30 via-amber-500/30 to-red-500/30
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                     [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(245,158,11,0.5)]
                     [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-amber-300"
        />
        <div className="flex justify-between mt-1">
          {SEVERITY_LABELS.map((l) => (
            <span key={l} className="text-[8px] text-white/15">{l}</span>
          ))}
        </div>
      </div>

      <button className="w-full py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.08]
                         text-xs font-semibold text-white hover:bg-amber-500/[0.15]
                         hover:border-amber-500/50 transition-all cursor-pointer mb-2">
        Run Simulation
      </button>
      <button className="w-full py-1.5 text-[11px] text-white/25 hover:text-white/50 transition-colors cursor-pointer">
        Reset Network
      </button>
    </>
  );
}

/* ── Contagion Risk Scores ──────────────────────────────────── */

interface ScoresPanelProps {
  severity: number;
}

function ContagionScores({ severity }: ScoresPanelProps) {
  const mult = severity / 4;
  const affected = NODES.filter((n) => n.hop > 0).sort((a, b) => b.baseScore - a.baseScore);

  const totalImpact = affected.reduce((s, n) => s + n.baseImpact * mult, 0);

  return (
    <>
      <h3 className="text-sm font-semibold text-white mb-3">Risk Scores</h3>

      <div className="space-y-2.5">
        {affected.map((n) => {
          const score = Math.min(100, Math.round(n.baseScore * mult));
          const impact = (n.baseImpact * mult).toFixed(1);
          const badge = HOP_BADGE[n.hop];
          return (
            <div key={n.id}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold text-white w-8">{n.id}</span>
                <span className="text-[10px] text-white/25 flex-1 truncate">{n.name}</span>
                {badge && (
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${badge.cls}`}>{badge.text}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${score}%`,
                      background: n.hop === 1
                        ? "linear-gradient(90deg, #f97316, #ef4444)"
                        : n.hop === 2
                          ? "linear-gradient(90deg, #eab308, #f97316)"
                          : "linear-gradient(90deg, #84cc16, #eab308)",
                    }}
                  />
                </div>
                <span className="text-[11px] font-mono text-white/40 w-6 text-right">{score}</span>
                <span className="text-[10px] font-mono text-red-400 w-14 text-right">-${impact}M</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-white/[0.06]">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">Total Indirect Impact</span>
          <span className="text-lg font-bold font-mono text-red-400">-${totalImpact.toFixed(1)}M</span>
        </div>
        <p className="text-[10px] text-white/20 mt-1">
          XOM short position offsets +$3.8M of direct CVX exposure
        </p>
      </div>
    </>
  );
}

/* ── Propagation Log ────────────────────────────────────────── */

function PropagationLog() {
  const [visibleCount, setVisibleCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleCount((prev) => {
        if (prev >= LOG_ENTRIES.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleCount]);

  return (
    <>
      <h3 className="text-sm font-semibold text-white mb-3">Propagation Log</h3>

      <div ref={containerRef} className="max-h-[240px] overflow-y-auto no-scrollbar space-y-1.5">
        {LOG_ENTRIES.slice(0, visibleCount).map((entry, i) => (
          <div
            key={i}
            className="animate-in"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className="flex gap-2 font-mono text-[10px] leading-relaxed">
              <span className="text-white/20 shrink-0">[{entry.time}]</span>
              <span className={entry.color}>{entry.text}</span>
            </div>
          </div>
        ))}

        {/* Blinking cursor */}
        {visibleCount >= LOG_ENTRIES.length && (
          <span className="inline-block font-mono text-white/40 text-sm blink-cursor">{"\u258B"}</span>
        )}
      </div>
    </>
  );
}

/* ── Main Export ─────────────────────────────────────────────── */

function ContagionNetworkTab() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [activeEvent, setActiveEvent] = useState("hurricane");
  const [severity, setSeverity] = useState(4);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left — Graph (3/5 = 60%) */}
        <Glass label="Network" className="lg:col-span-3" delay={0}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h3 className="text-base font-semibold text-white">Contagion Network</h3>
              <p className="text-[11px] text-white/30">Live propagation map — Gulf Coast Hurricane scenario active</p>
            </div>
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-red-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              Simulating
            </span>
          </div>
          <NetworkGraph selectedNode={selectedNode} onSelectNode={setSelectedNode} />
        </Glass>

        {/* Right — Stacked panels (2/5 = 40%) */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Glass label="Trigger Event" delay={100}>
            <EventTrigger
              activeEvent={activeEvent}
              severity={severity}
              onEventChange={setActiveEvent}
              onSeverityChange={setSeverity}
            />
          </Glass>

          <Glass label="Contagion Risk Scores" delay={200}>
            <ContagionScores severity={severity} />
          </Glass>

          <Glass label="Propagation Log" delay={300}>
            <PropagationLog />
          </Glass>
        </div>
      </div>
    </div>
  );
}

export default ContagionNetworkTab;
