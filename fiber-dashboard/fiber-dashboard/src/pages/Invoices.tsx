import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Copy, RefreshCw, CheckCircle, XCircle, Clock, Ban, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useStore } from "../useStore.js";
import { ckbToShannons, shannonsToCkb } from "../types.js";
import type { NewInvoiceResult, GetInvoiceResult } from "../types.js";

interface SessionInvoice {
  payment_hash: string;
  invoice_address: string;
  amount: string; // hex shannons
  description?: string;
  status: string;
  createdAt: number;
}

const MAX_INVOICES = 200;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="btn-secondary text-xs flex items-center gap-1.5">
      {copied ? <CheckCircle size={14} className="text-accent-green" /> : <Copy size={14} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function statusBadge(status: string) {
  switch (status) {
    case "Open":
      return <span className="badge-blue">Open</span>;
    case "Paid":
    case "Received":
      return <span className="badge-green">Paid</span>;
    case "Expired":
      return <span className="badge-grey">Expired</span>;
    case "Cancelled":
      return <span className="badge-red">Cancelled</span>;
    default:
      return <span className="badge-grey">{status}</span>;
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "Paid":
    case "Received":
      return <CheckCircle size={16} className="text-accent-green" />;
    case "Expired":
      return <Clock size={16} className="text-gray-500" />;
    case "Cancelled":
      return <XCircle size={16} className="text-accent-red" />;
    default:
      return <RefreshCw size={16} className="text-accent-blue animate-spin" />;
  }
}

function InvoiceStatusPoller({
  paymentHash,
  onStatusChange,
}: {
  paymentHash: string;
  onStatusChange: (hash: string, status: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ["invoice", paymentHash],
    queryFn: () => api.getInvoice(paymentHash),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === "Paid" || status === "Received" || status === "Expired" || status === "Cancelled") {
        return false;
      }
      return 5_000;
    },
  });

  const lastReported = useRef<string | null>(null);

  useEffect(() => {
    if (data && data.status !== lastReported.current) {
      lastReported.current = data.status;
      onStatusChange(paymentHash, data.status);
    }
  }, [data, paymentHash, onStatusChange]);

  return null;
}

