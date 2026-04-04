import { useRef, useEffect, useState, useCallback } from "react";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import usAtlas from "us-atlas/states-10m.json";
import type { ContagionNode, ContagionEdge, ContagionResponse, ContagionTimelineStep } from "@/lib/types";
import { useApi } from "@/hooks/useApi";

const SECTOR_COLORS: Record<string, string> = {
  Energy: "#ef4444", Financials: "#60a5fa", Technology: "#a78bfa",
  Utilities: "#fbbf24", "Real Estate": "#34d399", Healthcare: "#f472b6",
  Materials: "#fb923c", Industrials: "#818cf8",
  "Consumer Discretionary": "#2dd4bf", "Consumer Staples": "#a3e635",
};
const RISK_COLORS: Record<string, string> = {
  low: "#22c55e", medium: "#eab308", high: "#f97316", critical: "#ef4444",
};

const DECAY_FACTOR = 0.6;
const CONTAGION_THRESHOLD = 0.05;
const STEP_DELAY = 700;

const EVENT_TYPES = [
  { value: "hurricane", label: "Hurricane", icon: "\u{1F300}" },
  { value: "wildfire", label: "Wildfire", icon: "\u{1F525}" },
  { value: "drought", label: "Drought", icon: "\u2600\uFE0F" },
  { value: "flood", label: "Flood", icon: "\u{1F30A}" },
  { value: "compound", label: "Compound", icon: "\u26A1" },
];

const PRESETS = [
  { label: "Hurricane \u2014 Gulf Coast", tag: "CAT-5", epicenters: ["XOM", "CVX", "VLO"], event: "hurricane", severity: 5 },
  { label: "Wildfire \u2014 California", tag: "MEGA", epicenters: ["AAPL", "GOOGL", "ENPH"], event: "wildfire", severity: 4 },
  { label: "Drought \u2014 Midwest", tag: "SEV-4", epicenters: ["ADM", "TSN", "DE"], event: "drought", severity: 4 },
  { label: "Compound \u2014 Texas Grid", tag: "CAT-5", epicenters: ["XOM", "NEE", "TSLA"], event: "compound", severity: 5 },
];

/* ── Types ────────────────────────────────────────────────────── */

interface PropLogEntry {
  step: number;
  from: string;
  to: string;
  weight: number;
  impact: number;
}

interface PropagationResult {
  timeline: ContagionTimelineStep[];
  impacts: Map<string, number>;
  totalRisk: number;
  log: PropLogEntry[];
}

/* ── Client-side BFS propagation ─────────────────────────────── */

function clientPropagate(
  edges: ContagionEdge[],
  epicenters: string[],
  severity: number,
): PropagationResult {
  const adj = new Map<string, Array<{ neighbor: string; weight: number }>>();
  for (const e of edges) {
    const s = typeof e.source === "string" ? e.source : e.source.id;
    const t = typeof e.target === "string" ? e.target : e.target.id;
    if (!adj.has(s)) adj.set(s, []);
    if (!adj.has(t)) adj.set(t, []);
    adj.get(s)!.push({ neighbor: t, weight: e.weight });
    adj.get(t)!.push({ neighbor: s, weight: e.weight });
  }
  const sevMult = severity / 5;
  let queue = epicenters.map((t) => ({ ticker: t, impact: sevMult * 0.85, from: "ORIGIN" }));
  const visited = new Map<string, number>();
  const timeline: ContagionTimelineStep[] = [];
  const log: PropLogEntry[] = [];
  let step = 0;
  while (queue.length > 0) {
    const next: typeof queue = [];
    const stepNodes: Array<{ ticker: string; impact: number }> = [];
    for (const { ticker, impact, from } of queue) {
      if (visited.has(ticker)) continue;
      visited.set(ticker, impact);
      stepNodes.push({ ticker, impact: Math.round(impact * 1000) / 1000 });
      log.push({ step, from, to: ticker, weight: step === 0 ? 1.0 : impact, impact });
      for (const { neighbor, weight } of adj.get(ticker) ?? []) {
        const prop = impact * weight * DECAY_FACTOR;
        if (prop > CONTAGION_THRESHOLD && !visited.has(neighbor)) {
          next.push({ ticker: neighbor, impact: prop, from: ticker });
        }
      }
    }
    if (stepNodes.length) timeline.push({ step, nodes: stepNodes });
    queue = next;
    step++;
  }
  let totalRisk = 0;
  for (const [t, v] of visited) {
    if (!epicenters.includes(t)) totalRisk += v;
  }
  return { timeline, impacts: visited, totalRisk, log };
}

