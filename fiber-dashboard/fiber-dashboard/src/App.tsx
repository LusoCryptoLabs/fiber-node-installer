import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Activity,
  GitFork,
  Zap,
  FileText,
  Users,
  Network,
  Wallet,
  Settings,
  ChevronLeft,
  ChevronRight,
  Menu,
  ArrowUpCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { api } from "./api.js";
import { evaluateRules } from "./monitor/rules.js";
import Monitor from "./pages/Monitor.js";
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
  | "monitor"
  | "channels"
  | "payments"
  | "invoices"
  | "peers"
  | "graph"
  | "wallet"
  | "settings";

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard size={18} /> },
  { id: "monitor", label: "Monitor", icon: <Activity size={18} /> },
  { id: "channels", label: "Channels", icon: <GitFork size={18} /> },
  { id: "payments", label: "Payments", icon: <Zap size={18} /> },
  { id: "invoices", label: "Invoices", icon: <FileText size={18} /> },
  { id: "peers", label: "Peers", icon: <Users size={18} /> },
  { id: "graph", label: "Network Graph", icon: <Network size={18} /> },
  { id: "wallet", label: "Wallet", icon: <Wallet size={18} /> },
  { id: "settings", label: "Settings", icon: <Settings size={18} /> },
];

const validTabs = new Set<string>(tabs.map((t) => t.id));

