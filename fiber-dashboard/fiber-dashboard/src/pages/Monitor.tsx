import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw,
  HeartPulse,
  Network,
  Droplets,
  TrendingUp,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { api } from "../api.js";
import { evaluateRules, type Alert, type AlertCategory } from "../monitor/rules.js";

// ── Category metadata ───────────────────────────────────────────────────────

const CATEGORIES: {
  key: AlertCategory;
  label: string;
  icon: React.ReactNode;
}[] = [
  { key: "channel", label: "Channel Health", icon: <HeartPulse size={16} /> },
  { key: "connectivity", label: "Connectivity", icon: <Network size={16} /> },
  { key: "liquidity", label: "Liquidity", icon: <Droplets size={16} /> },
  { key: "routing", label: "Routing & Fees", icon: <TrendingUp size={16} /> },
];

// ── Severity helpers ────────────────────────────────────────────────────────

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

function SeverityIcon({ severity }: { severity: Alert["severity"] }) {
  switch (severity) {
    case "critical":
      return <AlertTriangle size={15} className="text-accent-red flex-shrink-0" />;
    case "warning":
      return <AlertCircle size={15} className="text-accent-amber flex-shrink-0" />;
    case "info":
      return <CheckCircle size={15} className="text-accent-green flex-shrink-0" />;
  }
}

function severityBorder(severity: Alert["severity"]): string {
  switch (severity) {
    case "critical":
      return "border-l-accent-red";
    case "warning":
      return "border-l-accent-amber";
    case "info":
      return "border-l-accent-green";
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export default function Monitor() {
  const { data: nodeInfo, isError, dataUpdatedAt: nodeUpdatedAt } = useQuery({
    queryKey: ["node-info"],
    queryFn: api.getNodeInfo,
    refetchInterval: 30_000,
    retry: false,
  });

  const { data: channelsData, dataUpdatedAt: chUpdatedAt } = useQuery({
    queryKey: ["channels"],
    queryFn: api.getChannels,
    refetchInterval: 30_000,
  });

  const { data: peersData, dataUpdatedAt: peersUpdatedAt } = useQuery({
    queryKey: ["peers"],
    queryFn: api.getPeers,
    refetchInterval: 30_000,
  });

  const { data: healthData, refetch } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 60_000,
  });

  const lastUpdated = Math.max(nodeUpdatedAt || 0, chUpdatedAt || 0, peersUpdatedAt || 0);

  // Evaluate rules against current data
  const alerts = evaluateRules({
    nodeInfo,
    channels: channelsData?.channels ?? [],
    peers: peersData?.peers ?? [],
    health: healthData,
  });

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const infoCount = alerts.filter((a) => a.severity === "info").length;

  if (isError) {
    return (
      <div className="card border-accent-red/30">
        <div className="flex items-center gap-3 text-accent-red mb-3">
          <AlertTriangle size={20} />
          <span className="font-semibold">Cannot connect to Fiber node</span>
        </div>
        <p className="text-sm text-text-secondary">
          Make sure your Fiber node is running and the RPC URL is correct.
        </p>
        <button onClick={() => refetch()} className="btn-secondary mt-4 text-sm">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-text-primary">Monitor</h1>
          <span className="flex items-center gap-1.5 text-xs text-accent-green">
            <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
            Live
          </span>
        </div>
        <button
          onClick={() => refetch()}
          className="btn-ghost text-xs flex items-center gap-1"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-4 text-sm">
        {criticalCount > 0 && (
          <span className="flex items-center gap-1.5 text-accent-red font-medium">
            <AlertTriangle size={14} />
            {criticalCount} critical
          </span>
        )}
        {warningCount > 0 && (
          <span className="flex items-center gap-1.5 text-accent-amber font-medium">
            <AlertCircle size={14} />
            {warningCount} warning{warningCount > 1 ? "s" : ""}
          </span>
        )}
        {criticalCount === 0 && warningCount === 0 && (
          <span className="flex items-center gap-1.5 text-accent-green font-medium">
            <CheckCircle size={14} />
            All systems healthy
          </span>
        )}
        <span className="text-text-muted">|</span>
        <span className="text-text-muted">{infoCount} info</span>
      </div>

      {/* Category sections */}
      {CATEGORIES.map((cat) => {
        const catAlerts = alerts
          .filter((a) => a.category === cat.key)
          .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

        if (catAlerts.length === 0) return null;

        return (
          <div key={cat.key} className="card">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-text-secondary">{cat.icon}</span>
              <h2 className="section-title mb-0">{cat.label}</h2>
            </div>
            <div className="space-y-2">
              {catAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 p-3 rounded-md bg-bg-surface border-l-2 ${severityBorder(alert.severity)}`}
                >
                  <SeverityIcon severity={alert.severity} />
                  <div className="min-w-0">
                    <div className="text-sm text-text-primary font-medium">{alert.title}</div>
                    <div className="text-xs text-text-secondary mt-0.5">{alert.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Footer */}
      <div className="text-xs text-text-muted text-center">
        {lastUpdated > 0 && (
          <>Last updated: {new Date(lastUpdated).toLocaleTimeString()} &middot; </>
        )}
        Auto-refreshes every 30s
      </div>
    </div>
  );
}
