import { useState } from "react";
import { useNavigate } from "react-router-dom";
import PortfolioDashboard from "@/components/PortfolioDashboard";
import ContagionNetworkTab from "@/components/ContagionNetwork";

interface DashboardProps {
  platformName: string;
}

interface TabConfig {
  id: string;
  label: string;
  description: string;
}

const TABS: TabConfig[] = [
  {
    id: "portfolio",
    label: "Portfolio Dashboard",
    description:
      "Your morning briefing — portfolio climate risk score, top exposures, and hedge adequacy",
  },
  {
    id: "contagion",
    label: "Contagion Network",
    description:
      "Visualize how climate events cascade through interconnected portfolio holdings",
  },
  {
    id: "heatmap",
    label: "Risk Heatmap",
    description:
      "Map physical asset exposure across FEMA flood zones, wildfire corridors, and hurricane tracks",
  },
  {
    id: "stress",
    label: "Stress Tester",
    description:
      "Simulate climate events and measure financial impact across your entire book",
  },
  {
    id: "advisor",
    label: "AI Assistant",
    description:
      "Query your portfolio risk in natural language powered by RAG over climate and financial data",
  },
];

function Dashboard({ platformName }: DashboardProps) {
  const [activeTab, setActiveTab] = useState("portfolio");
  const navigate = useNavigate();

  const current = TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="relative z-10 min-h-screen flex flex-col">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-black/40 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center h-14 gap-6">
          {/* Logo — click to go back to landing */}
          <button
            onClick={() => navigate("/")}
            className="text-base font-bold text-white tracking-tight shrink-0 cursor-pointer
                       hover:opacity-80 transition-opacity"
          >
            {platformName}
          </button>

          {/* Divider */}
          <div className="w-px h-5 bg-white/10 hidden sm:block" />

          {/* Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`whitespace-nowrap px-3.5 py-1.5 rounded-lg text-xs font-medium
                    transition-all duration-200 cursor-pointer
                    ${
                      isActive
                        ? "bg-white/[0.12] text-white shadow-sm"
                        : "text-white/40 hover:text-white/70 hover:bg-white/[0.05]"
                    }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Content */}
      {activeTab === "portfolio" ? (
        <main className="flex-1">
          <PortfolioDashboard />
        </main>
      ) : activeTab === "contagion" ? (
        <main className="flex-1">
          <ContagionNetworkTab />
        </main>
      ) : (
        <main className="flex-1 flex items-center justify-center p-6">
          <div
            key={current.id}
            className="relative w-full max-w-2xl rounded-2xl
                       bg-black/40 backdrop-blur-xl border border-white/[0.08]
                       p-10 md:p-16 text-center
                       animate-in"
          >
            {/* Coming Soon badge */}
            <span className="absolute top-5 right-5 px-2.5 py-1 rounded-full
                             text-[10px] font-semibold uppercase tracking-widest
                             bg-white/[0.06] text-white/30 border border-white/[0.06]">
              Coming Soon
            </span>

            <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">
              {current.label}
            </h2>

            <p className="text-sm md:text-base text-white/40 leading-relaxed max-w-md mx-auto">
              {current.description}
            </p>
          </div>
        </main>
      )}
    </div>
  );
}

export default Dashboard;
