import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import L from "leaflet";
import { Circle, LayerGroup, MapContainer, Marker, Polygon, Popup, TileLayer } from "react-leaflet";

type HazardId = "hurricane" | "flood" | "wildfire" | "drought" | "carbon";
type PositionType = "LONG" | "SHORT";
type EventId = "hurricane" | "wildfire" | "flood" | "drought" | "carbon";
type SeverityLevel = 1 | 2 | 3 | 4 | 5;

interface ClimateRiskHeatmapProps {
  onOpenStressTest: (ticker?: string) => void;
}

interface HazardConfig {
  id: HazardId;
  icon: string;
  label: string;
  shortLabel: string;
  color: string;
  defaultOn: boolean;
}

interface Holding {
  ticker: string;
  name: string;
  position: PositionType;
  markerSize: "large" | "medium" | "small";
  coordinates: [number, number];
  capital: number;
  exposures: Record<HazardId, number>;
}

interface EventConfig {
  id: EventId;
  icon: string;
  label: string;
  summaryLabel: string;
  epicenter?: [number, number];
  hazard: HazardId;
}

interface SimulationState {
  eventId: EventId;
  severity: SeverityLevel;
  radius: number;
  impactedTickers: string[];
  startedAt: number;
  complete: boolean;
}

const MAP_CENTER: [number, number] = [37.5, -95.5];
const INITIAL_ZOOM = 4;
const TOTAL_PORTFOLIO_CAPITAL = 123.2;

const HAZARDS: HazardConfig[] = [
  { id: "hurricane", icon: "🌀", label: "Hurricane Corridors", shortLabel: "Hurricane", color: "#f97316", defaultOn: true },
  { id: "flood", icon: "🌊", label: "FEMA Flood Zones", shortLabel: "Flood", color: "#3b82f6", defaultOn: true },
  { id: "wildfire", icon: "🔥", label: "Wildfire Risk", shortLabel: "Wildfire", color: "#ef4444", defaultOn: false },
  { id: "drought", icon: "☀️", label: "Drought Zones", shortLabel: "Drought", color: "#eab308", defaultOn: false },
  { id: "carbon", icon: "⚡", label: "Carbon Regulation", shortLabel: "Carbon", color: "#a855f7", defaultOn: false },
];

const EVENTS: EventConfig[] = [
  { id: "hurricane", icon: "🌀", label: "Gulf Coast Hurricane", summaryLabel: "Gulf Coast Hurricane", epicenter: [27.5, -90.5], hazard: "hurricane" },
  { id: "wildfire", icon: "🔥", label: "California Wildfire", summaryLabel: "California Wildfire", epicenter: [38.5, -121.0], hazard: "wildfire" },
  { id: "flood", icon: "🌊", label: "Mississippi River Flood", summaryLabel: "Mississippi Flood", epicenter: [32.0, -91.0], hazard: "flood" },
  { id: "drought", icon: "☀️", label: "Texas Drought", summaryLabel: "Texas Drought", epicenter: [31.5, -99.0], hazard: "drought" },
  { id: "carbon", icon: "⚡", label: "Carbon Tax Shock", summaryLabel: "Carbon Tax Shock", hazard: "carbon" },
];

