import { useEffect, useMemo, useState } from "react";
import { Mic, Paperclip, SendHorizontal, Loader2 } from "lucide-react";

type RecommendationFilter = "All" | "Hedging" | "Rebalancing" | "Opportunistic";

const API_BASE_URL = "http://localhost:8000";

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
  "What's the contagion risk if Valero takes a major hit?",
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

async function queryRAGBackend(query: string): Promise<{ response: string; sources: string[] }> {
  const response = await fetch(`${API_BASE_URL}/api/chat/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: query }),
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  
  return response.json();
}

function parseRAGResponse(response: string, sources: string[]): AssistantPayload {
  const paragraphs = response.split("\n\n").filter(p => p.trim());
  
  const summary = paragraphs[0] || response;
  const insight = paragraphs.length > 1 ? paragraphs[1] : "See the full analysis above for detailed insights.";
  const takeaway = paragraphs.length > 2 ? paragraphs[2] : "Consider these climate risk factors when making portfolio decisions.";
  
  const contexts: RetrievedContext[] = sources
    .filter(s => s !== "error" && s !== "direct_llm_response")
    .map((source, idx) => ({
      title: `Source ${idx + 1}`,
      source: source,
      excerpt: `Retrieved from ${source} knowledge base`,
    }));
  
  if (contexts.length === 0) {
    contexts.push({
      title: "AI Analysis",
      source: "Llama 3.3 70B",
      excerpt: "Response generated using climate risk knowledge base",
    });
  }
  
  return { summary, insight, takeaway, contexts };
}

function RagAdvisorTab() {
  const [selectedFilter, setSelectedFilter] = useState<RecommendationFilter>("All");
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const filteredGroups = useMemo(() => {
    if (selectedFilter === "All") return RECOMMENDATION_GROUPS;
    return RECOMMENDATION_GROUPS.filter((group) => group.key === selectedFilter);
  }, [selectedFilter]);

  const handleSend = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading) return;

    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", text: trimmed },
    ]);
    setInputValue("");
    setIsLoading(true);

    try {
      const result = await queryRAGBackend(trimmed);
      const assistantPayload = parseRAGResponse(result.response, result.sources);
      
      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: "assistant", payload: assistantPayload },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { 
          id: `assistant-${Date.now()}`, 
          role: "assistant", 
          payload: {
            summary: "Unable to connect to the AI assistant. Please ensure the backend server is running on http://localhost:8000",
            insight: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            takeaway: "Try refreshing the page or check if the backend server is running.",
            contexts: [{ title: "Error", source: "System", excerpt: "Connection failed" }],
          }
        },
      ]);
    } finally {
      setIsLoading(false);
    }
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
                            <p className="leading-relaxed text-white/80 whitespace-pre-wrap">{message.payload?.summary}</p>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Portfolio Insight</p>
                                <p className="mt-2 leading-relaxed text-white/70 whitespace-pre-wrap">{message.payload?.insight}</p>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Risk Takeaway</p>
                                <p className="mt-2 leading-relaxed text-white/70 whitespace-pre-wrap">{message.payload?.takeaway}</p>
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
                    {isLoading && (
                      <div className="flex items-center gap-3 text-white/60">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-sm">Analyzing with AI...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 p-4">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <textarea
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Ask about portfolio exposure, climate risk, or company vulnerability"
                    className="min-h-[96px] w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-white/25"
                    disabled={isLoading}
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
                      disabled={isLoading || !inputValue.trim()}
                      className="inline-flex items-center gap-2 rounded-xl border border-amber-300/40 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-400/15 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLoading ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <SendHorizontal size={15} />
                      )}
                      {isLoading ? "Analyzing..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </FadePanel>

        </div>
      </div>
    </div>
  );
}

export default RagAdvisorTab;