export default function Invoices() {
  const [amountCkb, setAmountCkb] = useState("");
  const [description, setDescription] = useState("");
  const [expiryMinutes, setExpiryMinutes] = useState("60");
  const [generatedInvoice, setGeneratedInvoice] = useState<NewInvoiceResult | null>(null);
  const [paid, setPaid] = useState(false);

  const [checkInvoiceStr, setCheckInvoiceStr] = useState("");
  const [parsedInvoice, setParsedInvoice] = useState<GetInvoiceResult | null>(null);

  const [sessionInvoices, setSessionInvoices, storeLoaded] = useStore<SessionInvoice[]>("invoices", []);

  const persistInvoices = useCallback((updater: (prev: SessionInvoice[]) => SessionInvoice[]) => {
    setSessionInvoices((prev) => updater(prev).slice(0, MAX_INVOICES));
  }, [setSessionInvoices]);

  const updateInvoiceStatus = useCallback((hash: string, status: string) => {
    persistInvoices((prev) =>
      prev.map((inv) => (inv.payment_hash === hash ? { ...inv, status } : inv))
    );
    setGeneratedInvoice((cur) => {
      if (cur && hash === cur.invoice.data.payment_hash) {
        if (status === "Paid" || status === "Received") setPaid(true);
      }
      return cur;
    });
  }, [persistInvoices]);

  const createMut = useMutation({
    mutationFn: () =>
      api.createInvoice({
        amount: ckbToShannons(parseFloat(amountCkb)),
        currency: "CKB",
        description: description || undefined,
        expiry: "0x" + (parseInt(expiryMinutes) * 60).toString(16),
      } as object),
    onSuccess: (data) => {
      setGeneratedInvoice(data);
      setPaid(false);
      const newInv: SessionInvoice = {
        payment_hash: data.invoice.data.payment_hash,
        invoice_address: data.invoice_address,
        amount: data.invoice.amount ?? "0x0",
        description: description || undefined,
        status: "Open",
        createdAt: Date.now(),
      };
      persistInvoices((prev) => [newInv, ...prev]);
      setAmountCkb("");
      setDescription("");
    },
  });

  const parseMut = useMutation({
    mutationFn: () => api.parseInvoice(checkInvoiceStr.trim()),
    onSuccess: (data) => {
      const hash = data.invoice.data.payment_hash;
      api.getInvoice(hash).then((full) => setParsedInvoice(full)).catch(() => {
        setParsedInvoice({
          invoice_address: checkInvoiceStr.trim(),
          invoice: data.invoice,
          status: "Open",
        });
      });
    },
  });

  const cancelMut = useMutation({
    mutationFn: (hash: string) => api.cancelInvoice(hash),
    onSuccess: (_: unknown, hash: string) => {
      updateInvoiceStatus(hash, "Cancelled");
    },
  });

  const paymentHash = generatedInvoice?.invoice.data.payment_hash;
  const amountAttr = generatedInvoice?.invoice.amount;

  const openHashes = sessionInvoices
    .filter((inv) => inv.status === "Open")
    .map((inv) => inv.payment_hash);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Invoices</h1>

      {/* Poll status for all open invoices in history */}
      {openHashes.map((hash) => (
        <InvoiceStatusPoller key={hash} paymentHash={hash} onStatusChange={updateInvoiceStatus} />
      ))}

      <div className="card space-y-4">
        <h2 className="section-title">Create Invoice</h2>
        <p className="text-sm text-gray-400">
          Create a payment request that someone else can pay. The invoice encodes the amount and expires automatically.
        </p>

        {createMut.isError && (
          <div className="bg-red-900/20 border border-red-800/50 rounded-md p-3 text-sm text-red-400">
            {(createMut.error as Error).message}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Amount (CKB)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="1.0"
              value={amountCkb}
              onChange={(e) => setAmountCkb(e.target.value)}
              data-testid="input-invoice-amount"
            />
          </div>
          <div>
            <label className="label">Expires in (minutes)</label>
            <input
              className="input"
              type="number"
              min="1"
              value={expiryMinutes}
              onChange={(e) => setExpiryMinutes(e.target.value)}
              data-testid="input-invoice-expiry"
            />
          </div>
        </div>

        <div>
          <label className="label">Description (optional)</label>
          <input
            className="input"
            placeholder="Payment for article tip, etc."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="input-invoice-description"
          />
        </div>

        <button
          onClick={() => createMut.mutate()}
          disabled={!amountCkb || createMut.isPending}
          className="btn-primary flex items-center gap-2"
          data-testid="button-create-invoice"
        >
          <FileText size={16} />
          {createMut.isPending ? "Generating…" : "Generate Invoice"}
        </button>

        {generatedInvoice && (
          <div className="space-y-3 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Invoice Generated</h3>
              {paid ? (
                <span className="badge-green flex items-center gap-1">
                  <CheckCircle size={12} /> Paid!
                </span>
              ) : (
                <span className="badge-blue flex items-center gap-1">
                  <RefreshCw size={12} className="animate-spin" /> Waiting…
                </span>
              )}
            </div>
            <div className="bg-bg-surface rounded-md p-3 font-mono text-xs break-all text-gray-300 leading-relaxed">
              {generatedInvoice.invoice_address}
            </div>
            <div className="flex gap-2">
              <CopyButton text={generatedInvoice.invoice_address} />
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              {amountAttr && (
                <div>Amount: <span className="text-gray-300">{shannonsToCkb(BigInt(amountAttr || "0x0").toString())} CKB</span></div>
              )}
              {paymentHash && (
                <div>Payment hash: <span className="mono text-gray-400">{paymentHash.slice(0, 20)}…</span></div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Invoice history */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title mb-0">Invoice History</h2>
          {sessionInvoices.length > 0 && (
            <button
              onClick={() => persistInvoices(() => [])}
              className="btn-ghost text-xs flex items-center gap-1 text-gray-500"
            >
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
        {!storeLoaded ? (
          <div className="text-center py-8 text-gray-500 text-sm">Loading…</div>
        ) : sessionInvoices.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            <FileText size={24} className="mx-auto mb-2 text-gray-600" />
            No invoices yet.
          </div>
        ) : (
          <div className="space-y-2">
            {sessionInvoices.map((inv) => (
              <div
                key={inv.payment_hash}
                className="flex items-start gap-3 p-3 bg-bg-surface rounded-md"
              >
                <StatusIcon status={inv.status} />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusBadge(inv.status)}
                    <span className="text-sm text-white font-medium">
                      {shannonsToCkb(BigInt(inv.amount || "0x0").toString())} CKB
                    </span>
                    {inv.description && (
                      <span className="text-xs text-gray-400 italic">"{inv.description}"</span>
                    )}
                  </div>
                  <div className="mono text-xs text-gray-500 truncate">{inv.payment_hash}</div>
                  <div className="text-xs text-gray-600">
                    {new Date(inv.createdAt).toLocaleTimeString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <CopyButton text={inv.invoice_address} />
                  {inv.status === "Open" && (
                    <button
                      onClick={() => cancelMut.mutate(inv.payment_hash)}
                      disabled={cancelMut.isPending}
                      className="btn-ghost text-xs flex items-center gap-1 text-accent-red"
                      title="Cancel invoice"
                    >
                      <Ban size={12} /> Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card space-y-4">
        <h2 className="section-title">Check Invoice</h2>
        <p className="text-sm text-gray-400">
          Paste any Fiber invoice to decode and inspect it.
        </p>

        {parseMut.isError && (
          <div className="bg-red-900/20 border border-red-800/50 rounded-md p-3 text-sm text-red-400">
            {(parseMut.error as Error).message}
          </div>
        )}

        <div>
          <label className="label">Invoice String</label>
          <textarea
            className="input font-mono text-xs resize-none"
            rows={3}
            placeholder="fibc1p..."
            value={checkInvoiceStr}
            onChange={(e) => {
              setCheckInvoiceStr(e.target.value);
              setParsedInvoice(null);
            }}
            data-testid="input-check-invoice"
          />
        </div>

        <button
          onClick={() => parseMut.mutate()}
          disabled={!checkInvoiceStr.trim() || parseMut.isPending}
          className="btn-secondary flex items-center gap-2"
          data-testid="button-check-invoice"
        >
          {parseMut.isPending ? "Checking…" : "Decode Invoice"}
        </button>

        {parsedInvoice && (
          <div className="bg-bg-surface rounded-md p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-white">Invoice Details</span>
              {statusBadge(parsedInvoice.status)}
            </div>
            <div className="grid grid-cols-2 gap-y-2 text-xs">
              <span className="text-gray-500">Currency</span>
              <span className="text-gray-200">{parsedInvoice.invoice.currency}</span>
              {parsedInvoice.invoice.amount && (
                <>
                  <span className="text-gray-500">Amount</span>
                  <span className="text-gray-200">
                    {shannonsToCkb(BigInt(parsedInvoice.invoice.amount || "0x0").toString())} CKB
                  </span>
                </>
              )}
              <span className="text-gray-500">Payment Hash</span>
              <span className="mono text-gray-400 break-all">
                {parsedInvoice.invoice.data.payment_hash.slice(0, 20)}…
              </span>
              {parsedInvoice.invoice.data.attrs.map((attr, i) =>
                attr.type === "Description" ? (
                  <span key={i} className="contents">
                    <span className="text-gray-500">Description</span>
                    <span className="text-gray-200">{String(attr.value)}</span>
                  </span>
                ) : null
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
