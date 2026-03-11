import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Zap, Send, RefreshCw, CheckCircle, XCircle, Clock } from "lucide-react";
import { api } from "../api.js";
import { shannonsToCkb, ckbToShannons } from "../types.js";
import type { SessionPayment } from "../types.js";

function StatusIcon({ status }: { status: SessionPayment["status"] }) {
  switch (status) {
    case "Success":
      return <CheckCircle size={16} className="text-accent-green" />;
    case "Failed":
      return <XCircle size={16} className="text-accent-red" />;
    case "InFlight":
      return <RefreshCw size={16} className="text-accent-amber animate-spin" />;
    default:
      return <Clock size={16} className="text-gray-400" />;
  }
}

function StatusBadge({ status }: { status: SessionPayment["status"] }) {
  switch (status) {
    case "Success":
      return <span className="badge-green">Success</span>;
    case "Failed":
      return <span className="badge-red">Failed</span>;
    case "InFlight":
      return <span className="badge-amber">In Flight</span>;
    default:
      return <span className="badge-grey">Created</span>;
  }
}

function PaymentPoller({
  paymentHash,
  onUpdate,
}: {
  paymentHash: string;
  onUpdate: (hash: string, status: SessionPayment["status"], error?: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["payment", paymentHash],
    queryFn: () => api.getPayment(paymentHash),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === "Success" || s === "Failed") return false;
      return 2_000;
    },
  });

  if (data) {
    if (data.status === "Success") onUpdate(paymentHash, "Success");
    else if (data.status === "Failed") onUpdate(paymentHash, "Failed", data.failed_error ?? "Payment failed");
    else if (data.status === "InFlight") onUpdate(paymentHash, "InFlight");
  }

  return null;
}

export default function Payments() {
  const [mode, setMode] = useState<"invoice" | "manual">("invoice");
  const [invoiceStr, setInvoiceStr] = useState("");
  const [manualPeerPubkey, setManualPeerPubkey] = useState("");
  const [manualAmountCkb, setManualAmountCkb] = useState("");
  const [maxFeeCkb, setMaxFeeCkb] = useState("0.01");
  const [sessionPayments, setSessionPayments] = useState<SessionPayment[]>([]);

  const updatePayment = (hash: string, status: SessionPayment["status"], error?: string) => {
    setSessionPayments((prev) =>
      prev.map((p) =>
        p.payment_hash === hash ? { ...p, status, lastError: error } : p
      )
    );
  };

  const sendMut = useMutation({
    mutationFn: () => {
      if (mode === "invoice") {
        return api.sendPayment({
          invoice: invoiceStr.trim(),
          max_fee_amount: ckbToShannons(parseFloat(maxFeeCkb) || 0.01),
        });
      } else {
        return api.sendPayment({
          payment_hash: undefined,
          amount: ckbToShannons(parseFloat(manualAmountCkb)),
          max_fee_amount: ckbToShannons(parseFloat(maxFeeCkb) || 0.01),
          keysend: true,
        });
      }
    },
    onSuccess: (data) => {
      const newPayment: SessionPayment = {
        payment_hash: data.payment_hash,
        amount: data.fee ?? "unknown",
        invoice: mode === "invoice" ? invoiceStr.trim() : undefined,
        status: data.status as SessionPayment["status"],
        createdAt: Date.now(),
      };
      setSessionPayments((prev) => [newPayment, ...prev]);
      setInvoiceStr("");
      setManualPeerPubkey("");
      setManualAmountCkb("");
    },
  });

  const inFlightHashes = sessionPayments
    .filter((p) => p.status === "Created" || p.status === "InFlight")
    .map((p) => p.payment_hash);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Payments</h1>

      {inFlightHashes.map((hash) => (
        <PaymentPoller key={hash} paymentHash={hash} onUpdate={updatePayment} />
      ))}

      <div className="card space-y-5">
        <h2 className="section-title">Send Payment</h2>

        <div className="flex gap-2">
          <button
            onClick={() => setMode("invoice")}
            className={`btn text-sm px-4 py-2 ${mode === "invoice" ? "btn-primary" : "btn-secondary"}`}
            data-testid="button-mode-invoice"
          >
            Pay Invoice
          </button>
          <button
            onClick={() => setMode("manual")}
            className={`btn text-sm px-4 py-2 ${mode === "manual" ? "btn-primary" : "btn-secondary"}`}
            data-testid="button-mode-manual"
          >
            Keysend (manual)
          </button>
        </div>

        {sendMut.isError && (
          <div className="bg-red-900/20 border border-red-800/50 rounded-md p-3 text-sm text-red-400">
            {(sendMut.error as Error).message}
          </div>
        )}

        {mode === "invoice" ? (
          <div>
            <label className="label">Invoice String</label>
            <textarea
              className="input font-mono text-xs resize-none"
              rows={4}
              placeholder="fibc1pjnv8..."
              value={invoiceStr}
              onChange={(e) => setInvoiceStr(e.target.value)}
              data-testid="input-invoice-string"
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label">Recipient Pubkey</label>
              <input
                className="input mono"
                placeholder="QmXxx..."
                value={manualPeerPubkey}
                onChange={(e) => setManualPeerPubkey(e.target.value)}
                data-testid="input-keysend-pubkey"
              />
            </div>
            <div>
              <label className="label">Amount (CKB)</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                placeholder="1.0"
                value={manualAmountCkb}
                onChange={(e) => setManualAmountCkb(e.target.value)}
                data-testid="input-keysend-amount"
              />
            </div>
          </div>
        )}

        <div>
          <label className="label">Max Fee (CKB)</label>
          <input
            className="input w-40"
            type="number"
            min="0"
            step="0.001"
            value={maxFeeCkb}
            onChange={(e) => setMaxFeeCkb(e.target.value)}
            data-testid="input-max-fee"
          />
        </div>

        <button
          onClick={() => sendMut.mutate()}
          disabled={
            sendMut.isPending ||
            (mode === "invoice" ? !invoiceStr.trim() : !manualPeerPubkey.trim() || !manualAmountCkb)
          }
          className="btn-primary flex items-center gap-2"
          data-testid="button-send-payment"
        >
          <Send size={16} />
          {sendMut.isPending ? "Sending…" : "Send Payment"}
        </button>
      </div>

      <div className="card">
        <h2 className="section-title mb-4">This Session's Payments</h2>
        {sessionPayments.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            <Zap size={24} className="mx-auto mb-2 text-gray-600" />
            No payments sent this session yet.
            <p className="text-xs mt-1 text-gray-600">
              Note: Fiber doesn't persist payment history across restarts.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessionPayments.map((p) => (
              <div
                key={p.payment_hash}
                className="flex items-center gap-3 p-3 bg-bg-surface rounded-md"
                data-testid={`payment-${p.payment_hash.slice(0, 8)}`}
              >
                <StatusIcon status={p.status} />
                <div className="flex-1 min-w-0">
                  <div className="mono text-xs text-gray-400 truncate">{p.payment_hash}</div>
                  {p.lastError && (
                    <div className="text-xs text-accent-red mt-0.5">{p.lastError}</div>
                  )}
                </div>
                <StatusBadge status={p.status} />
                <span className="text-xs text-gray-500">
                  {new Date(p.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
