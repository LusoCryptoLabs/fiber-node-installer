export type {
  Hash256,
  Pubkey,
  HexUint64,
  HexUint128,
  Currency,
  ChannelState,
  CkbInvoiceStatus,
  PaymentStatus,
  HashAlgorithm,
  NodeInfo,
  PeerInfo,
  Channel,
  ChannelInfo,
  ChannelUpdateInfo,
  GraphNode,
  CkbInvoice,
  InvoiceData,
  InvoiceAttribute,
  PaymentResult,
  NewInvoiceResult,
  ParseInvoiceResult,
  GetInvoiceResult,
  OpenChannelParams,
  ShutdownChannelParams,
  UpdateChannelParams,
  SendPaymentParams,
  BuildRouterResult,
  RouterHop,
} from "../../ckb-fiber/index.js";

export { shannonsToCkb, ckbToShannons } from "../../ckb-fiber/index.js";

export interface DashboardConfig {
  fiberRpcUrl: string;
  theme: "dark" | "light";
}

export interface TabId {
  id:
    | "overview"
    | "channels"
    | "payments"
    | "invoices"
    | "peers"
    | "graph"
    | "wallet"
    | "settings";
  label: string;
}

export interface SessionPayment {
  payment_hash: string;
  amount: string;
  invoice?: string;
  status: "Created" | "InFlight" | "Success" | "Failed";
  createdAt: number;
  lastError?: string;
}

/** A point-in-time snapshot of channel balances */
export interface BalanceSnapshot {
  ts: number;
  totalLocal: string;   // decimal string shannons
  totalRemote: string;  // decimal string shannons
  channelCount: number;
  channels: { id: string; local: string; remote: string }[];
}

/** A single inferred routing fee event */
export interface FeeEvent {
  ts: number;
  amount: string;       // decimal string shannons (positive)
  prevTotal: string;
  newTotal: string;
  channelsChanged: { id: string; delta: string }[];
}

/** Persisted balance history (server store key: "balance_history") */
export interface BalanceHistory {
  snapshots: BalanceSnapshot[];
  lastSnapshotTs: number;
}

/** Persisted fee events log (server store key: "fee_events") */
export interface FeeEventsLog {
  events: FeeEvent[];
  totalEarned: string;  // decimal string shannons, running total
}
