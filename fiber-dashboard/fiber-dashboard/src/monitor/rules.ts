import type { NodeInfo, Channel, PeerInfo } from "../../../ckb-fiber/index.js";
import { shannonsToCkb } from "../../../ckb-fiber/index.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type AlertCategory = "channel" | "connectivity" | "liquidity" | "routing";
export type AlertSeverity = "info" | "warning" | "critical";

export interface Alert {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  detail: string;
}

export interface MonitorInput {
  nodeInfo: NodeInfo | undefined;
  channels: Channel[];
  peers: PeerInfo[];
  health: { ok: boolean; startedAt: number } | undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function trunc(id: string, n = 6): string {
  if (id.length <= n * 2 + 3) return id;
  return `${id.slice(0, n + 2)}…${id.slice(-n)}`;
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex || "0x0");
}

function pct(part: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((part * 10000n) / total) / 100;
}

// ── Rules ───────────────────────────────────────────────────────────────────

function channelHealthRules(channels: Channel[]): Alert[] {
  const alerts: Alert[] = [];

  const closing = channels.filter(
    (c) => c.state.state_name === "ShuttingDown" || c.state.state_name === "Closed"
  );
  for (const ch of closing) {
    alerts.push({
      id: `ch-closing-${ch.channel_id}`,
      category: "channel",
      severity: "critical",
      title: `Channel ${trunc(ch.channel_id)} is ${ch.state.state_name === "Closed" ? "closed" : "closing"}`,
      detail: `This channel with peer ${trunc(ch.peer_id)} is in ${ch.state.state_name} state.`,
    });
  }

  const pending = channels.filter(
    (c) =>
      c.state.state_name !== "ChannelReady" &&
      c.state.state_name !== "ShuttingDown" &&
      c.state.state_name !== "Closed"
  );
  for (const ch of pending) {
    alerts.push({
      id: `ch-pending-${ch.channel_id}`,
      category: "channel",
      severity: "warning",
      title: `Channel ${trunc(ch.channel_id)} still opening`,
      detail: `State: ${ch.state.state_name}. If stuck for a long time, it may need to be abandoned.`,
    });
  }

  const ready = channels.filter((c) => c.state.state_name === "ChannelReady");
  for (const ch of ready) {
    const local = hexToBigInt(ch.local_balance);
    const remote = hexToBigInt(ch.remote_balance);
    const total = local + remote;
    if (total === 0n) continue;
    const localPct = pct(local, total);
    const remotePct = pct(remote, total);

    if (localPct > 90) {
      alerts.push({
        id: `ch-imbalanced-local-${ch.channel_id}`,
        category: "channel",
        severity: "warning",
        title: `Channel ${trunc(ch.channel_id)} heavily one-sided`,
        detail: `${localPct.toFixed(0)}% local / ${remotePct.toFixed(0)}% remote. Inbound payments through this channel will likely fail.`,
      });
    } else if (remotePct > 90) {
      alerts.push({
        id: `ch-imbalanced-remote-${ch.channel_id}`,
        category: "channel",
        severity: "warning",
        title: `Channel ${trunc(ch.channel_id)} heavily one-sided`,
        detail: `${localPct.toFixed(0)}% local / ${remotePct.toFixed(0)}% remote. Outbound payments through this channel will likely fail.`,
      });
    }
  }

  if (channels.length > 0 && closing.length === 0 && pending.length === 0) {
    const imbalanced = alerts.filter((a) => a.id.startsWith("ch-imbalanced")).length;
    const healthy = ready.length - imbalanced;
    if (healthy > 0) {
      alerts.push({
        id: "ch-healthy",
        category: "channel",
        severity: "info",
        title: `${healthy} of ${channels.length} channel${channels.length > 1 ? "s" : ""} operating normally`,
        detail: "All ready channels are within healthy balance ranges.",
      });
    }
  }

  if (channels.length === 0) {
    alerts.push({
      id: "ch-none",
      category: "channel",
      severity: "warning",
      title: "No channels open",
      detail: "Open a channel from the Channels tab to start transacting on the Fiber network.",
    });
  }

  return alerts;
}