const HOLDINGS: Holding[] = [
  {
    ticker: "CVX",
    name: "Chevron",
    position: "LONG",
    markerSize: "large",
    coordinates: [29.7604, -95.3698],
    capital: 18.4,
    exposures: { hurricane: 82, flood: 55, wildfire: 0, drought: 35, carbon: 70 },
  },
  {
    ticker: "XOM",
    name: "ExxonMobil",
    position: "SHORT",
    markerSize: "large",
    coordinates: [32.7767, -96.797],
    capital: 16.1,
    exposures: { hurricane: 66, flood: 24, wildfire: 0, drought: 48, carbon: 86 },
  },
  {
    ticker: "HAL",
    name: "Halliburton",
    position: "LONG",
    markerSize: "medium",
    coordinates: [29.8164, -95.3218],
    capital: 12.7,
    exposures: { hurricane: 74, flood: 41, wildfire: 0, drought: 27, carbon: 52 },
  },
  {
    ticker: "SPG",
    name: "Simon Property Group",
    position: "LONG",
    markerSize: "medium",
    coordinates: [25.7617, -80.1918],
    capital: 14.8,
    exposures: { hurricane: 58, flood: 76, wildfire: 0, drought: 0, carbon: 18 },
  },
  {
    ticker: "NEE",
    name: "NextEra Energy",
    position: "LONG",
    markerSize: "medium",
    coordinates: [26.7153, -80.0534],
    capital: 13.9,
    exposures: { hurricane: 53, flood: 69, wildfire: 0, drought: 12, carbon: 34 },
  },
  {
    ticker: "AMT",
    name: "American Tower",
    position: "LONG",
    markerSize: "small",
    coordinates: [37.3382, -121.8863],
    capital: 11.4,
    exposures: { hurricane: 0, flood: 0, wildfire: 64, drought: 18, carbon: 92 },
  },
  {
    ticker: "LYB",
    name: "LyondellBasell",
    position: "LONG",
    markerSize: "small",
    coordinates: [29.7604, -95.8],
    capital: 17.3,
    exposures: { hurricane: 63, flood: 49, wildfire: 0, drought: 39, carbon: 66 },
  },
  {
    ticker: "PKG",
    name: "Packaging Corp",
    position: "LONG",
    markerSize: "small",
    coordinates: [41.8781, -87.6298],
    capital: 18.6,
    exposures: { hurricane: 0, flood: 0, wildfire: 9, drought: 14, carbon: 22 },
  },
];

const SEVERITY_RADII: Record<SeverityLevel, number> = {
  1: 150000,
  2: 250000,
  3: 350000,
  4: 450000,
  5: 600000,
};

const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  1: "Cat 1",
  2: "Cat 2",
  3: "Cat 3",
  4: "Cat 4",
  5: "Cat 5",
};

const MARKER_PIXELS = {
  large: 54,
  medium: 46,
  small: 38,
};

