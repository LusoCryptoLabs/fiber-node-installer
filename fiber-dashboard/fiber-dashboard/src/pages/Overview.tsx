import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap, GitFork, Users, AlertCircle, RefreshCw, TrendingUp, Activity, RotateCcw, Rocket, ArrowRight } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../api.js";
import { shannonsToCkb } from "../types.js";
import { useBalanceTracker } from "../hooks/useBalanceTracker.js";

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

function fmtUptime(startedAt: number): string {
  const ms = Date.now() - startedAt;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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

  const { data: healthData } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 60_000,
  });

  const channels = channelsData?.channels ?? [];
  const readyChannels = channels.filter((c: any) =>
    c.state.state_name.toUpperCase().replace(/[^A-Z]/g, "") === "CHANNELREADY"
  );

  // Fee rate: the millionths of the payment amount your node earns per hop it forwards.
  // e.g. 100 ppm = 0.01% = earn 1 CKB for every 10,000 CKB routed.
  const feeRatePpm = nodeInfo
    ? Number(BigInt(nodeInfo.tlc_fee_proportional_millionths || "0x0"))
    : 0;
  const feeRatePct = (feeRatePpm / 10_000).toFixed(4);

  function fmtEarned(volumeCkb: number): string {
    const earned = (volumeCkb * feeRatePpm) / 1_000_000;
    if (earned < 0.0001) return "< 0.0001";
    if (earned < 1) return earned.toFixed(4);
    return earned.toFixed(2);
  }

  const totalLocal = channels.reduce(
    (sum, ch) => sum + BigInt(ch.local_balance),
    0n
  );
  const totalRemote = channels.reduce(
    (sum, ch) => sum + BigInt(ch.remote_balance),
    0n
  );

  // Balance history & fee tracking
  const { history, feeLog, resetFeeTracking, loaded: trackerLoaded } = useBalanceTracker(channels);

  const chartData = readyChannels.slice(0, 10).map((ch, i) => ({
    name: `Ch ${i + 1}`,
    local: Number(BigInt(ch.local_balance) / 100_000_000n),
    remote: Number(BigInt(ch.remote_balance) / 100_000_000n),
  }));

  if (loadingInfo) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted">
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
        <p className="text-sm text-text-secondary">
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
        <h1 className="text-xl font-bold text-text-primary">Overview</h1>
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
              <span className="text-text-primary font-medium" data-testid="text-node-alias">
                {nodeInfo.node_name || "(no alias)"}
              </span>
            </div>
            <div>
              <span className="label">Node ID</span>
              <span className="mono text-text-primary break-all">
                {truncate(nodeInfo.node_id, 16)}
                <CopyButton text={nodeInfo.node_id} />
              </span>
            </div>
            <div className="sm:col-span-2">
              <span className="label">Your Connection Address</span>
              <p className="text-xs text-text-muted mb-1">
                Share this so others can connect to you and open channels.
              </p>
              {nodeInfo.addresses.length > 0 ? nodeInfo.addresses.map((addr, i) => (
                <div key={i} className="flex items-center gap-1 mb-1">
                  <span className="mono text-xs text-text-primary break-all">{addr}</span>
                  <CopyButton text={addr} />
                </div>
              )) : (
                <span className="text-xs text-text-muted">No addresses announced</span>
              )}
            </div>
            <div>
              <span className="label">Status</span>
              <span className="badge-green">Online</span>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
          <div className="stat-value">{shannonsToCkb(totalLocal.toString())}</div>
          <div className="stat-label">Local Balance (CKB)</div>
        </div>
        <div className="stat-card" data-testid="stat-uptime">
          <Activity size={18} className="text-accent-green" />
          <div className="stat-value text-sm">
            {healthData?.startedAt ? fmtUptime(healthData.startedAt) : "…"}
          </div>
          <div className="stat-label">Uptime</div>
        </div>
      </div>

      {readyChannels.length > 0 && (
        <div className="card">
          <h2 className="section-title mb-4">Channel Liquidity (CKB)</h2>
          <div className="text-xs text-text-muted flex gap-4 mb-3">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-accent-green inline-block" /> Local (outbound)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-accent-blue inline-block" /> Remote (inbound)
            </span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} barGap={2}>
              <XAxis dataKey="name" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
              <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                  color: "var(--color-text-primary)",
                }}
                formatter={(v: number) => [`${v} CKB`]}
              />
              <Bar dataKey="local" fill="#22c55e" radius={[3, 3, 0, 0]} />
              <Bar dataKey="remote" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 text-xs text-text-muted">
            Total local: {shannonsToCkb(totalLocal.toString())} CKB &nbsp;·&nbsp;
            Total remote: {shannonsToCkb(totalRemote.toString())} CKB
          </div>
        </div>
      )}

      {/* Balance History Chart */}
      {trackerLoaded && history.snapshots.length > 1 && (
        <div className="card">
          <h2 className="section-title mb-4">Balance History</h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart
              data={history.snapshots.map((s) => ({
                time: s.ts,
                balance: Number(BigInt(s.totalLocal) / 100_000_000n),
              }))}
            >
              <defs>
                <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-accent-green)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--color-accent-green)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tickFormatter={(ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
              />
              <YAxis
                tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                  color: "var(--color-text-primary)",
                }}
                labelFormatter={(ts) => new Date(ts as number).toLocaleString()}
                formatter={(v: number) => [`${v} CKB`, "Local Balance"]}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="var(--color-accent-green)"
                fill="url(#balGrad)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-xs text-text-muted mt-2">
            Snapshots every 5 min or on balance change. Last 7 days shown. ({history.snapshots.length} points)
          </p>
        </div>
      )}

      {nodeInfo && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={16} className="text-accent-green" />
            <h2 className="section-title mb-0">Routing Income</h2>
          </div>

          {/* Inferred fee earnings */}
          <div className="bg-bg-surface rounded-md p-3 mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="label mb-0">Inferred routing fees earned</span>
              <button
                onClick={resetFeeTracking}
                className="btn-ghost text-xs flex items-center gap-1"
                title="Reset fee tracking"
              >
                <RotateCcw size={11} /> Reset
              </button>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-semibold text-accent-green">
                +{shannonsToCkb(feeLog.totalEarned)}
              </span>
              <span className="text-xs text-text-muted">CKB</span>
            </div>
            <p className="text-xs text-text-muted mt-1">
              {feeLog.events.length} fee event{feeLog.events.length !== 1 ? "s" : ""} detected · balance increases when channel set is unchanged
            </p>
          </div>

          {/* Fee events log */}
          {feeLog.events.length > 0 && (
            <div className="max-h-48 overflow-y-auto mb-4 border border-border/30 rounded-md">
              {feeLog.events.map((ev, i) => (
                <div
                  key={`${ev.ts}-${i}`}
                  className="flex items-center justify-between text-xs px-3 py-2 border-b border-border/20 last:border-b-0"
                >
                  <span className="text-text-muted">
                    {new Date(ev.ts).toLocaleString()}
                  </span>
                  <span className="text-accent-green font-medium">
                    +{shannonsToCkb(ev.amount)} CKB
                  </span>
                  <span className="text-text-muted">
                    {ev.channelsChanged.length} ch
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-text-secondary mb-4">
            Your node earns a fee on every payment it forwards to another peer. The fee is a
            percentage of the payment amount, set by your fee rate below.
          </p>
          <div className="flex flex-wrap gap-6 mb-4">
            <div>
              <span className="label">Your fee rate</span>
              <span className="text-text-primary font-semibold text-lg">{feeRatePpm} ppm</span>
              <span className="text-text-muted text-xs ml-2">({feeRatePct}%)</span>
            </div>
            <div>
              <span className="label">Earning formula</span>
              <span className="text-text-primary text-sm">
                Earned CKB = Volume routed × {feeRatePpm} ÷ 1,000,000
              </span>
            </div>
          </div>
          {feeRatePpm > 0 ? (
            <div>
              <p className="text-xs text-text-muted mb-2">Estimated earnings at different volumes:</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted text-xs border-b border-border">
                    <th className="pb-1 font-normal">CKB routed through your node</th>
                    <th className="pb-1 font-normal text-right">You earn</th>
                  </tr>
                </thead>
                <tbody className="text-text-primary">
                  {[1_000, 10_000, 100_000, 1_000_000].map((vol) => (
                    <tr key={vol} className="border-b border-border/30">
                      <td className="py-1.5">{vol.toLocaleString()} CKB</td>
                      <td className="py-1.5 text-right text-accent-green font-medium">
                        {fmtEarned(vol)} CKB
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-text-muted mt-3">
                Note: Fiber {nodeInfo.node_name ? `(${nodeInfo.node_name})` : ""} does not yet expose
                a cumulative fee counter. Income accumulates passively as traffic flows through your
                channels — the more open channels and liquidity you have, the more you earn.
              </p>
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              Fee rate is 0 ppm — your node forwards payments for free. Go to{" "}
              <span className="text-accent-green">Channels → Update</span> to set a fee rate.
            </p>
          )}
        </div>
      )}

      {channels.length === 0 && !loadingChannels && nodeInfo && (
        <div className="card border-dashed border-accent-green/30">
          <div className="flex items-center gap-2 mb-4">
            <Rocket size={18} className="text-accent-green" />
            <h2 className="section-title mb-0">Getting Started</h2>
          </div>
          <p className="text-sm text-text-secondary mb-4">
            Your node is online but not yet transacting. Follow these steps to join the Fiber network:
          </p>
          <div className="space-y-3">
            {[
              {
                step: 1,
                title: "Fund your wallet",
                detail: "Send testnet CKB to your node's address (shown above). You need at least 99 CKB per channel.",
                done: false,
              },
              {
                step: 2,
                title: "Connect to a peer",
                detail: "Go to the Peers tab and connect to a bootnode or another operator's node.",
                done: (peersData?.peers?.length ?? 0) > 0,
              },
              {
                step: 3,
                title: "Open a channel",
                detail: "Go to the Channels tab, pick a connected peer, and open a channel with at least 99 CKB.",
                done: false,
              },
              {
                step: 4,
                title: "Set a fee rate",
                detail: "In Channels, click Update on your channel to set a fee rate (e.g. 100 ppm) and start earning routing fees.",
                done: feeRatePpm > 0,
              },
            ].map((s) => (
              <div
                key={s.step}
                className={`flex items-start gap-3 p-3 rounded-md ${
                  s.done ? "alert-green" : "bg-bg-surface"
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    s.done
                      ? "bg-accent-green text-black"
                      : "bg-bg-hover text-text-secondary border border-border"
                  }`}
                >
                  {s.done ? "\u2713" : s.step}
                </span>
                <div>
                  <div className={`text-sm font-medium ${s.done ? "text-accent-green" : "text-text-primary"}`}>
                    {s.title}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