/** Estimated monetary loss: impact × market_cap × 5% (equity VaR from contagion) */
const LOSS_FACTOR = 0.05;
function estimateLoss(impact: number, marketCapM: number): number {
  return impact * marketCapM * LOSS_FACTOR;
}
function formatLoss(lossM: number): string {
  if (lossM >= 1000) return `$${(lossM / 1000).toFixed(1)}B`;
  return `$${lossM.toFixed(0)}M`;
}

/* ── Component ───────────────────────────────────────────────── */

export function ContagionNetwork() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [tooltip, setTooltip] = useState<{ node: ContagionNode; x: number; y: number } | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [totalRisk, setTotalRisk] = useState(0);
  const [networkData, setNetworkData] = useState<ContagionResponse | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [customEvent, setCustomEvent] = useState("hurricane");
  const [customSeverity, setCustomSeverity] = useState(4);
  const [impactMap, setImpactMap] = useState<Map<string, number>>(new Map());
  const [propLog, setPropLog] = useState<PropLogEntry[]>([]);
  const [visibleLogIdx, setVisibleLogIdx] = useState(0);

  const networkApi = useApi<ContagionResponse>();

  useEffect(() => {
    networkApi.get("/contagion/network").then((d) => { if (d) setNetworkData(d); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── D3 render ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!networkData || !svgRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const projection = d3.geoAlbersUsa().scale(1300).translate([width / 2, height / 2]);
    const pathGen = d3.geoPath(projection);

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    // ── Defs ────────────────────────────────────────────────────
    const defs = svg.append("defs");

    // Node glow
    const glowF = defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    glowF.append("feGaussianBlur").attr("stdDeviation", "6").attr("result", "b");
    const gm = glowF.append("feMerge");
    gm.append("feMergeNode").attr("in", "b");
    gm.append("feMergeNode").attr("in", "SourceGraphic");

    // Edge glow
    const edgeF = defs.append("filter").attr("id", "edge-glow").attr("x", "-20%").attr("y", "-20%").attr("width", "140%").attr("height", "140%");
    edgeF.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "b");
    const em = edgeF.append("feMerge");
    em.append("feMergeNode").attr("in", "b");
    em.append("feMergeNode").attr("in", "SourceGraphic");

    // Radial gradient for map fill
    const mapGrad = defs.append("radialGradient").attr("id", "map-fill").attr("cx", "50%").attr("cy", "50%").attr("r", "60%");
    mapGrad.append("stop").attr("offset", "0%").attr("stop-color", "rgba(255,255,255,0.08)");
    mapGrad.append("stop").attr("offset", "100%").attr("stop-color", "rgba(255,255,255,0.02)");

    const g = svg.append("g");

    // Zoom
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.4, 5])
        .on("zoom", (e: d3.D3ZoomEvent<SVGSVGElement, unknown>) => g.attr("transform", e.transform.toString()))
    );

    // ── US Map Background ───────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const states = topojson.feature(usAtlas as any, (usAtlas as any).objects.states) as unknown as GeoJSON.FeatureCollection;
    g.append("g").attr("class", "us-map")
      .selectAll("path")
      .data(states.features)
      .join("path")
      .attr("d", pathGen as unknown as string)
      .attr("fill", "url(#map-fill)")
      .attr("stroke", "rgba(255,255,255,0.15)")
      .attr("stroke-width", 0.6)
      .attr("stroke-linejoin", "round");

    // Outer nation border (thicker)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nationMesh = topojson.mesh(usAtlas as any, (usAtlas as any).objects.states, (a: any, b: any) => a === b);
    g.append("path")
      .datum(nationMesh)
      .attr("d", pathGen as unknown as string)
      .attr("fill", "none")
      .attr("stroke", "rgba(255,255,255,0.25)")
      .attr("stroke-width", 1.2)
      .attr("stroke-linejoin", "round");

    // Inner state borders (subtle)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stateMesh = topojson.mesh(usAtlas as any, (usAtlas as any).objects.states, (a: any, b: any) => a !== b);
    g.append("path")
      .datum(stateMesh)
      .attr("d", pathGen as unknown as string)
      .attr("fill", "none")
      .attr("stroke", "rgba(255,255,255,0.08)")
      .attr("stroke-width", 0.4);

    // ── Project nodes ───────────────────────────────────────────
    interface PNode { id: string; px: number; py: number }
    const nodePos = new Map<string, PNode>();
    for (const n of networkData.nodes) {
      const c = projection([n.hq_lng, n.hq_lat]);
      nodePos.set(n.id, { id: n.id, px: c ? c[0] : width / 2, py: c ? c[1] : height / 2 });
    }

    // ── Edges ───────────────────────────────────────────────────
    const edgeG = g.append("g");
    edgeG.selectAll("line")
      .data(networkData.edges)
      .join("line")
      .each(function (d: ContagionEdge) {
        const s = typeof d.source === "string" ? d.source : d.source.id;
        const t = typeof d.target === "string" ? d.target : d.target.id;
        const sp = nodePos.get(s);
        const tp = nodePos.get(t);
        const impS = impactMap.get(s) ?? 0;
        const impT = impactMap.get(t) ?? 0;
        const active = impS > 0 && impT > 0;
        const color = active
          ? (Math.max(impS, impT) > 0.3 ? "#ef4444" : Math.max(impS, impT) > 0.15 ? "#f97316" : "#eab308")
          : "rgba(255,255,255,0.04)";
        d3.select(this)
          .attr("x1", sp?.px ?? 0).attr("y1", sp?.py ?? 0)
          .attr("x2", tp?.px ?? 0).attr("y2", tp?.py ?? 0)
          .attr("stroke", color)
          .attr("stroke-width", active ? 2.5 : Math.max(d.weight * 1.2, 0.2))
          .attr("stroke-opacity", active ? 0.85 : 0.12)
          .attr("filter", active ? "url(#edge-glow)" : "none");
      })
      .attr("class", "edge-line");

    // ── Nodes ───────────────────────────────────────────────────
    const nodeG2 = g.append("g");
    const nodeEls = nodeG2.selectAll<SVGGElement, ContagionNode>("g")
      .data(networkData.nodes)
      .join("g")
      .attr("transform", (d: ContagionNode) => {
        const p = nodePos.get(d.id);
        return `translate(${p?.px ?? 0},${p?.py ?? 0})`;
      })
      .attr("cursor", "pointer")
      .attr("class", "node-group");

    // Outer pulse ring for high-impact nodes
    nodeEls.filter((d: ContagionNode) => (impactMap.get(d.id) ?? 0) > 0.3)
      .append("circle")
      .attr("r", 22)
      .attr("fill", "none")
      .attr("stroke", (d: ContagionNode) => (impactMap.get(d.id) ?? 0) > 0.5 ? "#ef4444" : "#f97316")
      .attr("stroke-width", 1)
      .attr("opacity", 0.4)
      .attr("class", "pulse-ring");

    // Selection ring (dashed white)
    nodeEls.append("circle")
      .attr("r", 18)
      .attr("fill", "none")
      .attr("stroke", (d: ContagionNode) => selectedNodes.has(d.id) ? "#ffffff" : "none")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "3 2")
      .attr("opacity", 0.8);

    // Background glow circle (larger, blurred)
    nodeEls.filter((d: ContagionNode) => (impactMap.get(d.id) ?? 0) > 0.15)
      .append("circle")
      .attr("r", (d: ContagionNode) => {
        const imp = impactMap.get(d.id) ?? 0;
        return imp > 0.5 ? 28 : imp > 0.3 ? 22 : 18;
      })
      .attr("fill", (d: ContagionNode) => {
        const imp = impactMap.get(d.id) ?? 0;
        return imp > 0.5 ? "rgba(239,68,68,0.12)" : imp > 0.3 ? "rgba(249,115,22,0.10)" : "rgba(234,179,8,0.08)";
      })
      .attr("filter", "url(#glow)");

    // Main node circle
    nodeEls.append("circle")
      .attr("r", (d: ContagionNode) => {
        const imp = impactMap.get(d.id) ?? 0;
        return imp > 0.5 ? 14 : imp > 0.2 ? 12 : imp > 0 ? 10 : 8;
      })
      .attr("fill", (d: ContagionNode) => {
        const imp = impactMap.get(d.id) ?? 0;
        if (imp > 0.5) return "rgba(239,68,68,0.35)";
        if (imp > 0.2) return "rgba(249,115,22,0.30)";
        if (imp > 0) return "rgba(234,179,8,0.25)";
        return "rgba(255,255,255,0.05)";
      })
      .attr("stroke", (d: ContagionNode) => {
        const imp = impactMap.get(d.id) ?? 0;
        if (imp > 0.5) return "#ef4444";
        if (imp > 0.2) return "#f97316";
        if (imp > 0) return "#eab308";
        return selectedNodes.has(d.id)
          ? "#ffffff"
          : (SECTOR_COLORS[d.sector] ?? "#555");
      })
      .attr("stroke-width", (d: ContagionNode) => {
        const imp = impactMap.get(d.id) ?? 0;
        return imp > 0 ? 2 : selectedNodes.has(d.id) ? 2 : 1.2;
      })
      .attr("class", "node-circle");

    // Labels
    nodeEls.append("text")
      .text((d: ContagionNode) => d.id)
      .attr("text-anchor", "middle").attr("dy", "0.35em")
      .attr("font-size", "7px").attr("font-weight", "700")
      .attr("fill", "white").attr("pointer-events", "none")
      .attr("letter-spacing", "0.02em");

    // Click to select
    nodeEls.on("click", (_event: MouseEvent, d: ContagionNode) => {
      if (isAnimating) return;
      setSelectedNodes((prev) => {
        const next = new Set(prev);
        if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
        return next;
      });
    });

    // Hover
    nodeEls.on("mouseenter", function (event: MouseEvent, d: ContagionNode) {
      d3.select(this).select(".node-circle")
        .transition().duration(150)
        .attr("stroke-width", 3);
      const rect = container.getBoundingClientRect();
      setTooltip({ node: d, x: event.clientX - rect.left, y: event.clientY - rect.top });
    });
    nodeEls.on("mouseleave", function () {
      d3.select(this).select<SVGCircleElement>(".node-circle")
        .transition().duration(150)
        .attr("stroke-width", 1.5);
      setTooltip(null);
    });

    return () => { svg.selectAll("*").remove(); };
  }, [networkData, selectedNodes, impactMap, isAnimating]);

  /* ── Run contagion (client-side) ───────────────────────────── */
  const runContagion = useCallback((epicenters: string[], _eventType: string, severity: number) => {
    if (!networkData || isAnimating) return;
    animTimers.current.forEach(clearTimeout);
    animTimers.current = [];
    const { timeline, impacts, totalRisk: risk, log } = clientPropagate(networkData.edges, epicenters, severity);
    setIsAnimating(true);
    setTotalSteps(timeline.length);
    setTotalRisk(risk);
    setSelectedNodes(new Set());
    setPropLog(log);
    setVisibleLogIdx(0);
    const progressiveImpacts = new Map<string, number>();
    timeline.forEach((step, idx) => {
      const timer = setTimeout(() => {
        setActiveStep(idx + 1);
        for (const nd of step.nodes) progressiveImpacts.set(nd.ticker, nd.impact);
        setImpactMap(new Map(progressiveImpacts));
        // Reveal log entries for this step
        const logUpTo = log.filter((l) => l.step <= idx).length;
        setVisibleLogIdx(logUpTo);
        if (idx === timeline.length - 1) {
          setIsAnimating(false);
          setVisibleLogIdx(log.length);
        }
      }, (idx + 1) * STEP_DELAY);
      animTimers.current.push(timer);
    });
    if (timeline.length === 0) { setIsAnimating(false); setImpactMap(impacts); setVisibleLogIdx(log.length); }
  }, [networkData, isAnimating]);

  const handleReset = useCallback(() => {
    animTimers.current.forEach(clearTimeout);
    animTimers.current = [];
    setTotalRisk(0); setActiveStep(0); setTotalSteps(0);
    setSelectedNodes(new Set()); setImpactMap(new Map()); setIsAnimating(false);
    setPropLog([]); setVisibleLogIdx(0);
  }, []);

  const activeEventIcon = EVENT_TYPES.find((e) => e.value === customEvent)?.icon ?? "";

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[600px] overflow-hidden">
      {/* ── Control Panel ──────────────────────────────────────── */}
      <div className="absolute top-4 left-4 bottom-4 z-20 w-[260px]
                      rounded-xl overflow-hidden shadow-2xl">
       <div className="h-full flex flex-col border border-white/10 rounded-xl bg-black/40 backdrop-blur-md">
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar">

        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Climate Scenarios</h3>
          </div>
          <p className="text-[10px] text-gray-500 leading-relaxed">Simulate cascade propagation through the supply chain network</p>
        </div>

        {/* Presets */}
        <div className="px-4 pb-3 space-y-1.5">
          {PRESETS.map((p) => (
            <button key={p.label} disabled={isAnimating}
              onClick={() => runContagion(p.epicenters, p.event, p.severity)}
              className="group w-full text-left px-3 py-2.5 rounded-xl text-[11px] font-medium
                bg-white/5 border border-white/10 text-gray-400
                hover:bg-white/10 hover:border-amber-500/30 hover:text-white transition-all duration-200
                disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer
                flex items-center justify-between">
              <span>{p.label}</span>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded
                             bg-white/5 text-gray-500 group-hover:text-amber-500 transition-colors">
                {p.tag}
              </span>
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="mx-5 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Custom Trigger */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Custom Trigger</h3>
          </div>
          <p className="text-[10px] text-gray-500 -mt-1">Click nodes on the map, then trigger</p>

          {/* Selected nodes chips */}
          {selectedNodes.size > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(selectedNodes).map((t) => (
                <span key={t} className="px-2 py-0.5 rounded-md text-[10px] font-bold
                  bg-white/5 text-amber-400 border border-amber-500/20">{t}</span>
              ))}
            </div>
          )}

          {/* Event type selector — custom styled */}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm pointer-events-none">{activeEventIcon}</span>
            <select value={customEvent} onChange={(e) => setCustomEvent(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-lg text-xs font-medium
                bg-white/5 border border-white/10 text-white/80
                appearance-none cursor-pointer outline-none
                hover:bg-white/10 hover:border-white/20 transition-all"
              style={{ colorScheme: "dark" }}>
              {EVENT_TYPES.map((e) => (
                <option key={e.value} value={e.value} className="bg-[#0a0a0f] text-white/80">
                  {e.icon} {e.label}
                </option>
              ))}
            </select>
            <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none"
              viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.5 6l3.5 4 3.5-4H4.5z" />
            </svg>
          </div>

          {/* Severity slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">Severity</span>
              <span className="text-xs font-bold font-mono text-amber-400">{customSeverity}/5</span>
            </div>
            <div className="relative">
              <input type="range" min={1} max={5} value={customSeverity}
                onChange={(e) => setCustomSeverity(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                  [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(255,255,255,0.3)] [&::-webkit-slider-thumb]:border-0
                  [&::-webkit-slider-thumb]:cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #22c55e, #eab308 40%, #f97316 70%, #ef4444 100%)`,
                }} />
              <div className="flex justify-between mt-0.5">
                {[1,2,3,4,5].map((n) => (
                  <span key={n} className={`text-[8px] font-mono ${customSeverity === n ? "text-amber-400" : "text-gray-600"}`}>{n}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Trigger button */}
          <button onClick={() => runContagion(Array.from(selectedNodes), customEvent, customSeverity)}
            disabled={isAnimating || selectedNodes.size === 0}
            className="w-full px-3 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest
              bg-amber-500/20 border border-amber-500/30 text-amber-400
              hover:bg-amber-500/30 hover:border-amber-500/50 hover:text-amber-300
              transition-all duration-200 cursor-pointer
              disabled:opacity-20 disabled:cursor-not-allowed">
            {selectedNodes.size > 0
              ? `Trigger Contagion \u2014 ${selectedNodes.size} node${selectedNodes.size > 1 ? "s" : ""}`
              : "Select nodes first"}
          </button>
        </div>

        {/* Progress bar */}
        {isAnimating && (
          <div className="mx-5 mb-4">
            <div className="flex justify-between text-[9px] text-gray-500 mb-1 font-mono">
              <span>PROPAGATING</span><span className="text-amber-400">{activeStep}/{totalSteps}</span>
            </div>
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300 ease-out
                bg-amber-500"
                style={{ width: `${totalSteps ? (activeStep / totalSteps) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        {/* Results */}
        {totalRisk > 0 && !isAnimating && (
          <div className="mx-5 mb-4 space-y-2.5">
            <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-2">
              <div className="flex justify-between items-baseline">
                <span className="text-[9px] uppercase tracking-widest text-gray-500 font-semibold">Contagion Risk</span>
                <span className="text-lg font-bold font-mono text-amber-400">{totalRisk.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-[9px] uppercase tracking-widest text-gray-500 font-semibold">Nodes Affected</span>
                <span className="text-sm font-bold font-mono text-amber-400">{impactMap.size}<span className="text-gray-600 text-[10px]">/{networkData?.nodes.length ?? 0}</span></span>
              </div>
            </div>
            <button onClick={handleReset}
              className="w-full px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest
                bg-white/5 border border-white/10 text-gray-400
                hover:bg-white/10 hover:text-white transition-all cursor-pointer">
              Reset Network
            </button>
          </div>
        )}
        </div>
       </div>
      </div>

      {/* ── Right Sidebar ────────────────────────────────────────── */}
      <div className="absolute top-4 right-4 bottom-4 z-20 w-[250px] flex flex-col gap-2.5">
        {/* Sectors Legend */}
        <div className="shrink-0 rounded-xl border border-white/10 bg-black/40 backdrop-blur-md px-4 py-2.5">
          <span className="text-[8px] uppercase tracking-widest text-gray-500 block mb-2 font-semibold">Sectors</span>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {Object.entries(SECTOR_COLORS).map(([name, color]) => (
              <div key={name} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-[9px] text-gray-400 whitespace-nowrap">{name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top 5 Risk Scores (visible after simulation) */}
        {impactMap.size > 0 && networkData && (() => {
          const ranked = networkData.nodes
            .map((n) => ({ ...n, impact: impactMap.get(n.id) ?? 0, loss: estimateLoss(impactMap.get(n.id) ?? 0, n.market_cap) }))
            .filter((n) => n.impact > 0)
            .sort((a, b) => b.impact - a.impact)
            .slice(0, 5);
          const totalLoss = networkData.nodes.reduce((sum, n) => sum + estimateLoss(impactMap.get(n.id) ?? 0, n.market_cap), 0);
          const maxImpact = ranked[0]?.impact ?? 1;
          const visibleLog = propLog.slice(0, visibleLogIdx);

          return (<>
            <div className="shrink-0 rounded-xl overflow-hidden">
              <div className="border border-white/10 rounded-xl bg-black/40 backdrop-blur-md p-3.5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[8px] uppercase tracking-widest text-gray-500 font-semibold">Highest Risk</span>
                <span className="text-[9px] font-mono text-amber-400">{formatLoss(totalLoss)} total</span>
              </div>
              <div className="space-y-2">
                {ranked.map((n, i) => (
                  <div key={n.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-gray-600 w-3">{i + 1}.</span>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: SECTOR_COLORS[n.sector] ?? "#666" }} />
                        <span className="text-[11px] font-bold text-white/90">{n.id}</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-amber-400">{formatLoss(n.loss)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${(n.impact / maxImpact) * 100}%`,
                            background: n.impact > 0.5
                              ? "linear-gradient(90deg, #f97316, #ef4444)"
                              : n.impact > 0.2
                                ? "linear-gradient(90deg, #eab308, #f97316)"
                                : "linear-gradient(90deg, #22c55e, #eab308)",
                          }} />
                      </div>
                      <span className="text-[9px] font-mono text-gray-500 w-8 text-right">{(n.impact * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
              </div>
            </div>

            {/* Propagation Log */}
            <div className="flex-1 min-h-0 rounded-xl overflow-hidden">
              <div className="h-full flex flex-col border border-white/10 rounded-xl bg-black/40 backdrop-blur-md p-3.5">
                <div className="shrink-0 flex items-center gap-1.5 mb-2.5">
                  <span className="text-[8px] uppercase tracking-widest text-gray-500 font-semibold">Propagation Log</span>
                  {isAnimating && (
                    <span className="relative flex h-1.5 w-1.5 ml-auto">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
                    </span>
                  )}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar font-mono text-[9px] leading-[1.6] space-y-px">
                  {visibleLog.map((entry, i) => (
                    <div key={i} className={`flex items-start gap-1 ${entry.from === "ORIGIN" ? "text-amber-400/70" : "text-gray-400"}`}>
                      <span className="text-gray-600 shrink-0 w-4">{entry.step}.</span>
                      {entry.from === "ORIGIN" ? (
                        <span><span className="text-amber-400">{entry.to}</span> <span className="text-gray-600">epicenter</span></span>
                      ) : (
                        <span>
                          <span className="text-amber-400/60">{entry.from}</span>
                          <span className="text-gray-600">{" → "}</span>
                          <span className="text-gray-300">{entry.to}</span>
                          <span className="text-gray-600"> ({(entry.impact * 100).toFixed(0)}%)</span>
                        </span>
                      )}
                    </div>
                  ))}
                  {visibleLog.length === 0 && (
                    <span className="text-gray-600">Awaiting simulation...</span>
                  )}
                </div>
              </div>
            </div>
          </>);
        })()}
      </div>

      {/* ── Tooltip ────────────────────────────────────────────── */}
      {tooltip && (
        <div className="absolute z-30 pointer-events-none rounded-xl border border-white/10
                        bg-black/40 backdrop-blur-md px-4 py-3 shadow-2xl min-w-[180px]"
          style={{ left: Math.min(tooltip.x + 16, (containerRef.current?.clientWidth ?? 800) - 200), top: tooltip.y - 10 }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SECTOR_COLORS[tooltip.node.sector] ?? "#666" }} />
            <span className="text-xs font-bold text-white">{tooltip.node.id}</span>
            <span className="text-[10px] text-gray-500">{tooltip.node.name}</span>
          </div>
          <div className="text-[10px] text-gray-400 mb-2">{tooltip.node.sector}</div>
          <div className="space-y-1 text-[10px]">
            <div className="flex justify-between">
              <span className="text-gray-500">Direct Exposure</span>
              <span className="text-white font-mono font-bold">{(tooltip.node.direct_exposure * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Contagion Impact</span>
              <span className="font-mono font-bold" style={{ color: RISK_COLORS[
                (impactMap.get(tooltip.node.id) ?? 0) > 0.5 ? "critical"
                : (impactMap.get(tooltip.node.id) ?? 0) > 0.2 ? "high"
                : (impactMap.get(tooltip.node.id) ?? 0) > 0 ? "medium" : "low"
              ] }}>
                {((impactMap.get(tooltip.node.id) ?? 0) * 100).toFixed(1)}%
              </span>
            </div>
            {(impactMap.get(tooltip.node.id) ?? 0) > 0 && (
              <div className="flex justify-between pt-0.5 border-t border-white/10">
                <span className="text-gray-500">Est. Loss</span>
                <span className="font-mono font-bold text-amber-400">
                  {formatLoss(estimateLoss(impactMap.get(tooltip.node.id) ?? 0, tooltip.node.market_cap))}
                </span>
              </div>
            )}
          </div>
          {!isAnimating && (
            <div className="mt-2 pt-1.5 border-t border-white/10 text-[9px] text-gray-600">
              {selectedNodes.has(tooltip.node.id) ? "Click to deselect" : "Click to select as epicenter"}
            </div>
          )}
        </div>
      )}

      {/* ── Loading / Error states ─────────────────────────────── */}
      {networkApi.loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-black/40 backdrop-blur-md border border-white/10">
            <div className="w-4 h-4 border-2 border-white/20 border-t-amber-400 rounded-full animate-spin" />
            <span className="text-sm text-gray-400">Loading network...</span>
          </div>
        </div>
      )}
      {networkApi.error && (
        <div className="absolute top-4 right-4 z-20 rounded-xl bg-black/40 backdrop-blur-md border border-amber-500/20 px-4 py-3 max-w-xs">
          <div className="text-xs font-semibold text-amber-400 mb-0.5">Backend Offline</div>
          <div className="text-[10px] text-gray-500">Run: <code className="font-mono bg-white/5 px-1 rounded">uvicorn app.main:app --port 8000</code></div>
        </div>
      )}

      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
