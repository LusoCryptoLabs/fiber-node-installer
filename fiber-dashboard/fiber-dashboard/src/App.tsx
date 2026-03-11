import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  GitFork,
  Zap,
  FileText,
  Users,
  Network,
  Wallet,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api } from "./api.js";
import Overview from "./pages/Overview.js";
import Channels from "./pages/Channels.js";
import Payments from "./pages/Payments.js";
import Invoices from "./pages/Invoices.js";
import Peers from "./pages/Peers.js";
import NetworkGraph from "./pages/NetworkGraph.js";
import WalletPage from "./pages/Wallet.js";
import SettingsPage from "./pages/Settings.js";

type TabId =
  | "overview"
  | "channels"
  | "payments"
  | "invoices"
  | "peers"
  | "graph"
  | "wallet"
  | "settings";

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard size={18} /> },
  { id: "channels", label: "Channels", icon: <GitFork size={18} /> },
  { id: "payments", label: "Payments", icon: <Zap size={18} /> },
  { id: "invoices", label: "Invoices", icon: <FileText size={18} /> },
  { id: "peers", label: "Peers", icon: <Users size={18} /> },
  { id: "graph", label: "Network Graph", icon: <Network size={18} /> },
  { id: "wallet", label: "Wallet", icon: <Wallet size={18} /> },
  { id: "settings", label: "Settings", icon: <Settings size={18} /> },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { data: nodeInfo, isError } = useQuery({
    queryKey: ["node-info"],
    queryFn: api.getNodeInfo,
    refetchInterval: 30_000,
    retry: false,
  });

  const isOnline = !isError && !!nodeInfo;

  // 0x92b1... = CKB mainnet (Lina), 0x10639... = CKB testnet (Aggron)
  const MAINNET_CHAIN_HASH =
    "0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5";
  const isMainnet =
    nodeInfo ? nodeInfo.chain_hash === MAINNET_CHAIN_HASH : null;

  function truncatePubkey(key: string) {
    if (key.length <= 16) return key;
    return `${key.slice(0, 8)}…${key.slice(-8)}`;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-gray-200">
      <aside
        className={`flex-shrink-0 flex flex-col bg-bg-surface border-r border-border transition-all duration-200 ${
          sidebarOpen ? "w-52" : "w-16"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <Zap size={20} className="text-accent-green flex-shrink-0" />
              <span className="font-bold text-sm text-white">Fiber Node</span>
            </div>
          )}
          {!sidebarOpen && (
            <Zap size={20} className="text-accent-green mx-auto" />
          )}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="btn-ghost p-1 rounded ml-auto"
            data-testid="button-sidebar-toggle"
          >
            {sidebarOpen ? (
              <ChevronLeft size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
          </button>
        </div>

        <nav className="flex-1 py-3 space-y-0.5 px-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`nav-${tab.id}`}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                activeTab === tab.id
                  ? "bg-accent-green/10 text-accent-green"
                  : "text-gray-400 hover:text-gray-200 hover:bg-bg-hover"
              }`}
              title={!sidebarOpen ? tab.label : undefined}
            >
              <span className="flex-shrink-0">{tab.icon}</span>
              {sidebarOpen && <span>{tab.label}</span>}
            </button>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-border">
          <div
            className={`flex items-center gap-2 ${!sidebarOpen ? "justify-center" : ""}`}
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? "bg-accent-green animate-pulse" : "bg-accent-red"}`}
            />
            {sidebarOpen && (
              <span className="text-xs text-gray-500 truncate">
                {isOnline ? "Online" : "Offline"}
              </span>
            )}
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex-shrink-0 h-14 bg-bg-surface border-b border-border flex items-center px-6 gap-4">
          <div className="flex-1">
            {nodeInfo ? (
              <div className="flex items-center gap-3">
                <span className="font-semibold text-white">
                  {nodeInfo.node_name || "Fiber Node"}
                </span>
                <span className="text-xs text-gray-500 mono hidden sm:block">
                  {truncatePubkey(nodeInfo.node_id)}
                </span>
                <span className="badge-green text-xs">
                  {nodeInfo.channel_count} channels
                </span>
                {isMainnet !== null && (
                  <span className={`badge text-xs ${isMainnet ? "badge-amber" : "badge-blue"}`}>
                    {isMainnet ? "Mainnet" : "Testnet"}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-gray-500 text-sm">
                {isError
                  ? "Cannot connect to Fiber node — check Settings"
                  : "Connecting…"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`badge ${isOnline ? "badge-green" : "badge-red"}`}
              data-testid="status-node-online"
            >
              {isOnline ? "● Online" : "○ Offline"}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {activeTab === "overview" && <Overview />}
          {activeTab === "channels" && <Channels />}
          {activeTab === "payments" && <Payments />}
          {activeTab === "invoices" && <Invoices />}
          {activeTab === "peers" && <Peers />}
          {activeTab === "graph" && <NetworkGraph />}
          {activeTab === "wallet" && <WalletPage />}
          {activeTab === "settings" && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}
