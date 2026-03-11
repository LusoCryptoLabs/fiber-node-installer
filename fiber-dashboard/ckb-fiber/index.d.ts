// Type declarations for the ckb-fiber JSON-RPC client package.

// ── Primitives ───────────────────────────────────────────────────────────────
export type Hash256   = string; // "0x" + 64 hex chars
export type Pubkey    = string; // "0x" + 66 hex chars (compressed secp256k1)
export type HexUint64 = string; // "0x" + up to 16 hex chars
export type HexUint128 = string; // "0x" + up to 32 hex chars

// ── Enums ────────────────────────────────────────────────────────────────────
export type Currency = 'Ckb' | 'CkbTestNet';
export type HashAlgorithm = 'CkbHash' | 'Sha256';
export type ChannelState =
  | 'NegotiatingFunding'
  | 'CollaboratingFundingTx'
  | 'SigningCommitment'
  | 'AwaitingTxSignatures'
  | 'AwaitingChannelReady'
  | 'ChannelReady'
  | 'ShuttingDown'
  | 'Closed';
export type CkbInvoiceStatus = 'Open' | 'Cancelled' | 'Expired' | 'Paid' | 'Received';
export type PaymentStatus = 'Created' | 'InFlight' | 'Success' | 'Failed';

// ── Node ─────────────────────────────────────────────────────────────────────
export interface NodeInfo {
  node_id: Pubkey;
  node_name: string;
  addresses: string[];
  is_announced: boolean;
  chain_hash: Hash256;
  open_channel_auto_accept_min_ckb_funding_amount: HexUint64;
  auto_accept_channel_ckb_funding_amount: HexUint64;
  tlc_locktime_expiry_delta: number;
  tlc_min_value: HexUint128;
  tlc_max_value: HexUint128;
  tlc_fee_proportional_millionths: HexUint128;
  channel_count: number;
  pending_channel_count: number;
  peers_count: number;
  udt_cfg_infos: unknown[];
}

// ── Peers ────────────────────────────────────────────────────────────────────
export interface PeerInfo {
  pubkey: Pubkey;   // secp256k1 compressed public key — use for channel ops
  peer_id: string;  // libp2p PeerID (Qm…) — appears at end of multiaddr
  address: string;  // full multiaddr connection string
}

// ── Channels ─────────────────────────────────────────────────────────────────
export interface Channel {
  channel_id: Hash256;
  peer_id: Pubkey;
  funding_udt_type_script: unknown | null;
  state: { state_name: ChannelState; state_flags: string[] };
  local_balance: HexUint128;
  remote_balance: HexUint128;
  offered_tlc_balance: HexUint128;
  received_tlc_balance: HexUint128;
  created_at: HexUint64;
}

export interface OpenChannelParams {
  peer_id: Pubkey;
  funding_amount: HexUint64;
  public?: boolean;
  funding_udt_type_script?: unknown;
}

export interface ShutdownChannelParams {
  channel_id: Hash256;
  close_script: unknown | null;
  fee_rate: HexUint64;
  force?: boolean;
}

export interface UpdateChannelParams {
  channel_id: Hash256;
  enabled?: boolean;
  tlc_locktime_expiry_delta?: number;
  tlc_minimum_value?: HexUint128;
  tlc_maximum_value?: HexUint128;
  tlc_fee_proportional_millionths?: HexUint128;
}

// ── Graph ────────────────────────────────────────────────────────────────────
export interface ChannelUpdateInfo {
  timestamp: number;
  enabled: boolean;
  tlc_locktime_expiry_delta: number;
  tlc_minimum_value: HexUint128;
  tlc_maximum_value: HexUint128;
  tlc_fee_proportional_millionths: HexUint128;
}

export interface ChannelInfo {
  channel_outpoint: string;
  funding_tx_block_number: HexUint64;
  funding_tx_index: number;
  node1: Pubkey;
  node2: Pubkey;
  last_updated_timestamp: HexUint64;
  created_timestamp: HexUint64;
  node1_to_node2: ChannelUpdateInfo | null;
  node2_to_node1: ChannelUpdateInfo | null;
  capacity: HexUint128;
  chain_hash: Hash256;
  udt_type_script: unknown | null;
}

