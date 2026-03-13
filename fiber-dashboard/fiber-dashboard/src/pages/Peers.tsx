import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, RefreshCw, Unplug, GitFork, CheckCircle } from "lucide-react";
import { api } from "../api.js";
import type { PeerInfo, GraphNode } from "../types.js";
import { OpenChannelModal } from "../components/OpenChannelModal.js";

const ACTIVE_THRESHOLD = 24 * 60 * 60 * 1000;
const STALE_THRESHOLD  = 7  * 24 * 60 * 60 * 1000;

function peerActivity(timestampHex: string | undefined): { label: string; badge: string } {
  if (!timestampHex) return { label: "Unknown", badge: "badge-grey" };
  const age = Date.now() - Number(BigInt(timestampHex));
  if (age < ACTIVE_THRESHOLD) return { label: "Active", badge: "badge-green" };
  if (age < STALE_THRESHOLD)  return { label: "Stale", badge: "badge-amber" };
  return { label: "Inactive", badge: "badge-grey" };
}

function timeSince(timestampHex: string): string {
  const age = Date.now() - Number(BigInt(timestampHex));
  const hours = Math.floor(age / 3_600_000);
  if (hours < 1) return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const MAINNET_BOOTNODES = [
  {
    label: "Nervos Bootnode 1",
    address:
      "/ip4/43.199.24.44/tcp/8228/p2p/QmZ2gCTfEF6vKsiYFF2STPeA2rRLRim9nMtzfwiE7uMQ4v",
    peerId: "QmZ2gCTfEF6vKsiYFF2STPeA2rRLRim9nMtzfwiE7uMQ4v",
  },
  {
    label: "Nervos Bootnode 2",
    address:
      "/ip4/54.255.71.126/tcp/8228/p2p/QmcMLnWraRyxd7PFRgvn1QeYRQS2DGsP6fPFCQjtfMs5b2",
    peerId: "QmcMLnWraRyxd7PFRgvn1QeYRQS2DGsP6fPFCQjtfMs5b2",
  },
];

function truncate(str: string, len = 12) {
  if (str.length <= len * 2 + 3) return str;
  return `${str.slice(0, len)}…${str.slice(-8)}`;
}

function ConnectModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [address, setAddress] = useState("");
  const [save, setSave] = useState(false);
  const [connected, setConnected] = useState(false);

  const connectMut = useMutation({
    mutationFn: () => api.connectPeer(address.trim(), save),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["peers"] });
      setConnected(true);
    },
  });

  const quickConnect = (addr: string) => {
    setAddress(addr);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Connect to Peer</h2>
          <button onClick={onClose} className="btn-ghost p-1">✕</button>
        </div>

        {connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-green-900/20 border border-green-800/30 rounded-lg">
              <CheckCircle size={24} className="text-accent-green flex-shrink-0" />
              <div>
                <div className="text-sm font-semibold text-white">Peer connected</div>
                <p className="text-xs text-gray-400 mt-1">
                  You can now open a channel with this peer from the Peers table or the Channels tab.
                </p>
              </div>
            </div>
            <div className="mono text-xs text-gray-400 bg-bg-surface rounded-md p-2 break-all">
              {address}
            </div>
            <button onClick={onClose} className="btn-primary w-full">Done</button>
          </div>
        ) : (
          <>
        <p className="text-sm text-gray-400 mb-4">
          Enter a peer's multiaddr to connect. You need to be connected to a peer before you can open a channel with them.
        </p>

        {connectMut.isError && (
          <div className="bg-red-900/20 border border-red-800/50 rounded-md p-3 mb-4 text-sm text-red-400">
            {(connectMut.error as Error).message}
          </div>
        )}

        <div className="mb-4">
          <div className="section-title mb-2">Quick Connect (Official Bootnodes)</div>
          <div className="space-y-2">
            {MAINNET_BOOTNODES.map((node) => (
              <button
                key={node.peerId}
                onClick={() => quickConnect(node.address)}
                className={`w-full text-left p-3 rounded-md border text-sm transition-colors ${
                  address === node.address
                    ? "border-accent-green bg-accent-green/10 text-accent-green"
                    : "border-border bg-bg-surface text-gray-300 hover:border-gray-500"
                }`}
                data-testid={`button-quick-connect-${node.peerId.slice(0, 8)}`}
              >
                <div className="font-medium">{node.label}</div>
                <div className="mono text-xs text-gray-500 mt-0.5 truncate">{node.address}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Peer Multiaddr</label>
            <input
              className="input mono text-xs"
              placeholder="/ip4/1.2.3.4/tcp/8228/p2p/Qm..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              data-testid="input-peer-address"
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="save-peer"
              checked={save}
              onChange={(e) => setSave(e.target.checked)}
              className="w-4 h-4"
              data-testid="input-peer-save"
            />
            <label htmlFor="save-peer" className="text-sm text-gray-300">
              Save as persistent peer (reconnect on restart)
            </label>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button
            onClick={() => connectMut.mutate()}
            disabled={!address.trim() || connectMut.isPending}
            className="btn-primary flex-1"
            data-testid="button-connect-peer-submit"
          >
            {connectMut.isPending ? "Connecting…" : "Connect"}
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Peers() {
  const qc = useQueryClient();
  const [showConnect, setShowConnect] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState<PeerInfo | null>(null);
  const [openChannelPeerId, setOpenChannelPeerId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["peers"],
    queryFn: api.getPeers,
    refetchInterval: 30_000,
  });

  const { data: graphData } = useQuery({
    queryKey: ["graph-nodes"],
    queryFn: () => api.getGraphNodes(500),
    staleTime: 60_000,
  });

  // Map node_id (pubkey) → graph node for timestamp lookup
  const graphNodeMap = new Map<string, GraphNode>();
  for (const gn of graphData?.nodes ?? []) {
    graphNodeMap.set(gn.node_id, gn);
  }

  const [disconnected, setDisconnected] = useState(false);

  const disconnectMut = useMutation({
    mutationFn: (peer_id: string) => api.disconnectPeer(peer_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["peers"] });
      setDisconnected(true);
      setTimeout(() => { setConfirmDisconnect(null); setDisconnected(false); }, 1500);
    },
  });

  const peers = data?.peers ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Peers</h1>
        <div className="flex gap-2">
          <button onClick={() => refetch()} className="btn-ghost text-xs flex items-center gap-1">
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            onClick={() => setShowConnect(true)}
            className="btn-primary flex items-center gap-1.5"
            data-testid="button-connect-peer"
          >
            <Plus size={15} /> Connect Peer
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-gray-500">
          <RefreshCw size={20} className="animate-spin mr-2" /> Loading peers…
        </div>
      ) : peers.length === 0 ? (
        <div className="card border-dashed border-border/50 text-center py-12">
          <Users size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No connected peers.</p>
          <p className="text-xs text-gray-500 mt-1">
            Connect to a peer to start opening channels.
          </p>
          <button onClick={() => setShowConnect(true)} className="btn-primary mt-4 text-sm">
            Connect to a Peer
          </button>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Pubkey</th>
                  <th>Status</th>
                  <th>Address</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {peers.map((peer) => {
                  const gn = graphNodeMap.get(peer.pubkey);
                  const activity = peerActivity(gn?.timestamp);
                  return (
                  <tr key={peer.pubkey} data-testid={`row-peer-${peer.pubkey.slice(0, 8)}`}>
                    <td>
                      <div>
                        <span className="mono text-xs">{truncate(peer.pubkey)}</span>
                        {gn?.node_name && (
                          <div className="text-xs text-gray-500 mt-0.5">{gn.node_name}</div>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={activity.badge}>{activity.label}</span>
                      {gn?.timestamp && (
                        <div className="text-xs text-gray-600 mt-0.5">{timeSince(gn.timestamp)}</div>
                      )}
                    </td>
                    <td>
                      <span className="mono text-xs text-gray-500">{peer.address}</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setOpenChannelPeerId(peer.peer_id)}
                          className="btn-ghost text-xs text-accent-green hover:text-green-300 flex items-center gap-1"
                          data-testid={`button-open-channel-${peer.pubkey.slice(0, 8)}`}
                        >
                          <GitFork size={13} /> Open Channel
                        </button>
                        <button
                          onClick={() => setConfirmDisconnect(peer)}
                          className="btn-ghost text-xs text-accent-red hover:text-red-300 flex items-center gap-1"
                          data-testid={`button-disconnect-${peer.pubkey.slice(0, 8)}`}
                        >
                          <Unplug size={13} /> Disconnect
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmDisconnect && (
        <div className="modal-overlay" onClick={() => !disconnected && setConfirmDisconnect(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {disconnected ? (
              <div className="flex items-center gap-3 p-4">
                <CheckCircle size={24} className="text-accent-green" />
                <span className="text-sm font-semibold text-white">Peer disconnected</span>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-white mb-3">Disconnect Peer?</h2>
                <p className="text-sm text-gray-400 mb-4">
                  This will disconnect from{" "}
                  <span className="mono">{truncate(confirmDisconnect.pubkey)}</span>.
                  Any open channels with this peer will be suspended until reconnection.
                </p>
                {disconnectMut.isError && (
                  <div className="bg-red-900/20 border border-red-800/50 rounded-md p-3 mb-4 text-sm text-red-400">
                    {(disconnectMut.error as Error).message}
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setConfirmDisconnect(null)} className="btn-secondary flex-1">
                    Cancel
                  </button>
                  <button
                    onClick={() => disconnectMut.mutate(confirmDisconnect.peer_id)}
                    disabled={disconnectMut.isPending}
                    className="btn-danger flex-1"
                    data-testid="button-disconnect-confirm"
                  >
                    {disconnectMut.isPending ? "Disconnecting…" : "Disconnect"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showConnect && <ConnectModal onClose={() => setShowConnect(false)} />}
      {openChannelPeerId !== null && (
        <OpenChannelModal
          initialPeerId={openChannelPeerId}
          onClose={() => setOpenChannelPeerId(null)}
        />
      )}
    </div>
  );
}
