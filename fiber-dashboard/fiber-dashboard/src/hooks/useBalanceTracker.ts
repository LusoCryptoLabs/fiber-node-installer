import { useEffect, useRef } from "react";
import { useStore } from "../useStore.js";
import type { Channel, BalanceHistory, BalanceSnapshot, FeeEventsLog, FeeEvent } from "../types.js";

const SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_SNAPSHOTS = 2000;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_FEE_EVENTS = 500;

function isReady(ch: Channel): boolean {
  return ch.state.state_name.toUpperCase().replace(/[^A-Z]/g, "") === "CHANNELREADY";
}

function channelIds(channels: Channel[]): Set<string> {
  return new Set(channels.map((c) => c.channel_id));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function pruneSnapshots(snapshots: BalanceSnapshot[], now: number): BalanceSnapshot[] {
  // Remove entries older than 7 days
  let result = snapshots.filter((s) => now - s.ts < MAX_AGE);
  // Cap at MAX_SNAPSHOTS by removing every other point from the oldest half
  if (result.length > MAX_SNAPSHOTS) {
    const half = Math.floor(result.length / 2);
    const oldHalf = result.slice(0, half).filter((_, i) => i % 2 === 0);
    result = [...oldHalf, ...result.slice(half)];
  }
  return result;
}

export function useBalanceTracker(channels: Channel[]) {
  const [history, setHistory, historyLoaded] = useStore<BalanceHistory>(
    "balance_history",
    { snapshots: [], lastSnapshotTs: 0 }
  );
  const [feeLog, setFeeLog, feeLoaded] = useStore<FeeEventsLog>(
    "fee_events",
    { events: [], totalEarned: "0" }
  );

  const lastProcessedTotal = useRef<string | null>(null);
  const lastProcessedChannelIds = useRef<Set<string>>(new Set());
  const migrated = useRef(false);

  // Migrate old localStorage baseline on first load
  useEffect(() => {
    if (!historyLoaded || migrated.current) return;
    migrated.current = true;

    if (history.snapshots.length > 0) return; // already has data
    const old = localStorage.getItem("fiber_balance_baseline");
    if (!old) return;

    try {
      const { total, ts } = JSON.parse(old) as { total: string; ts: number };
      setHistory({
        snapshots: [{ ts, totalLocal: total, totalRemote: "0", channelCount: 0, channels: [] }],
        lastSnapshotTs: ts,
      });
      localStorage.removeItem("fiber_balance_baseline");
    } catch {
      // corrupt data, ignore
    }
  }, [historyLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Main tracking effect
  useEffect(() => {
    if (!historyLoaded || !feeLoaded || channels.length === 0) return;

    const ready = channels.filter(isReady);
    if (ready.length === 0) return;

    const totalLocal = ready.reduce((sum, ch) => sum + BigInt(ch.local_balance), 0n);
    const totalRemote = ready.reduce((sum, ch) => sum + BigInt(ch.remote_balance), 0n);
    const totalStr = totalLocal.toString();
    const now = Date.now();
    const currentIds = channelIds(ready);

    // Throttle: skip if <5 min elapsed AND no balance change
    const elapsed = now - history.lastSnapshotTs;
    const changed = totalStr !== lastProcessedTotal.current;
    if (elapsed < SNAPSHOT_INTERVAL && !changed) return;
    // Also skip if we already processed this exact total (prevents duplicate writes)
    if (!changed && lastProcessedTotal.current !== null) return;

    lastProcessedTotal.current = totalStr;

    const snapshot: BalanceSnapshot = {
      ts: now,
      totalLocal: totalStr,
      totalRemote: totalRemote.toString(),
      channelCount: ready.length,
      channels: ready.map((ch) => ({
        id: ch.channel_id,
        local: BigInt(ch.local_balance).toString(),
        remote: BigInt(ch.remote_balance).toString(),
      })),
    };

    // Fee detection: only if we have a previous snapshot
    let newFeeEvent: FeeEvent | null = null;
    const prevSnapshots = history.snapshots;
    if (prevSnapshots.length > 0) {
      const prev = prevSnapshots[prevSnapshots.length - 1];
      const prevTotal = BigInt(prev.totalLocal);
      const prevIds = new Set(prev.channels.map((c) => c.id));

      // Only detect fees if the channel set is unchanged (no opens/closes)
      if (setsEqual(currentIds, prevIds) && totalLocal > prevTotal) {
        const delta = totalLocal - prevTotal;

        // Build per-channel deltas
        const prevMap = new Map(prev.channels.map((c) => [c.id, BigInt(c.local)]));
        const channelsChanged: { id: string; delta: string }[] = [];
        for (const ch of ready) {
          const prevBal = prevMap.get(ch.channel_id) ?? 0n;
          const curBal = BigInt(ch.local_balance);
          const d = curBal - prevBal;
          if (d !== 0n) {
            channelsChanged.push({ id: ch.channel_id, delta: d.toString() });
          }
        }

        newFeeEvent = {
          ts: now,
          amount: delta.toString(),
          prevTotal: prevTotal.toString(),
          newTotal: totalStr,
          channelsChanged,
        };
      }
    }

    lastProcessedChannelIds.current = currentIds;

    // Update history
    setHistory((prev) => {
      const pruned = pruneSnapshots([...prev.snapshots, snapshot], now);
      return { snapshots: pruned, lastSnapshotTs: now };
    });

    // Update fee log if we detected a fee event
    if (newFeeEvent) {
      setFeeLog((prev) => {
        const events = [newFeeEvent, ...prev.events].slice(0, MAX_FEE_EVENTS);
        const totalEarned = (BigInt(prev.totalEarned) + BigInt(newFeeEvent.amount)).toString();
        return { events, totalEarned };
      });
    }
  }, [channels, historyLoaded, feeLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetFeeTracking() {
    const ready = channels.filter(isReady);
    const totalLocal = ready.reduce((sum, ch) => sum + BigInt(ch.local_balance), 0n);
    const now = Date.now();

    // Reset fee log
    setFeeLog({ events: [], totalEarned: "0" });

    // Add a fresh baseline snapshot
    const snapshot: BalanceSnapshot = {
      ts: now,
      totalLocal: totalLocal.toString(),
      totalRemote: ready.reduce((sum, ch) => sum + BigInt(ch.remote_balance), 0n).toString(),
      channelCount: ready.length,
      channels: ready.map((ch) => ({
        id: ch.channel_id,
        local: BigInt(ch.local_balance).toString(),
        remote: BigInt(ch.remote_balance).toString(),
      })),
    };

    setHistory((prev) => ({
      snapshots: [...prev.snapshots, snapshot],
      lastSnapshotTs: now,
    }));

    lastProcessedTotal.current = totalLocal.toString();
  }

  return { history, feeLog, resetFeeTracking, loaded: historyLoaded && feeLoaded };
}