function connectivityRules(
  nodeInfo: NodeInfo | undefined,
  peers: PeerInfo[]
): Alert[] {
  const alerts: Alert[] = [];

  if (peers.length === 0) {
    alerts.push({
      id: "conn-no-peers",
      category: "connectivity",
      severity: "critical",
      title: "No peers connected",
      detail: "Your node is isolated. Connect to a peer from the Peers tab.",
    });
  } else if (peers.length === 1) {
    alerts.push({
      id: "conn-low-peers",
      category: "connectivity",
      severity: "warning",
      title: "Only 1 peer connected",
      detail: "Low redundancy. If this peer disconnects, your node loses all connectivity.",
    });
  } else {
    alerts.push({
      id: "conn-ok",
      category: "connectivity",
      severity: "info",
      title: `${peers.length} peers connected`,
      detail: "Peer connectivity looks healthy.",
    });
  }

  if (nodeInfo && !nodeInfo.is_announced) {
    alerts.push({
      id: "conn-not-announced",
      category: "connectivity",
      severity: "warning",
      title: "Node not announced to network",
      detail:
        "Other nodes cannot discover you. Your node can still open channels, but won't appear in the network graph.",
    });
  }

  if (nodeInfo && nodeInfo.addresses.length === 0) {
    alerts.push({
      id: "conn-no-addr",
      category: "connectivity",
      severity: "warning",
      title: "No listening addresses",
      detail: "Your node has no public addresses. Other nodes cannot connect to you.",
    });
  }

  return alerts;
}

function liquidityRules(channels: Channel[]): Alert[] {
  const alerts: Alert[] = [];
  const ready = channels.filter((c) => c.state.state_name === "ChannelReady");

  let totalLocal = 0n;
  let totalRemote = 0n;

  for (const ch of ready) {
    const local = hexToBigInt(ch.local_balance);
    const remote = hexToBigInt(ch.remote_balance);
    totalLocal += local;
    totalRemote += remote;

    if (local === 0n) {
      alerts.push({
        id: `liq-zero-local-${ch.channel_id}`,
        category: "liquidity",
        severity: "warning",
        title: `Channel ${trunc(ch.channel_id)} has zero outbound`,
        detail: "You cannot send payments through this channel. Receive a payment or rebalance.",
      });
    }
    if (remote === 0n) {
      alerts.push({
        id: `liq-zero-remote-${ch.channel_id}`,
        category: "liquidity",
        severity: "warning",
        title: `Channel ${trunc(ch.channel_id)} has zero inbound`,
        detail: "You cannot receive payments through this channel. Send a payment or rebalance.",
      });
    }
  }

  if (ready.length > 0 && totalLocal === 0n) {
    alerts.push({
      id: "liq-no-outbound",
      category: "liquidity",
      severity: "critical",
      title: "No outbound liquidity",
      detail: "All channels have zero local balance. You cannot send any payments.",
    });
  }

  if (ready.length > 0) {
    alerts.push({
      id: "liq-summary",
      category: "liquidity",
      severity: "info",
      title: `Total capacity: ${shannonsToCkb(totalLocal.toString())} CKB local, ${shannonsToCkb(totalRemote.toString())} CKB remote`,
      detail: `Across ${ready.length} active channel${ready.length > 1 ? "s" : ""}.`,
    });
  }

  return alerts;
}

function routingRules(nodeInfo: NodeInfo | undefined, channels: Channel[]): Alert[] {
  const alerts: Alert[] = [];

  if (!nodeInfo) return alerts;

  const feeRatePpm = Number(BigInt(nodeInfo.tlc_fee_proportional_millionths || "0x0"));
  const feeRatePct = (feeRatePpm / 10_000).toFixed(4);

  if (feeRatePpm === 0 && channels.length > 0) {
    alerts.push({
      id: "route-free",
      category: "routing",
      severity: "warning",
      title: "Fee rate is 0 ppm",
      detail: "You are forwarding payments for free. Set a fee rate in Channels > Update to earn routing income.",
    });
  } else if (feeRatePpm > 0) {
    alerts.push({
      id: "route-fee",
      category: "routing",
      severity: "info",
      title: `Fee rate: ${feeRatePpm} ppm (${feeRatePct}%)`,
      detail: `You earn ${feeRatePpm} parts per million on every payment forwarded through your node.`,
    });
  }

  if (channels.length === 0) {
    alerts.push({
      id: "route-no-channels",
      category: "routing",
      severity: "info",
      title: "No channels open",
      detail: "Open channels to start routing payments and earning fees.",
    });
  }

  return alerts;
}

// ── Main evaluator ──────────────────────────────────────────────────────────

export function evaluateRules(data: MonitorInput): Alert[] {
  const alerts: Alert[] = [];

  alerts.push(...channelHealthRules(data.channels));
  alerts.push(...connectivityRules(data.nodeInfo, data.peers));
  alerts.push(...liquidityRules(data.channels));
  alerts.push(...routingRules(data.nodeInfo, data.channels));

  return alerts;
}