export interface GraphNode {
  node_id: Pubkey;
  timestamp: HexUint64;
  addresses: string[];
  node_name: string;
  auto_accept_min_ckb_funding_amount: HexUint64;
}

// ── Invoices ─────────────────────────────────────────────────────────────────
export interface InvoiceAttribute {
  type: string;
  value: string;
}

export interface InvoiceData {
  timestamp: HexUint64;
  payment_hash: Hash256;
  attrs: InvoiceAttribute[];
  amount?: HexUint128;
}

export interface CkbInvoice {
  currency: Currency;
  amount: HexUint128 | null;
  signature?: string;
  data: InvoiceData;
}

export interface NewInvoiceResult {
  invoice_address: string;
  invoice: CkbInvoice;
}

export interface ParseInvoiceResult {
  invoice: CkbInvoice;
}

export interface GetInvoiceResult {
  invoice_address: string;
  invoice: CkbInvoice;
  status: CkbInvoiceStatus;
}

// ── Payments ─────────────────────────────────────────────────────────────────
export interface RouterHop {
  channel_outpoint: string;
  next_hop: Pubkey | null;
  pubkey: Pubkey;
  amount_forward: HexUint128;
  tlc_expiry_delta: number;
  funding_tx_hash: Hash256;
  channel_capacity: HexUint128;
}

export interface BuildRouterResult {
  hops: RouterHop[];
}

export interface PaymentResult {
  payment_hash: Hash256;
  status: PaymentStatus;
  failed_error?: string;
  last_updated_at: HexUint64;
  fee: HexUint128;
}

export interface SendPaymentParams {
  invoice?: string;
  target_pubkey?: Pubkey;
  amount?: HexUint128;
  payment_hash?: Hash256;
  final_tlc_expiry_delta?: number;
  tlc_expiry_limit?: number;
  invoice_after_send?: boolean;
  timeout?: number;
  max_fee_amount?: HexUint128;
  max_parts?: number;
  keysend?: boolean;
  udt_type_script?: unknown;
  allow_self_payment?: boolean;
  dry_run?: boolean;
}

// ── Unit helpers ─────────────────────────────────────────────────────────────
export function shannonsToCkb(shannons: string): string;
export function ckbToShannons(ckb: number): string;

// ── RPC client ───────────────────────────────────────────────────────────────
export class FiberRpcException extends Error {
  code: number | undefined;
  constructor(message: string, code?: number);
}

export class FiberClient {
  constructor(rpcUrl: string);
  getNodeInfo(): Promise<NodeInfo>;
  listChannels(params: object): Promise<{ channels: Channel[] }>;
  openChannel(params: OpenChannelParams): Promise<{ temporary_channel_id: string }>;
  shutdownChannel(params: ShutdownChannelParams): Promise<void>;
  abandonChannel(channel_id: string): Promise<void>;
  updateChannel(params: UpdateChannelParams): Promise<void>;
  listPeers(): Promise<{ peers: PeerInfo[] }>;
  connectPeer(address: string, save: boolean): Promise<void>;
  disconnectPeer(peer_id: string): Promise<void>;
  newInvoice(params: object): Promise<NewInvoiceResult>;
  parseInvoice(invoice: string): Promise<ParseInvoiceResult>;
  getInvoice(payment_hash: string): Promise<GetInvoiceResult>;
  cancelInvoice(payment_hash: string): Promise<{ status: string }>;
  sendPayment(params: SendPaymentParams): Promise<PaymentResult>;
  getPayment(payment_hash: string): Promise<PaymentResult>;
  buildRouter(params: object): Promise<BuildRouterResult>;
  graphNodes(params: object): Promise<{ nodes: GraphNode[] }>;
  graphChannels(params: object): Promise<{ channels: ChannelInfo[] }>;
}
