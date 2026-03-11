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
