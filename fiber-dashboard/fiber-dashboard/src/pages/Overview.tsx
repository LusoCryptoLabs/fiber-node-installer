import { useQuery } from "@tanstack/react-query";
import { Zap, GitFork, Users, AlertCircle, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../api.js";
import { shannonsToCkb } from "../types.js";

function truncate(str: string, len = 12) {
  if (str.length <= len * 2 + 3) return str;
  return `${str.slice(0, len)}…${str.slice(-len)}`;
}

function CopyButton({ text }: { text: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
  };
  return (
    <button onClick={handleCopy} className="btn-ghost text-xs px-2 py-0.5 ml-2" title="Copy">
      Copy
    </button>
  );
}

export default function Overview() {
  const {
    data: nodeInfo,
    isLoading: loadingInfo,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["node-info"],
    queryFn: api.getNodeInfo,
    refetchInterval: 30_000,
  });

  const { data: channelsData, isLoading: loadingChannels } = useQuery({
    queryKey: ["channels"],
    queryFn: api.getChannels,
    refetchInterval: 30_000,
  });

  const { data: peersData } = useQuery({
    queryKey: ["peers"],
    queryFn: api.getPeers,
    refetchInterval: 30_000,
  });

  const channels = channelsData?.channels ?? [];
  const readyChannels = channels.filter((c) => c.state.state_name === "ChannelReady");

  const totalLocal = channels.reduce(
    (sum, ch) => sum + BigInt(ch.local_balance),
    0n
  );
  const totalRemote = channels.reduce(
    (sum, ch) => sum + BigInt(ch.remote_balance),
    0n
  );

  const chartData = readyChannels.slice(0, 10).map((ch, i) => ({
    name: `Ch ${i + 1}`,
    local: Number(BigInt(ch.local_balance) / 100_000_000n),
    remote: Number(BigInt(ch.remote_balance) / 100_000_000n),
  }));

  if (loadingInfo) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <RefreshCw size={20} className="animate-spin mr-2" /> Loading node info…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="card border-accent-red/30">
        <div className="flex items-center gap-3 text-accent-red mb-3">
          <AlertCircle size={20} />
          <span className="font-semibold">Cannot connect to Fiber node</span>
        </div>
        <p className="text-sm text-gray-400">
          Make sure your Fiber node (fnn) is running and the RPC URL is correct.
          Go to{" "}
          <span className="text-accent-green">Settings</span> to change the connection URL.
        </p>
        <button onClick={() => refetch()} className="btn-secondary mt-4 text-sm">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Overview</h1>
        <button
          onClick={() => refetch()}
          className="btn-ghost text-xs flex items-center gap-1"
          data-testid="button-refresh-overview"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {nodeInfo && (
        <div className="card space-y-3">
          <h2 className="section-title">Node Info</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="label">Alias</span>
              <span className="text-white font-medium" data-testid="text-node-alias">
                {nodeInfo.node_name || "(no alias)"}
              </span>
            </div>
            <div>
              <span className="label">Node ID</span>
              <span className="mono text-gray-300 break-all">
                {truncate(nodeInfo.node_id, 16)}
                <CopyButton text={nodeInfo.node_id} />
              </span>
            </div>
            <div className="sm:col-span-2">
              <span className="label">Your Connection Address</span>
              <p className="text-xs text-gray-500 mb-1">
                Share this so others can connect to you and open channels.
              </p>
              {nodeInfo.addresses.length > 0 ? nodeInfo.addresses.map((addr, i) => (
                <div key={i} className="flex items-center gap-1 mb-1">
                  <span className="mono text-xs text-gray-300 break-all">{addr}</span>
                  <CopyButton text={addr} />
                </div>
              )) : (
                <span className="text-xs text-gray-500">No addresses announced</span>
              )}
            </div>
            <div>
              <span className="label">Status</span>
              <span className="badge-green">Online</span>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card" data-testid="stat-open-channels">
          <GitFork size={18} className="text-accent-green" />
          <div className="stat-value">{loadingChannels ? "…" : readyChannels.length}</div>
          <div className="stat-label">Open Channels</div>
        </div>
        <div className="stat-card" data-testid="stat-peers">
          <Users size={18} className="text-accent-blue" />
          <div className="stat-value">{peersData?.peers?.length ?? "…"}</div>
          <div className="stat-label">Connected Peers</div>
        </div>
        <div className="stat-card" data-testid="stat-local-balance">
          <Zap size={18} className="text-accent-amber" />
          <div className="stat-value">{shannonsToCkb(totalLocal.toString())} </div>
          <div className="stat-label">Local Balance (CKB)</div>
        </div>
      </div>

      {readyChannels.length > 0 && (
        <div className="card">
          <h2 className="section-title mb-4">Channel Liquidity (CKB)</h2>
          <div className="text-xs text-gray-500 flex gap-4 mb-3">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-accent-green inline-block" /> Local (outbound)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-accent-blue inline-block" /> Remote (inbound)
            </span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} barGap={2}>
              <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 11 }} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1e1e1e",
                  border: "1px solid #2a2a2a",
                  borderRadius: 6,
                  color: "#e5e7eb",
                }}
                formatter={(v: number) => [`${v} CKB`]}
              />
              <Bar dataKey="local" fill="#22c55e" radius={[3, 3, 0, 0]} />
              <Bar dataKey="remote" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 text-xs text-gray-500">
            Total local: {shannonsToCkb(totalLocal.toString())} CKB &nbsp;·&nbsp;
            Total remote: {shannonsToCkb(totalRemote.toString())} CKB
          </div>
        </div>
      )}

      {channels.length === 0 && !loadingChannels && (
        <div className="card border-dashed border-border/50 text-center py-8">
          <GitFork size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No channels yet.</p>
          <p className="text-gray-500 text-xs mt-1">
            Go to the <span className="text-accent-green">Channels</span> tab to open your first channel.
          </p>
        </div>
      )}
    </div>
  );
}
