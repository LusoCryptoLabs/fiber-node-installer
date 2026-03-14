import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, CheckCircle } from "lucide-react";
import { api } from "../api.js";
import { ckbToShannons } from "../types.js";

export function OpenChannelModal({
  onClose,
  initialPeerId = "",
}: {
  onClose: () => void;
  initialPeerId?: string;
}) {
  const qc = useQueryClient();
  const [peerId, setPeerId] = useState(initialPeerId);
  const [amountCkb, setAmountCkb] = useState("100");
  const [isPublic, setIsPublic] = useState(true);
  const [tempChannelId, setTempChannelId] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      api.openChannel({
        peer_id: peerId.trim(),
        funding_amount: ckbToShannons(parseFloat(amountCkb)),
        public: isPublic,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["channels"] });
      setTempChannelId(data.temporary_channel_id);
    },
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-text-primary">Open Channel</h2>
          <button onClick={onClose} className="btn-ghost p-1">
            <X size={18} />
          </button>
        </div>

        {tempChannelId ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 alert-green rounded-lg">
              <CheckCircle size={24} className="text-accent-green flex-shrink-0" />
              <div>
                <div className="text-sm font-semibold text-text-primary">Channel opening initiated</div>
                <p className="text-xs text-text-secondary mt-1">
                  The on-chain funding transaction is being created. This takes ~30 seconds to confirm.
                  Check the Channels tab for status updates.
                </p>
              </div>
            </div>
            <div>
              <span className="label block mb-1">Temporary Channel ID</span>
              <div className="mono text-xs text-text-secondary bg-bg-surface rounded-md p-2 break-all">
                {tempChannelId}
              </div>
            </div>
            <div className="text-xs text-text-muted space-y-1">
              <div>Peer: <span className="mono text-text-secondary">{peerId.slice(0, 20)}…</span></div>
              <div>Amount: <span className="text-text-primary">{amountCkb} CKB</span></div>
            </div>
            <button onClick={onClose} className="btn-primary w-full">
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-text-secondary mb-5">
              Opening a channel locks CKB on-chain (takes ~30 seconds). After that, payments through it are instant.
            </p>

            {mut.isError && (
              <div className="alert-red rounded-md p-3 mb-4 text-sm text-red-400">
                {(mut.error as Error).message}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="label">Peer ID</label>
                <input
                  className="input mono text-xs"
                  placeholder="QmXxx… (libp2p peer ID)"
                  value={peerId}
                  onChange={(e) => setPeerId(e.target.value)}
                  data-testid="input-channel-peer-id"
                />
              </div>
              <div>
                <label className="label">Funding Amount (CKB)</label>
                <input
                  className="input"
                  type="number"
                  min="99"
                  value={amountCkb}
                  onChange={(e) => setAmountCkb(e.target.value)}
                  data-testid="input-channel-amount"
                />
                <p className="text-xs text-text-muted mt-1">
                  Minimum: 99 CKB. This becomes your outbound liquidity.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="public-channel"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="w-4 h-4"
                  data-testid="input-channel-public"
                />
                <label htmlFor="public-channel" className="text-sm text-text-primary">
                  Public channel (visible to the network for routing)
                </label>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={onClose} className="btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={() => mut.mutate()}
                disabled={!peerId.trim() || mut.isPending}
                className="btn-primary flex-1"
                data-testid="button-open-channel-submit"
              >
                {mut.isPending ? "Opening…" : "Open Channel"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