const DEFAULT_TOGGLES = HAZARDS.reduce(
  (acc, hazard) => ({ ...acc, [hazard.id]: hazard.defaultOn }),
  {} as Record<HazardId, boolean>,
);

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
    <div
      className={`transition-all duration-500 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function sectionTitle(title: string) {
  return (
    <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/35">
      {title}
    </h3>
  );
}

function getActiveHazards(toggles: Record<HazardId, boolean>) {
  return HAZARDS.filter((hazard) => toggles[hazard.id]);
}

function getRiskFillColor(value: number) {
  if (value >= 60) return "#ef4444";
  if (value >= 35) return "#f59e0b";
  if (value > 0) return "#22c55e";
  return "#6b7280";
}

function buildMarkerIcon({
  holding,
  activeHazards,
  exposureThreshold,
  simulation,
}: {
  holding: Holding;
  activeHazards: HazardConfig[];
  exposureThreshold: number;
  simulation: SimulationState | null;
}) {
  const relevantHazards = activeHazards.length > 0 ? activeHazards : HAZARDS;
  const highestExposure = Math.max(...relevantHazards.map((hazard) => holding.exposures[hazard.id]));
  const isBelowThreshold = highestExposure < exposureThreshold;
  const isHit = simulation?.impactedTickers.includes(holding.ticker) ?? false;
  const isCarbonShock = simulation?.eventId === "carbon" && isHit;
  const fillColor = isHit ? (isCarbonShock ? "#f59e0b" : "#ef4444") : getRiskFillColor(highestExposure);
  const borderColor = holding.position === "SHORT" ? "#60a5fa" : "#f8fafc";
  const textColor = fillColor === "#6b7280" ? "#e5e7eb" : "#ffffff";
  const size = MARKER_PIXELS[holding.markerSize];
  const pulseClass = isHit ? (isCarbonShock ? "risk-marker--pulse-amber" : "risk-marker--pulse-red") : "";
  const glowColor = holding.position === "SHORT" ? "96,165,250" : "255,255,255";
  const opacity = isBelowThreshold ? 0.4 : 1;

  return L.divIcon({
    className: "risk-marker-icon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `
      <div
        class="risk-marker ${pulseClass}"
        style="
          width:${size}px;
          height:${size}px;
          opacity:${opacity};
          border-color:${borderColor};
          background:radial-gradient(circle at 30% 25%, rgba(255,255,255,0.18), ${fillColor});
          box-shadow:0 0 0 1px rgba(255,255,255,0.08), 0 0 28px rgba(${glowColor},0.15);
          color:${textColor};
        "
      >
        <span class="risk-marker__ticker">${holding.ticker}</span>
      </div>
    `,
  });
}

function distanceInMeters(a: [number, number], b: [number, number]) {
  return L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]));
}

function formatMoney(value: number) {
  return `$${value.toFixed(1)}M`;
}

function getImpactEstimate(holding: Holding, hazard: HazardId, severity: SeverityLevel) {
  const severityScalar = 0.07 + severity * 0.03;
  return holding.capital * (holding.exposures[hazard] / 100) * severityScalar;
}

function ClimateRiskHeatmap({ onOpenStressTest }: ClimateRiskHeatmapProps) {
  const [hazardToggles, setHazardToggles] = useState<Record<HazardId, boolean>>(DEFAULT_TOGGLES);
  const [exposureThreshold, setExposureThreshold] = useState(20);
  const [selectedEvent, setSelectedEvent] = useState<EventId>("hurricane");
  const [severity, setSeverity] = useState<SeverityLevel>(4);
  const [simulation, setSimulation] = useState<SimulationState | null>(null);

  const activeHazards = getActiveHazards(hazardToggles);
  const currentEvent = EVENTS.find((event) => event.id === selectedEvent) ?? EVENTS[0];
  const activeSimulationEvent = simulation
    ? EVENTS.find((event) => event.id === simulation.eventId) ?? currentEvent
    : currentEvent;

  useEffect(() => {
    if (!simulation || currentEvent.id !== simulation.eventId || !currentEvent.epicenter) {
      return;
    }

    let frame = 0;
    const startedAt = simulation.startedAt;
    const maxRadius = SEVERITY_RADII[simulation.severity];
    const duration = 1500;
    const impactZone = currentEvent.epicenter;
    const start = performance.now();

    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const radius = maxRadius * progress;

      setSimulation((prev) => {
        if (!prev || prev.startedAt !== startedAt) {
          return prev;
        }

        if (progress >= 1) {
          const impactedTickers = HOLDINGS.filter((holding) => distanceInMeters(holding.coordinates, impactZone) <= maxRadius)
            .map((holding) => holding.ticker);

          return { ...prev, radius: maxRadius, impactedTickers, complete: true };
        }

        return { ...prev, radius };
      });

      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [currentEvent, simulation]);

  const simulateImpact = () => {
    if (currentEvent.id === "carbon") {
      setSimulation({
        eventId: currentEvent.id,
        severity,
        radius: 0,
        impactedTickers: HOLDINGS.map((holding) => holding.ticker),
        startedAt: Date.now(),
        complete: true,
      });
      return;
    }

    setSimulation({
      eventId: currentEvent.id,
      severity,
      radius: 0,
      impactedTickers: [],
      startedAt: Date.now(),
      complete: false,
    });
  };

  const clearSimulation = () => setSimulation(null);

  const activeHazardStats = activeHazards.map((hazard) => {
    const baseCapitalAtRisk = HOLDINGS.reduce((sum, holding) => sum + (holding.capital * holding.exposures[hazard.id]) / 100, 0);
    const exposedCount = HOLDINGS.filter((holding) => holding.exposures[hazard.id] > 0).length;
    const hazardMatchesSimulation =
      simulation && (simulation.eventId === "carbon" ? hazard.id === "carbon" : activeSimulationEvent.hazard === hazard.id);
    const simulationCapital = hazardMatchesSimulation && simulation?.impactedTickers.length
      ? HOLDINGS.filter((holding) => simulation.impactedTickers.includes(holding.ticker)).reduce(
          (sum, holding) => sum + getImpactEstimate(holding, hazard.id, simulation.severity),
          0,
        )
      : 0;

    return {
      ...hazard,
      exposedCount,
      atRisk: baseCapitalAtRisk + simulationCapital,
    };
  });

  const totalCapitalAtRisk = HOLDINGS.reduce((sum, holding) => {
    const relevantHazards = activeHazards.length > 0 ? activeHazards : HAZARDS;
    const maxExposure = Math.max(...relevantHazards.map((hazard) => holding.exposures[hazard.id]));
    const baseRisk = holding.capital * (maxExposure / 100);
    const simulatedRisk = simulation?.impactedTickers.includes(holding.ticker)
      ? getImpactEstimate(holding, activeSimulationEvent.hazard, simulation.severity)
      : 0;
    return sum + baseRisk + simulatedRisk;
  }, 0);

  const percentAtRisk = (totalCapitalAtRisk / TOTAL_PORTFOLIO_CAPITAL) * 100;
  const impactLoss = simulation
    ? HOLDINGS.filter((holding) => simulation.impactedTickers.includes(holding.ticker)).reduce(
        (sum, holding) => sum + getImpactEstimate(holding, activeSimulationEvent.hazard, simulation.severity),
        0,
      )
    : 0;

  return (
    <div className="h-full min-h-0 p-4 sm:p-6">
      <div className="grid h-full min-h-[calc(100vh-6rem)] grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,28%)_minmax(0,72%)]">
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1 no-scrollbar">
          <FadePanel delay={0} className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            {sectionTitle("Hazard Layers")}
            <div className="space-y-2.5">
              {HAZARDS.map((hazard) => (
                <label
                  key={hazard.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/85"
                >
                  <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={hazardToggles[hazard.id]}
                      onChange={() =>
                        setHazardToggles((prev) => ({
                          ...prev,
                          [hazard.id]: !prev[hazard.id],
                        }))
                      }
                    />
                    <span className="absolute inset-0 rounded-full border border-white/10 bg-black/40 transition peer-checked:border-amber-400/40 peer-checked:bg-amber-500/20" />
                    <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white/75 transition peer-checked:left-6 peer-checked:bg-amber-300" />
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span>{hazard.icon}</span>
                    <span className="truncate">{hazard.label}</span>
                  </span>
                  <span
                    className="h-3 w-3 rounded-full border border-white/20"
                    style={{ backgroundColor: hazard.color }}
                  />
                </label>
              ))}
            </div>
          </FadePanel>

          <FadePanel delay={100} className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            {sectionTitle("Exposure Filter")}
            <p className="mb-4 text-sm text-white/60">Show holdings where exposure exceeds X%</p>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={exposureThreshold}
              onChange={(event) => setExposureThreshold(Number(event.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-amber-400"
            />
            <p className="mt-3 text-sm font-medium text-amber-300">
              Showing holdings &gt; {exposureThreshold}% exposed
            </p>
          </FadePanel>

          <FadePanel delay={200} className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            {sectionTitle("Simulate Event")}
            <div className="space-y-4">
              <div>
                <select
                  value={selectedEvent}
                  onChange={(event) => setSelectedEvent(event.target.value as EventId)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none"
                >
                  {EVENTS.map((eventOption) => (
                    <option key={eventOption.id} value={eventOption.id} className="bg-slate-900 text-white">
                      {eventOption.icon} {eventOption.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {([1, 2, 3, 4, 5] as SeverityLevel[]).map((level) => {
                  const selected = severity === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setSeverity(level)}
                      className={`rounded-full border px-2 py-2 text-[11px] font-medium transition ${
                        selected
                          ? "border-amber-300/50 bg-amber-400/20 text-amber-200"
                          : "border-white/10 bg-white/5 text-white/55 hover:text-white/80"
                      }`}
                    >
                      {SEVERITY_LABELS[level]}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={simulateImpact}
                className="w-full rounded-xl border border-amber-300/40 bg-white/5 px-4 py-3 text-sm font-medium text-amber-200 transition hover:bg-amber-400/10"
              >
                Simulate Impact
              </button>

              <button
                type="button"
                onClick={clearSimulation}
                className="text-sm text-white/45 transition hover:text-white/80"
              >
                Clear Simulation
              </button>
            </div>
          </FadePanel>

          <FadePanel delay={300} className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            {sectionTitle("Exposure Summary")}
            <div className="space-y-2.5">
              {activeHazardStats.length > 0 ? (
                activeHazardStats.map((hazard) => (
                  <div
                    key={hazard.id}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/80"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate">
                        {hazard.icon} {hazard.shortLabel}: {hazard.exposedCount} of {HOLDINGS.length} holdings exposed
                      </span>
                      <span className="font-medium text-white">{formatMoney(hazard.atRisk)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/45">
                  Toggle at least one hazard layer to generate a portfolio risk rollup.
                </div>
              )}
            </div>

            <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">Total Capital at Climate Risk</p>
              <p className="mt-1 text-2xl font-semibold text-white">{formatMoney(totalCapitalAtRisk)}</p>
              <p className="mt-1 text-sm font-medium text-amber-300">As % of Portfolio: {percentAtRisk.toFixed(1)}%</p>
            </div>

            <button
              type="button"
              onClick={() => onOpenStressTest()}
              className="mt-4 text-sm text-white/75 transition hover:text-white"
            >
              Open Full Stress Test →
            </button>
          </FadePanel>
        </div>

        <FadePanel delay={400} className="min-h-[680px] xl:min-h-0">
          <div className="relative h-full overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-md">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex items-start justify-between gap-3 p-4">
              <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 backdrop-blur-md">
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/35">Physical Asset Concentration</p>
                <p className="mt-1 text-sm text-white/80">8 holdings mapped against live climate hazard geometry</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-right backdrop-blur-md">
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/35">Active Layers</p>
                <p className="mt-1 text-sm text-white/80">{activeHazards.length || 0} overlays enabled</p>
              </div>
            </div>

            <MapContainer
              center={MAP_CENTER}
              zoom={INITIAL_ZOOM}
              scrollWheelZoom
              className="h-full w-full"
              zoomControl={false}
            >
              <TileLayer
                attribution="&copy; OpenStreetMap contributors &copy; CARTO"
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              />

              {hazardToggles.hurricane && (
                <LayerGroup>
                  <Polygon
                    positions={[
                      [23, -98.5],
                      [25, -94.5],
                      [28.5, -89.5],
                      [31, -84.5],
                      [33.5, -79.5],
                      [35.8, -74.5],
                      [34, -73.5],
                      [30, -78],
                      [27, -84],
                      [24, -89.5],
                    ]}
                    pathOptions={{ color: "#f97316", fillColor: "#f97316", fillOpacity: 0.15, weight: 2, dashArray: "10 8" }}
                  />
                  <Polygon
                    positions={[
                      [20, -76],
                      [25, -73],
                      [30, -70],
                      [35, -68],
                      [39, -72],
                      [41, -75],
                      [37, -76],
                      [31, -74],
                      [24, -76],
                    ]}
                    pathOptions={{ color: "#f97316", fillColor: "#f97316", fillOpacity: 0.12, weight: 2, dashArray: "10 8" }}
                  />
                </LayerGroup>
              )}

              {hazardToggles.flood && (
                <LayerGroup>
                  <Polygon
                    positions={[
                      [29, -93],
                      [28, -89],
                      [30, -85],
                      [31, -89],
                      [30, -93],
                    ]}
                    pathOptions={{ color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 0.2, weight: 1.5 }}
                  />
                  <Polygon
                    positions={[
                      [25, -81],
                      [26, -80],
                      [28, -80],
                      [27, -81],
                    ]}
                    pathOptions={{ color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 0.2, weight: 1.5 }}
                  />
                  <Polygon
                    positions={[
                      [29, -91],
                      [30, -90],
                      [31, -90],
                      [30, -91],
                    ]}
                    pathOptions={{ color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 0.2, weight: 1.5 }}
                  />
                </LayerGroup>
              )}

              {hazardToggles.wildfire && (
                <LayerGroup>
                  <Polygon
                    positions={[
                      [37, -122],
                      [38, -120],
                      [40, -120],
                      [40, -122],
                    ]}
                    pathOptions={{ color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.15, weight: 1.5 }}
                  />
                  <Polygon
                    positions={[
                      [33, -118],
                      [34, -116],
                      [35, -117],
                      [34, -119],
                    ]}
                    pathOptions={{ color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.15, weight: 1.5 }}
                  />
                </LayerGroup>
              )}

              {hazardToggles.drought && (
                <LayerGroup>
                  <Polygon
                    positions={[
                      [28, -104],
                      [32, -100],
                      [34, -100],
                      [34, -104],
                      [30, -106],
                    ]}
                    pathOptions={{ color: "#eab308", fillColor: "#eab308", fillOpacity: 0.15, weight: 2, dashArray: "8 6" }}
                  />
                </LayerGroup>
              )}

              {hazardToggles.carbon && (
                <LayerGroup>
                  <Polygon
                    positions={[
                      [32.5, -124.6],
                      [42.1, -124.6],
                      [42.1, -114.1],
                      [32.5, -114.1],
                    ]}
                    pathOptions={{ color: "#a855f7", fillColor: "#a855f7", fillOpacity: 0.1, weight: 1.5 }}
                  />
                  <Polygon
                    positions={[
                      [40.4, -79.9],
                      [45.1, -79.9],
                      [45.1, -71.8],
                      [40.4, -71.8],
                    ]}
                    pathOptions={{ color: "#a855f7", fillColor: "#a855f7", fillOpacity: 0.1, weight: 1.5 }}
                  />
                </LayerGroup>
              )}

              {HOLDINGS.map((holding) => (
                <Marker
                  key={holding.ticker}
                  position={holding.coordinates}
                  icon={buildMarkerIcon({
                    holding,
                    activeHazards,
                    exposureThreshold,
                    simulation,
                  })}
                >
                  <Popup className="clima-risk-popup">
                    <div className="min-w-[240px] space-y-3 text-white">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-white">
                            {holding.ticker} <span className="text-white/50">· {holding.name}</span>
                          </p>
                        </div>
                        <span
                          className={`rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.15em] ${
                            holding.position === "SHORT"
                              ? "border-blue-400/30 bg-blue-500/15 text-blue-300"
                              : "border-white/15 bg-white/10 text-white/80"
                          }`}
                        >
                          {holding.position}
                        </span>
                      </div>

                      <div className="space-y-2 text-sm text-white/75">
                        {(activeHazards.length > 0 ? activeHazards : HAZARDS).map((hazard) => (
                          <div key={hazard.id} className="flex items-center justify-between gap-3">
                            <span>
                              {hazard.icon} {hazard.shortLabel}
                            </span>
                            <span className="font-medium text-white">{holding.exposures[hazard.id]}%</span>
                          </div>
                        ))}
                      </div>

                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
                        Dollar exposure estimate:{" "}
                        <span className="font-semibold text-white">
                          {formatMoney(
                            activeHazards.reduce(
                              (sum, hazard) => sum + (holding.capital * holding.exposures[hazard.id]) / 100,
                              0,
                            ) || holding.capital * 0.28,
                          )}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => onOpenStressTest(holding.ticker)}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
                      >
                        Run Stress Test for {holding.ticker} →
                      </button>
                    </div>
                  </Popup>
                </Marker>
              ))}

              {simulation && activeSimulationEvent.epicenter && activeSimulationEvent.id !== "carbon" && (
                <>
                  <Circle
                    center={activeSimulationEvent.epicenter}
                    radius={simulation.radius}
                    pathOptions={{
                      color: "#ef4444",
                      fillColor: "#ef4444",
                      fillOpacity: 0.1,
                      weight: 2,
                      dashArray: "10 10",
                    }}
                  />
                  <Marker
                    position={activeSimulationEvent.epicenter}
                    icon={L.divIcon({
                      className: "impact-label-icon",
                      iconSize: [220, 40],
                      iconAnchor: [110, 20],
                      html: `<div class="impact-label">${SEVERITY_LABELS[simulation.severity]} Impact Radius — ~${Math.round(
                        SEVERITY_RADII[simulation.severity] * 0.000621371,
                      )}mi</div>`,
                    })}
                  />
                </>
              )}
            </MapContainer>

            {simulation && (
              <div className="absolute inset-x-4 bottom-4 z-[500] flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/85 backdrop-blur-md">
                <div className="min-w-0">
                  <span className="font-medium text-amber-300">⚠️ Simulation Active</span>
                  <span className="text-white/70">
                    {" "}
                    — {activeSimulationEvent.summaryLabel} — {SEVERITY_LABELS[simulation.severity]} — {simulation.impactedTickers.length} holdings within impact zone — Est. Portfolio Impact: -{formatMoney(impactLoss)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={clearSimulation}
                  className="shrink-0 text-white/50 transition hover:text-white"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </FadePanel>
      </div>
    </div>
  );
}

export default ClimateRiskHeatmap;
