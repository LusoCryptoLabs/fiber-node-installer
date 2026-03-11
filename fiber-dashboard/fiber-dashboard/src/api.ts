const getBaseUrl = () => {
  const stored = localStorage.getItem("fiber_rpc_override");
  return stored ? "" : "";
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const base = getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const data = await res.json().catch(() => ({ error: res.statusText }));

  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? "Request failed", data.code);
  }

  return data as T;
}

export const api = {
  getNodeInfo: () => apiFetch<import("./types.js").NodeInfo>("/api/node-info"),
  getChannels: () =>
    apiFetch<{ channels: import("./types.js").Channel[] }>("/api/channels"),
  openChannel: (body: import("./types.js").OpenChannelParams) =>
    apiFetch<{ temporary_channel_id: string }>("/api/channels/open", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  closeChannel: (body: import("./types.js").ShutdownChannelParams) =>
    apiFetch<{ ok: boolean }>("/api/channels/close", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  abandonChannel: (channel_id: string) =>
    apiFetch<{ ok: boolean }>("/api/channels/abandon", {
      method: "POST",
      body: JSON.stringify({ channel_id }),
    }),
  updateChannel: (body: import("./types.js").UpdateChannelParams) =>
    apiFetch<{ ok: boolean }>("/api/channels/update", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getPeers: () =>
    apiFetch<{ peers: import("./types.js").PeerInfo[] }>("/api/peers"),
  connectPeer: (address: string, save = false) =>
    apiFetch<{ ok: boolean }>("/api/peers/connect", {
      method: "POST",
      body: JSON.stringify({ address, save }),
    }),
  disconnectPeer: (peer_id: string) =>
    apiFetch<{ ok: boolean }>("/api/peers/disconnect", {
      method: "POST",
      body: JSON.stringify({ peer_id }),
    }),
  createInvoice: (body: object) =>
    apiFetch<import("./types.js").NewInvoiceResult>("/api/invoices/create", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  parseInvoice: (invoice: string) =>
    apiFetch<import("./types.js").ParseInvoiceResult>("/api/invoices/parse", {
      method: "POST",
      body: JSON.stringify({ invoice }),
    }),
  getInvoice: (hash: string) =>
    apiFetch<import("./types.js").GetInvoiceResult>(`/api/invoices/${hash}`),
  cancelInvoice: (hash: string) =>
    apiFetch<{ status: string }>(`/api/invoices/${hash}/cancel`, {
      method: "POST",
    }),
  sendPayment: (body: import("./types.js").SendPaymentParams) =>
    apiFetch<import("./types.js").PaymentResult>("/api/payments/send", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getPayment: (hash: string) =>
    apiFetch<import("./types.js").PaymentResult>(`/api/payments/${hash}`),
  getGraphNodes: (limit = 200) =>
    apiFetch<{ nodes: import("./types.js").GraphNode[] }>(
      `/api/graph/nodes?limit=${limit}`
    ),
  getGraphChannels: (limit = 500) =>
    apiFetch<{ channels: import("./types.js").ChannelInfo[] }>(
      `/api/graph/channels?limit=${limit}`
    ),
  getWallet: () =>
    apiFetch<{ address: string; capacity: string; isMainnet: boolean; ckbRpcUrl: string }>("/api/wallet"),
  transferCkb: (body: { toAddress: string; amountCkb: string; feeCkb: string; password: string }) =>
    apiFetch<{ txHash: string }>("/api/wallet/transfer", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  health: () => apiFetch<{ ok: boolean; timestamp: number; startedAt: number }>("/api/health"),
};
