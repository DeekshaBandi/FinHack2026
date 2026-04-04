import { useEffect, useMemo, useState } from "react";
import { Mic, Paperclip, SendHorizontal } from "lucide-react";

type RecommendationFilter = "All" | "Hedging" | "Rebalancing" | "Opportunistic";

interface RetrievedContext {
  title: string;
  source: string;
  excerpt: string;
}

interface AssistantPayload {
  summary: string;
  insight: string;
  takeaway: string;
  contexts: RetrievedContext[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  payload?: AssistantPayload;
}

interface RecommendationCard {
  title: string;
  explanation: string;
  tag: string;
  action?: string;
}

const SUGGESTED_QUERIES = [
  "What is my net hurricane exposure across the whole book right now?",
  "Which energy holdings are most vulnerable to a $100/ton carbon tax?",
  "How did similar portfolios perform after Hurricane Harvey in 2017?",
  "What’s the contagion risk if Valero takes a major hit?",
];

const RECOMMENDATION_GROUPS: {
  key: Exclude<RecommendationFilter, "All">;
  title: string;
  cards: RecommendationCard[];
}[] = [
  {
    key: "Hedging",
    title: "Hedging Actions",
    cards: [
      {
        title: "Hedge Gulf Coast refinery exposure via short energy names",
        explanation: "Current Gulf Coast concentration leaves the long book vulnerable to an event-driven drawdown that the short sleeve only partially offsets.",
        tag: "High Relevance",
        action: "Add incremental downside protection before peak storm season.",
      },
      {
        title: "Layer utility volatility hedges against outage-driven earnings misses",
        explanation: "Regulated utilities absorb shocks slowly, so volatility hedges can cushion delayed rate-recovery paths.",
        tag: "Medium Relevance",
      },
    ],
  },
  {
    key: "Rebalancing",
    title: "Rebalancing Suggestions",
    cards: [
      {
        title: "Trim clustered Gulf industrial exposure",
        explanation: "Several holdings share the same physical risk driver despite looking diversified by sector on the surface.",
        tag: "High Relevance",
        action: "Reallocate a portion of capital toward less correlated infrastructure names.",
      },
      {
        title: "Reduce coastal real estate concentration",
        explanation: "Flood-linked property cash flows remain vulnerable to repeated event frequency even after near-term recovery.",
        tag: "Medium Relevance",
      },
    ],
  },
  {
    key: "Opportunistic",
    title: "Opportunistic Signals",
    cards: [
      {
        title: "Watch for dislocation entry points in quality utilities",
        explanation: "Sharp weather-driven selloffs often overprice medium-term balance-sheet stress in high-quality regulated utilities.",
        tag: "Opportunistic",
        action: "Stage a watchlist for post-event mean reversion trades.",
      },
      {
        title: "Screen carbon-tax winners across transition beneficiaries",
        explanation: "Communications infrastructure and lower-emissions operators may rerate faster if transition policy tightens.",
        tag: "Opportunistic",
      },
    ],
  },
];

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

function buildMockAssistantResponse(query: string): AssistantPayload {
  const normalized = query.toLowerCase();

  if (normalized.includes("hurricane exposure")) {
    return {
      summary:
        "Your book shows concentrated hurricane sensitivity in Gulf Coast energy and coastal real estate, with direct loss potential clustering in a handful of names rather than being evenly distributed.",
      insight:
        "Net exposure is driven by CVX, HAL, LYB, SPG, and NEE, while the existing XOM short offsets only part of the gross long loss path.",
      takeaway:
        "The main decision question is whether to hedge the shared Gulf driver more aggressively before the next event window.",
      contexts: [
        { title: "IPCC Coastal Risk excerpt", source: "IPCC AR6", excerpt: "Extreme coastal flood frequency increases materially as storm surge and sea-level pressures compound." },
        { title: "Chevron 10-K excerpt", source: "Chevron FY filing", excerpt: "A meaningful portion of downstream and export infrastructure remains exposed to Gulf Coast weather disruption." },
        { title: "NGFS scenario note", source: "NGFS Phase IV", excerpt: "Physical risk concentration can overwhelm apparent sector diversification in climate-stressed portfolios." },
      ],
    };
  }

  if (normalized.includes("carbon tax")) {
    return {
      summary:
        "Energy and petrochemical holdings carry the heaviest transition burden under a $100/ton carbon-tax path, with valuation pressure extending beyond direct emissions costs.",
      insight:
        "CVX, XOM, and LYB screen as the most policy-sensitive names, while communications infrastructure appears comparatively resilient.",
      takeaway:
        "The practical decision is whether to rotate some carbon-sensitive exposure into transition beneficiaries before policy repricing accelerates.",
      contexts: [
        { title: "NGFS transition excerpt", source: "NGFS Net Zero scenario", excerpt: "Carbon-price shocks tend to compress multiples first, then operating margins as pass-through assumptions are tested." },
        { title: "ExxonMobil 10-K excerpt", source: "ExxonMobil FY filing", excerpt: "Policy and regulatory changes remain a material source of long-dated valuation uncertainty." },
        { title: "Sector transition note", source: "Mock research memo", excerpt: "Integrated energy and chemicals show the largest earnings sensitivity under abrupt carbon policy tightening." },
      ],
    };
  }

  if (normalized.includes("harvey") || normalized.includes("2017")) {
    return {
      summary:
        "Comparable portfolios with Gulf-heavy industrial exposure typically underperformed immediately after Harvey, with recovery dispersion driven by balance-sheet resilience and insurance coverage quality.",
      insight:
        "Drawdowns were deepest where multiple holdings shared the same physical driver, especially across refining, chemicals, and logistics-linked names.",
      takeaway:
        "Historical analogs reinforce that concentration management matters more than broad sector labels in event recovery.",
      contexts: [
        { title: "Historical event brief", source: "Mock event archive", excerpt: "Harvey-era losses persisted longest in names with repeated downtime, weaker coverage, and clustered asset footprints." },
        { title: "Insurance recovery note", source: "Mock broker summary", excerpt: "Balance-sheet strength and claims recovery timing were more important than initial damage estimates." },
        { title: "Portfolio analog memo", source: "Mock PM note", excerpt: "Short hedges helped, but concentrated Gulf exposure still dominated near-term portfolio volatility." },
      ],
    };
  }

  return {
    summary:
      "Contagion risk rises when a core industrial node takes a major hit because adjacent suppliers, logistics, and downstream users can all experience second-order pressure.",
    insight:
      "The portfolio’s vulnerability comes less from one single name and more from the number of exposures tied to the same operating corridor and recovery timeline.",
    takeaway:
      "The decision frame should be whether to hedge the shared driver now or keep dry powder for post-shock dislocation opportunities.",
    contexts: [
      { title: "Supply chain excerpt", source: "Mock contagion note", excerpt: "Shared infrastructure and feedstock dependencies can turn a single-issuer shock into a multi-name portfolio event." },
      { title: "10-K corridor note", source: "Mock filing excerpt", excerpt: "Concentrated corridor exposure increases the probability of synchronized operational disruption." },
      { title: "Stress archive", source: "Mock internal archive", excerpt: "Second-order loss channels often become visible only after the initial event is absorbed by the market." },
    ],
  };
}

function RagAdvisorTab() {
  const [selectedFilter, setSelectedFilter] = useState<RecommendationFilter>("All");
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const filteredGroups = useMemo(() => {
    if (selectedFilter === "All") return RECOMMENDATION_GROUPS;
    return RECOMMENDATION_GROUPS.filter((group) => group.key === selectedFilter);
  }, [selectedFilter]);

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    const assistantPayload = buildMockAssistantResponse(trimmed);

    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", text: trimmed },
      { id: `assistant-${Date.now() + 1}`, role: "assistant", payload: assistantPayload },
    ]);
    setInputValue("");
  };

  return (
    <div className="h-full min-h-0 p-4 sm:p-6">
      <div className="grid h-full min-h-[calc(100vh-6rem)] grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,30%)_minmax(0,70%)]">
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1 no-scrollbar">
          <FadePanel delay={0} className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            {sectionTitle("Suggested Queries")}
            <div className="space-y-3">
              {SUGGESTED_QUERIES.map((query) => (
                <button
                  key={query}
                  type="button"
                  onClick={() => setInputValue(query)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm leading-relaxed text-white/80 transition hover:bg-white/10 hover:text-white"
                >
                  {query}
                </button>
              ))}
            </div>
          </FadePanel>

          <FadePanel delay={100} className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            {sectionTitle("Filters")}
            <div className="flex flex-wrap gap-2">
              {(["All", "Hedging", "Rebalancing", "Opportunistic"] as RecommendationFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setSelectedFilter(filter)}
                  className={`rounded-full border px-3 py-2 text-[11px] font-medium transition ${
                    selectedFilter === filter
                      ? "border-amber-300/40 bg-amber-400/10 text-amber-200"
                      : "border-white/10 bg-white/5 text-white/55 hover:text-white/80"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </FadePanel>

          <FadePanel delay={200} className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            {sectionTitle("Summary")}
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-white/80">
                Scenario: Gulf Coast Hurricane — Cat 4
              </div>
              <div className="flex items-center justify-between text-white/60">
                <span>Holdings impacted</span>
                <span className="text-white">5</span>
              </div>
              <div className="flex items-center justify-between text-white/60">
                <span>Net impact</span>
                <span className="text-white">-$12.4M</span>
              </div>
              <div className="flex items-center justify-between text-white/60">
                <span>Recommendations</span>
                <span className="font-medium text-amber-300">6</span>
              </div>
            </div>
          </FadePanel>
        </div>

        <div className="min-h-0 space-y-4 overflow-y-auto pr-1 no-scrollbar">
          <FadePanel delay={300} className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-md">
            <div className="flex h-[640px] flex-col">
              <div className="border-b border-white/10 px-5 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">Portfolio Copilot</p>
                <p className="mt-1 text-sm text-white/75">Ask about portfolio exposure, climate risk, or company vulnerability</p>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5 no-scrollbar">
                {messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <p className="max-w-md text-base text-white/70">
                      Ask about portfolio exposure, climate risk, or company vulnerability
                    </p>
                    <div className="mt-6 grid w-full max-w-2xl gap-3 md:grid-cols-3">
                      {SUGGESTED_QUERIES.slice(0, 3).map((query) => (
                        <button
                          key={query}
                          type="button"
                          onClick={() => setInputValue(query)}
                          className="rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-left text-sm text-white/75 transition hover:bg-white/10 hover:text-white"
                        >
                          {query}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {messages.map((message) =>
                      message.role === "user" ? (
                        <div key={message.id} className="flex justify-end">
                          <div className="max-w-2xl rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white">
                            <p className="mb-1 text-[10px] uppercase tracking-[0.22em] text-white/35">User</p>
                            {message.text}
                          </div>
                        </div>
                      ) : (
                        <div key={message.id} className="space-y-3">
                          <div className="max-w-3xl rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/80">
                            <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-white/35">Assistant</p>
                            <p className="leading-relaxed text-white/80">{message.payload?.summary}</p>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Portfolio Insight</p>
                                <p className="mt-2 leading-relaxed text-white/70">{message.payload?.insight}</p>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Risk Takeaway</p>
                                <p className="mt-2 leading-relaxed text-white/70">{message.payload?.takeaway}</p>
                              </div>
                            </div>
                          </div>

                          <div>
                            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">Retrieved Context</p>
                            <div className="grid gap-3 md:grid-cols-3">
                              {message.payload?.contexts.map((context) => (
                                <div key={context.title} className="rounded-xl border border-white/10 bg-black/20 p-3">
                                  <p className="text-sm font-medium text-white">{context.title}</p>
                                  <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-amber-300">{context.source}</p>
                                  <p className="mt-2 text-sm leading-relaxed text-white/55">{context.excerpt}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 p-4">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <textarea
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    placeholder="Ask about portfolio exposure, climate risk, or company vulnerability"
                    className="min-h-[96px] w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-white/25"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-white/10 bg-black/20 p-2 text-white/45 transition hover:text-white/70"
                      >
                        <Paperclip size={16} />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-white/10 bg-black/20 p-2 text-white/45 transition hover:text-white/70"
                      >
                        <Mic size={16} />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleSend}
                      className="inline-flex items-center gap-2 rounded-xl border border-amber-300/40 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-400/15"
                    >
                      <SendHorizontal size={15} />
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </FadePanel>

          <FadePanel delay={400} className="rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            {sectionTitle("Actionable Recommendations")}
            <div className="space-y-5">
              {filteredGroups.map((group) => (
                <div key={group.key}>
                  <p className="mb-3 text-sm font-medium text-white">{group.title}</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {group.cards.map((card) => (
                      <div key={card.title} className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-medium leading-snug text-white">{card.title}</p>
                          <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-300">
                            {card.tag}
                          </span>
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-white/55">{card.explanation}</p>
                        {card.action && <p className="mt-3 text-sm text-white/75">{card.action}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </FadePanel>
        </div>
      </div>
    </div>
  );
}

export default RagAdvisorTab;
