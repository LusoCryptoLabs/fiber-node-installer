import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, RefreshCw, Unplug, GitFork } from "lucide-react";
import { api } from "../api.js";
import type { PeerInfo } from "../types.js";
import { OpenChannelModal } from "../components/OpenChannelModal.js";

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

  const connectMut = useMutation({
    mutationFn: () => api.connectPeer(address.trim(), save),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["peers"] });
      onClose();
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

  const disconnectMut = useMutation({
    mutationFn: (peer_id: string) => api.disconnectPeer(peer_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["peers"] });
      setConfirmDisconnect(null);
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
                  <th>Address</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {peers.map((peer) => (
                  <tr key={peer.pubkey} data-testid={`row-peer-${peer.pubkey.slice(0, 8)}`}>
                    <td>
                      <span className="mono text-xs">{truncate(peer.pubkey)}</span>
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmDisconnect && (
        <div className="modal-overlay" onClick={() => setConfirmDisconnect(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
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