function loadTab(): TabId {
  const stored = localStorage.getItem("fiber_active_tab");
  return stored && validTabs.has(stored) ? (stored as TabId) : "overview";
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>(loadTab);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: nodeInfo, isError } = useQuery({
    queryKey: ["node-info"],
    queryFn: api.getNodeInfo,
    refetchInterval: 30_000,
    retry: false,
  });

  const { data: channelsData } = useQuery({
    queryKey: ["channels"],
    queryFn: api.getChannels,
    refetchInterval: 30_000,
  });

  const { data: peersData } = useQuery({
    queryKey: ["peers"],
    queryFn: api.getPeers,
    refetchInterval: 30_000,
  });

  const { data: healthData } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 60_000,
  });

  const { data: versionData } = useQuery({
    queryKey: ["version-check"],
    queryFn: api.checkVersion,
    refetchInterval: 30 * 60 * 1000,
    staleTime: 10 * 60 * 1000,
  });

  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);

  const updateMut = useMutation({
    mutationFn: () => api.triggerUpdate(),
    onSuccess: () => setUpdating(true),
  });

  const isOnline = !isError && !!nodeInfo;

  // Monitor alert badge
  const alertCounts = useMemo(() => {
    const alerts = evaluateRules({
      nodeInfo,
      channels: channelsData?.channels ?? [],
      peers: peersData?.peers ?? [],
      health: healthData,
    });
    return {
      critical: alerts.filter((a) => a.severity === "critical").length,
      warning: alerts.filter((a) => a.severity === "warning").length,
    };
  }, [nodeInfo, channelsData, peersData, healthData]);

  // 0x92b1... = CKB mainnet (Lina), 0x10639... = CKB testnet (Aggron)
  const MAINNET_CHAIN_HASH =
    "0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5";
  const isMainnet =
    nodeInfo ? nodeInfo.chain_hash === MAINNET_CHAIN_HASH : null;

  function truncatePubkey(key: string) {
    if (key.length <= 16) return key;
    return `${key.slice(0, 8)}…${key.slice(-8)}`;
  }

  const monitorBadge = alertCounts.critical > 0
    ? "bg-accent-red"
    : alertCounts.warning > 0
      ? "bg-accent-amber"
      : null;

  function handleTabClick(id: TabId) {
    setActiveTab(id);
    localStorage.setItem("fiber_active_tab", id);
    setMobileMenuOpen(false);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg" style={{ color: "var(--color-text-primary)" }}>
      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside
        className={`flex-shrink-0 flex flex-col bg-bg-surface border-r border-border transition-all duration-200
          ${sidebarOpen ? "w-52" : "w-16"}
          max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-52
          ${mobileMenuOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"}
        `}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <Zap size={20} className="text-accent-green flex-shrink-0" />
              <span className="font-bold text-sm text-text-primary">Fiber Node</span>
            </div>
          )}
          {!sidebarOpen && (
            <Zap size={20} className="text-accent-green mx-auto" />
          )}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="btn-ghost p-1 rounded ml-auto hidden md:block"
            data-testid="button-sidebar-toggle"
          >
            {sidebarOpen ? (
              <ChevronLeft size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
          </button>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="btn-ghost p-1 rounded ml-auto md:hidden"
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              data-testid={`nav-${tab.id}`}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors relative ${
                activeTab === tab.id
                  ? "bg-accent-green/10 text-accent-green"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              }`}
              title={!sidebarOpen ? tab.label : undefined}
            >
              <span className="flex-shrink-0 relative">
                {tab.icon}
                {tab.id === "monitor" && monitorBadge && (
                  <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ${monitorBadge} ring-2 ring-bg-surface`} />
                )}
                {tab.id === "settings" && versionData?.updateAvailable && !updateDismissed && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-accent-green ring-2 ring-bg-surface" />
                )}
              </span>
              {(sidebarOpen || mobileMenuOpen) && (
                <span className="flex-1">{tab.label}</span>
              )}
              {(sidebarOpen || mobileMenuOpen) && tab.id === "monitor" && monitorBadge && (
                <span className={`text-xs font-medium ${alertCounts.critical > 0 ? "text-accent-red" : "text-accent-amber"}`}>
                  {alertCounts.critical + alertCounts.warning}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-border">
          <div
            className={`flex items-center gap-2 ${!sidebarOpen && !mobileMenuOpen ? "justify-center" : ""}`}
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? "bg-accent-green animate-pulse" : "bg-accent-red"}`}
            />
            {(sidebarOpen || mobileMenuOpen) && (
              <span className="text-xs text-text-muted truncate">
                {isOnline ? "Online" : "Offline"}
              </span>
            )}
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex-shrink-0 h-14 bg-bg-surface border-b border-border flex items-center px-4 md:px-6 gap-3 md:gap-4">
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="btn-ghost p-1.5 rounded md:hidden flex-shrink-0"
          >
            <Menu size={20} />
          </button>
          <div className="flex-1 min-w-0">
            {nodeInfo ? (
              <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                <span className="font-semibold text-text-primary truncate">
                  {nodeInfo.node_name || "Fiber Node"}
                </span>
                <span className="text-xs text-text-muted mono hidden md:block">
                  {truncatePubkey(nodeInfo.node_id)}
                </span>
                <span className="badge-green text-xs hidden sm:inline-flex">
                  {nodeInfo.channel_count} channels
                </span>
                {isMainnet !== null && (
                  <span className={`badge text-xs ${isMainnet ? "badge-amber" : "badge-blue"}`}>
                    {isMainnet ? "Mainnet" : "Testnet"}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-text-muted text-sm">
                {isError
                  ? "Cannot connect — check Settings"
                  : "Connecting…"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className={`badge ${isOnline ? "badge-green" : "badge-red"}`}
              data-testid="status-node-online"
            >
              {isOnline ? "● Online" : "○ Offline"}
            </span>
          </div>
        </header>

        {updating && (
          <div className="flex-shrink-0 bg-accent-blue/10 border-b border-accent-blue/20 px-4 md:px-6 py-2 flex items-center gap-3">
            <RefreshCw size={16} className="text-accent-blue animate-spin flex-shrink-0" />
            <span className="text-sm text-text-secondary">
              Updating to <span className="font-medium text-text-primary">{versionData?.latest}</span>… The dashboard will restart automatically. Refresh this page in a few seconds.
            </span>
          </div>
        )}

        {versionData?.updateAvailable && !updateDismissed && !updating && (
          <div className="flex-shrink-0 bg-accent-green/10 border-b border-accent-green/20 px-4 md:px-6 py-2 flex items-center gap-3">
            <ArrowUpCircle size={16} className="text-accent-green flex-shrink-0" />
            <span className="text-sm text-text-secondary flex-1">
              <span className="font-medium text-text-primary">{versionData.latest}</span> is available.
            </span>
            <button
              onClick={() => updateMut.mutate()}
              disabled={updateMut.isPending}
              className="btn-primary text-xs px-3 py-1 flex items-center gap-1.5 flex-shrink-0"
            >
              <ArrowUpCircle size={13} />
              {updateMut.isPending ? "Starting…" : "Update Now"}
            </button>
            <button
              onClick={() => handleTabClick("settings")}
              className="text-xs text-accent-green hover:text-green-300 flex-shrink-0"
            >
              Details
            </button>
            <button
              onClick={() => setUpdateDismissed(true)}
              className="btn-ghost p-1 rounded flex-shrink-0 text-text-muted hover:text-text-secondary"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {activeTab === "overview" && <Overview />}
          {activeTab === "monitor" && <Monitor />}
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
