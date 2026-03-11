import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GitFork, Plus, RefreshCw, X } from "lucide-react";
import { api } from "../api.js";
import { shannonsToCkb } from "../types.js";
import type { Channel, ChannelState } from "../types.js";
import { OpenChannelModal } from "../components/OpenChannelModal.js";

function stateBadge(state: ChannelState) {
  switch (state) {
    case "ChannelReady":
      return <span className="badge-green">Ready</span>;
    case "ShuttingDown":
      return <span className="badge-amber">Closing</span>;
    case "Closed":
      return <span className="badge-grey">Closed</span>;
    case "NegotiatingFunding":
    case "CollaboratingFundingTx":
    case "SigningCommitment":
    case "AwaitingTxSignatures":
    case "AwaitingChannelReady":
      return <span className="badge-blue">Opening</span>;
    default:
      return <span className="badge-grey">{state}</span>;
  }
}

function CapacityBar({ local, remote }: { local: bigint; remote: bigint }) {
  const total = local + remote;
  if (total === 0n) return <div className="w-full h-2 bg-bg-surface rounded" />;
  const localPct = Number((local * 100n) / total);
  return (
    <div className="w-full h-2 bg-bg-surface rounded overflow-hidden" title={`Local: ${localPct}%`}>
      <div
        className="h-full bg-accent-green transition-all"
        style={{ width: `${localPct}%` }}
      />
    </div>
  );
}


function CloseChannelModal({
  channel,
  onClose,
}: {
  channel: Channel;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [force, setForce] = useState(false);

  const closeMut = useMutation({
    mutationFn: () =>
      api.closeChannel({
        channel_id: channel.channel_id,
        close_script: null,
        fee_rate: "0x3FC",
        force,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels"] });
      onClose();
    },
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Close Channel</h2>
          <button onClick={onClose} className="btn-ghost p-1">
            <X size={18} />
          </button>
        </div>

        <div className="bg-amber-900/20 border border-amber-800/50 rounded-md p-3 mb-4 text-sm text-amber-400">
          Closing a channel requires an on-chain CKB transaction. This takes ~30 seconds for cooperative close, or up to several hours for force close.
        </div>

        <div className="text-sm text-gray-400 mb-4 space-y-1">
          <div>Channel: <span className="mono">{channel.channel_id.slice(0, 20)}…</span></div>
          <div>Local balance: <span className="text-white">{shannonsToCkb(channel.local_balance)} CKB</span></div>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <input
            type="checkbox"
            id="force-close"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="w-4 h-4"
            data-testid="input-force-close"
          />
          <label htmlFor="force-close" className="text-sm text-gray-300">
            Force close (use only if peer is unresponsive — much slower)
          </label>
        </div>

        {closeMut.isError && (
          <div className="bg-red-900/20 border border-red-800/50 rounded-md p-3 mb-4 text-sm text-red-400">
            {(closeMut.error as Error).message}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button
            onClick={() => closeMut.mutate()}
            disabled={closeMut.isPending}
            className="btn-danger flex-1"
            data-testid="button-close-channel-submit"
          >
            {closeMut.isPending ? "Closing…" : force ? "Force Close" : "Close Channel"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Channels() {
  const qc = useQueryClient();
  const [showOpen, setShowOpen] = useState(false);
  const [closingChannel, setClosingChannel] = useState<Channel | null>(null);
  const [filterState, setFilterState] = useState<string>("all");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["channels"],
    queryFn: api.getChannels,
    refetchInterval: 15_000,
  });

  const channels = data?.channels ?? [];
  const filtered =
    filterState === "all"
      ? channels
      : channels.filter((ch) => ch.state.state_name === filterState);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Channels</h1>
        <div className="flex gap-2">
          <button onClick={() => refetch()} className="btn-ghost text-xs flex items-center gap-1">
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            onClick={() => setShowOpen(true)}
            className="btn-primary flex items-center gap-1.5"
            data-testid="button-open-channel"
          >
            <Plus size={15} /> Open Channel
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["all", "ChannelReady", "NegotiatingFunding", "ShuttingDown", "Closed"].map((s) => (
          <button
            key={s}
            onClick={() => setFilterState(s)}
            className={`btn text-xs px-3 py-1.5 ${filterState === s ? "btn-primary" : "btn-secondary"}`}
            data-testid={`filter-channel-${s}`}
          >
            {s === "all" ? "All" : s === "ChannelReady" ? "Ready" : s === "NegotiatingFunding" ? "Opening" : s === "ShuttingDown" ? "Closing" : s}
            {s !== "all" && (
              <span className="ml-1.5 text-gray-400">
                ({channels.filter((c) => c.state.state_name === s).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-gray-500">
          <RefreshCw size={20} className="animate-spin mr-2" /> Loading channels…
        </div>
      ) : filtered.length === 0 ? (
        <div className="card border-dashed border-border/50 text-center py-12">
          <GitFork size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No channels found.</p>
          <button onClick={() => setShowOpen(true)} className="btn-primary mt-4 text-sm">
            Open Your First Channel
          </button>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Channel ID</th>
                  <th>Peer</th>
                  <th>State</th>
                  <th>Local (CKB)</th>
                  <th>Remote (CKB)</th>
                  <th>Balance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ch) => {
                  const local = BigInt(ch.local_balance);
                  const remote = BigInt(ch.remote_balance);
                  return (
                    <tr key={ch.channel_id} data-testid={`row-channel-${ch.channel_id.slice(0, 8)}`}>
                      <td>
                        <span className="mono text-xs">
                          {ch.channel_id.slice(0, 10)}…
                        </span>
                      </td>
                      <td>
                        <span className="mono text-xs">
                          {ch.peer_id.slice(0, 10)}…
                        </span>
                      </td>
                      <td>{stateBadge(ch.state.state_name)}</td>
                      <td className="text-accent-green">{shannonsToCkb(local.toString())}</td>
                      <td className="text-accent-blue">{shannonsToCkb(remote.toString())}</td>
                      <td className="w-28">
                        <CapacityBar local={local} remote={remote} />
                      </td>
                      <td>
                        {ch.state.state_name === "ChannelReady" && (
                          <button
                            onClick={() => setClosingChannel(ch)}
                            className="btn-ghost text-xs text-accent-red hover:text-red-300"
                            data-testid={`button-close-channel-${ch.channel_id.slice(0, 8)}`}
                          >
                            Close
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showOpen && <OpenChannelModal onClose={() => setShowOpen(false)} />}
      {closingChannel && (
        <CloseChannelModal
          channel={closingChannel}
          onClose={() => setClosingChannel(null)}
        />
      )}
    </div>
  );
}
