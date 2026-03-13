import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Wallet, AlertTriangle, RefreshCw, GitFork, Copy, Check, ExternalLink, Send } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { api, ApiError } from "../api.js";
import { shannonsToCkb } from "../types.js";

const SHANNONS_PER_CKB = 100_000_000n;
const LOW_BALANCE_THRESHOLD_CKB = 1000n;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="btn-ghost p-1 rounded flex-shrink-0"
      title="Copy"
    >
      {copied ? <Check size={14} className="text-accent-green" /> : <Copy size={14} />}
    </button>
  );
}

function SendCkbForm({ explorerBase }: { explorerBase: string }) {
  const [open, setOpen] = useState(false);
  const [toAddress, setToAddress] = useState('');
  const [amountCkb, setAmountCkb] = useState('');
  const [feeCkb, setFeeCkb] = useState('0.001');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setToAddress(''); setAmountCkb(''); setFeeCkb('0.001');
    setPassword(''); setTxHash(null); setError(null);
  }

  async function handleSend() {
    setError(null);
    setSending(true);
    try {
      const result = await api.transferCkb({ toAddress: toAddress.trim(), amountCkb: amountCkb.trim(), feeCkb: feeCkb.trim(), password });
      setTxHash(result.txHash);
      setPassword('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost text-xs flex items-center gap-1 mt-2">
        <Send size={13} /> Send CKB
      </button>
    );
  }

  return (
    <div className="mt-3 border border-border rounded-lg p-4 space-y-3 bg-bg-surface">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-200">Send CKB</span>
        <button onClick={() => { reset(); setOpen(false); }} className="btn-ghost p-1 text-xs text-gray-500">✕</button>
      </div>

      {txHash ? (
        <div className="space-y-2">
          <div className="text-xs text-accent-green font-medium">Transfer submitted!</div>
          <div className="bg-bg-surface border border-border rounded p-2 mono text-xs text-gray-300 break-all">{txHash}</div>
          <a href={`${explorerBase}/transaction/${txHash}`} target="_blank" rel="noopener noreferrer"
            className="text-xs text-accent-green hover:underline flex items-center gap-1">
            View on Explorer <ExternalLink size={11} />
          </a>
          <button onClick={() => { reset(); setOpen(false); }} className="btn-ghost text-xs mt-1">Done</button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div>
              <label className="label mb-1 block">Destination Address</label>
              <input className="input w-full mono text-xs" placeholder="ckb1..." value={toAddress} onChange={e => setToAddress(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label mb-1 block">Amount (CKB)</label>
                <input className="input w-full" type="number" min="61" step="1" placeholder="100" value={amountCkb} onChange={e => setAmountCkb(e.target.value)} />
              </div>
              <div>
                <label className="label mb-1 block">Fee (CKB)</label>
                <input className="input w-full" type="number" min="0.0001" step="0.0001" placeholder="0.001" value={feeCkb} onChange={e => setFeeCkb(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label mb-1 block">Keystore Password</label>
              <input className="input w-full" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
              <p className="text-xs text-gray-600 mt-1">The password you set when the node was installed.</p>
            </div>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-800/40 rounded p-2 text-xs text-red-400 break-all">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSend}
              disabled={sending || !toAddress || !amountCkb || !feeCkb || !password}
              className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
            >
              {sending ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
              {sending ? 'Sending…' : 'Send'}
            </button>
            <button onClick={() => { reset(); setOpen(false); }} className="btn-ghost text-xs">Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function WalletPage() {
  const { data: channels, isLoading: loadingChannels, refetch } = useQuery({
    queryKey: ["channels"],
    queryFn: api.getChannels,
    refetchInterval: 30_000,
  });

  const { data: wallet, isLoading: loadingWallet, isError: walletError, refetch: refetchWallet } = useQuery({
    queryKey: ["wallet"],
    queryFn: api.getWallet,
    refetchInterval: 60_000,
    retry: 1,
  });

  const allChannels = channels?.channels ?? [];
  const readyChannels = allChannels.filter((c) =>
    c.state.state_name.toUpperCase().replace(/[^A-Z]/g, "") === "CHANNELREADY"
  );

  const totalLocal = readyChannels.reduce((sum, ch) => sum + BigInt(ch.local_balance), 0n);
  const totalRemote = readyChannels.reduce((sum, ch) => sum + BigInt(ch.remote_balance), 0n);
  const totalCapacity = totalLocal + totalRemote;

  const localCkb = totalLocal / SHANNONS_PER_CKB;
  const isLowBalance = localCkb < LOW_BALANCE_THRESHOLD_CKB;

  // On-chain balance in CKB (shannons returned from L1)
  const onChainShannons = wallet?.capacity ? BigInt(wallet.capacity) : 0n;
  const onChainCkb = onChainShannons / SHANNONS_PER_CKB;
  const isOnChainLow = onChainCkb < 200n; // below 200 CKB warn

  const chartData = readyChannels.slice(0, 12).map((ch, i) => {
    const local = Number(BigInt(ch.local_balance) / SHANNONS_PER_CKB);
    const remote = Number(BigInt(ch.remote_balance) / SHANNONS_PER_CKB);
    return { name: `Ch ${i + 1}`, local, remote, channelId: ch.channel_id };
  });

  const explorerBase = wallet?.isMainnet
    ? "https://explorer.nervos.org"
    : "https://pudge.explorer.nervos.org";
  const faucetUrl = "https://faucet.nervos.org";

  function refetchAll() {
    refetch();
    refetchWallet();
  }

  if (loadingChannels && loadingWallet) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <RefreshCw size={20} className="animate-spin mr-2" /> Loading wallet…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Wallet</h1>
        <button onClick={refetchAll} className="btn-ghost text-xs flex items-center gap-1">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* ── On-Chain Wallet ───────────────────────────────────────────────── */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="section-title">On-Chain Wallet (Layer 1)</h2>
          {wallet && (
            <span className={`badge text-xs ${wallet.isMainnet ? "badge-amber" : "badge-blue"}`}>
              {wallet.isMainnet ? "Mainnet" : "Testnet"}
            </span>
          )}
        </div>

        {walletError && (
          <div className="bg-red-900/20 border border-red-800/40 rounded-md p-3 text-sm text-red-400">
            Could not derive on-chain wallet info. Make sure the Fiber node is running.
          </div>
        )}

        {wallet && (
          <>
            {/* Address */}
            <div>
              <div className="label mb-1">Deposit Address</div>
              <p className="text-xs text-gray-500 mb-2">
                Send CKB here to fund channel opens and on-chain fees.
              </p>
              <div className="flex items-start gap-1 bg-bg-surface rounded-md p-2 border border-border">
                <span className="mono text-xs text-gray-300 break-all flex-1">
                  {wallet.address}
                </span>
                <CopyButton text={wallet.address} />
              </div>
              <div className="flex items-center gap-3 mt-2">
                <a
                  href={`${explorerBase}/address/${wallet.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent-green hover:underline flex items-center gap-1"
                >
                  View on Explorer <ExternalLink size={11} />
                </a>
                {!wallet.isMainnet && (
                  <a
                    href={faucetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent-blue hover:underline flex items-center gap-1"
                  >
                    Get testnet CKB (faucet) <ExternalLink size={11} />
                  </a>
                )}
              </div>
              <SendCkbForm explorerBase={explorerBase} />
            </div>

            {/* Balance */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="stat-card">
                <Wallet size={18} className={isOnChainLow ? "text-accent-amber" : "text-accent-green"} />
                <div className={`stat-value ${isOnChainLow ? "text-accent-amber" : "text-accent-green"}`}>
                  {shannonsToCkb(onChainShannons.toString())} CKB
                </div>
                <div className="stat-label">On-Chain Balance (free)</div>
                <div className="text-xs text-gray-500 mt-1">Available for opening channels</div>
              </div>
              <div className="stat-card">
                <GitFork size={18} className="text-gray-400" />
                <div className="stat-value">
                  {shannonsToCkb(totalCapacity.toString())} CKB
                </div>
                <div className="stat-label">Locked in Channels</div>
                <div className="text-xs text-gray-500 mt-1">Released when channels close</div>
              </div>
            </div>

            {isOnChainLow && (
              <div className="bg-amber-900/20 border border-amber-800/50 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle size={16} className="text-accent-amber flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-300/90">
                  <span className="font-medium text-amber-400">Low on-chain balance.</span>{" "}
                  {wallet.isMainnet
                    ? "Send CKB to your deposit address above before opening channels."
                    : <>Use the <a href={faucetUrl} target="_blank" rel="noopener noreferrer" className="underline">testnet faucet</a> to claim free CKB to your deposit address.</>
                  }
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-xs text-gray-600">
          On-chain balance is queried live from the CKB Layer 1 network. Channel balances (below) are off-chain and managed by Fiber.
        </p>
      </div>

      {/* ── Channel Liquidity warning ─────────────────────────────────────── */}
      {isLowBalance && readyChannels.length > 0 && (
        <div className="bg-amber-900/20 border border-amber-800/50 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-accent-amber flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-amber-400">Low Outbound Liquidity</div>
            <div className="text-xs text-amber-300/70 mt-1">
              Your local channel balance is below 1,000 CKB. You may not be able to send large
              payments or route transactions. Consider opening a new channel with more funding.
            </div>
          </div>
        </div>
      )}

      {/* ── Off-chain stats ───────────────────────────────────────────────── */}
      <div>
        <h2 className="section-title mb-3">Channel Liquidity (Layer 2)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="stat-card" data-testid="stat-local-total">
            <Wallet size={18} className="text-accent-green" />
            <div className="stat-value text-accent-green">
              {shannonsToCkb(totalLocal.toString())} CKB
            </div>
            <div className="stat-label">Local Balance</div>
            <div className="text-xs text-gray-500 mt-1">Your outbound liquidity</div>
          </div>
          <div className="stat-card" data-testid="stat-remote-total">
            <Wallet size={18} className="text-accent-blue" />
            <div className="stat-value text-accent-blue">
              {shannonsToCkb(totalRemote.toString())} CKB
            </div>
            <div className="stat-label">Remote Balance</div>
            <div className="text-xs text-gray-500 mt-1">Your inbound capacity</div>
          </div>
          <div className="stat-card" data-testid="stat-capacity-total">
            <GitFork size={18} className="text-gray-400" />
            <div className="stat-value">
              {shannonsToCkb(totalCapacity.toString())} CKB
            </div>
            <div className="stat-label">Total Capacity</div>
            <div className="text-xs text-gray-500 mt-1">{readyChannels.length} open channels</div>
          </div>
        </div>
      </div>

      {readyChannels.length > 0 && (
        <div className="card">
          <h2 className="section-title mb-4">Channel Liquidity Breakdown</h2>
          <div className="text-xs text-gray-500 flex gap-4 mb-4">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-accent-green inline-block" /> Local
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-accent-blue inline-block" /> Remote
            </span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barGap={2} barCategoryGap="25%">
              <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 11 }} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} unit=" CKB" width={70} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1e1e1e",
                  border: "1px solid #2a2a2a",
                  borderRadius: 6,
                  color: "#e5e7eb",
                  fontSize: 12,
                }}
                formatter={(v: number, name: string) => [`${v.toLocaleString()} CKB`, name]}
              />
              <Bar dataKey="local" name="Local" fill="#22c55e" radius={[3, 3, 0, 0]} />
              <Bar dataKey="remote" name="Remote" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {readyChannels.length === 0 && !loadingChannels && (
        <div className="card border-dashed border-border/50 text-center py-12">
          <GitFork size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No open channels.</p>
          <p className="text-xs text-gray-500 mt-1">
            Open a channel to see your liquidity breakdown here.
          </p>
        </div>
      )}
    </div>
  );
}
