/**
 * FiberClient — JSON-RPC 2.0 client for the Fiber Network Node RPC API.
 * Used by the fiber-dashboard Express server to proxy calls to the node.
 */

// ── Unit helpers ─────────────────────────────────────────────────────────────
// 1 CKB = 100_000_000 shannons (like satoshis)
const SHANNONS_PER_CKB = BigInt(100_000_000);

/**
 * Convert shannons (hex string "0x…" or decimal string) to a CKB display string.
 * @param {string} shannons
 * @returns {string}  e.g. "100.5"
 */
export function shannonsToCkb(shannons) {
  const value = BigInt(shannons); // handles both "0x..." and decimal
  const whole = value / SHANNONS_PER_CKB;
  const frac  = value % SHANNONS_PER_CKB;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(8, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

/**
 * Convert a CKB amount (number) to a hex shannon string for the Fiber RPC.
 * @param {number} ckb
 * @returns {string}  e.g. "0x3b9aca00"
 */
export function ckbToShannons(ckb) {
  const shannons = BigInt(Math.round(ckb * 100_000_000));
  return '0x' + shannons.toString(16);
}

export class FiberRpcException extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FiberRpcException';
    this.code = code;
  }
}

export class FiberClient {
  constructor(rpcUrl) {
    this.rpcUrl = rpcUrl;
    this._id = 0;
  }

  async _call(method, params = []) {
    const id = ++this._id;
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from Fiber RPC at ${this.rpcUrl}`);
    }
    const data = await res.json();
    if (data.error) {
      throw new FiberRpcException(data.error.message, data.error.code);
    }
    return data.result;
  }

  // Node
  getNodeInfo()              { return this._call('node_info'); }

  // Channels
  listChannels(params)       { return this._call('list_channels', [params]); }
  openChannel(params)        { return this._call('open_channel', [params]); }
  shutdownChannel(params)    { return this._call('shutdown_channel', [params]); }
  abandonChannel(channel_id) { return this._call('abandon_channel', [{ channel_id }]); }
  updateChannel(params)      { return this._call('update_channel', [params]); }

  // Peers
  listPeers()                { return this._call('list_peers'); }
  connectPeer(address, save) { return this._call('connect_peer', [{ address, save }]); }
  disconnectPeer(peer_id)    { return this._call('disconnect_peer', [{ peer_id }]); }

  // Invoices
  newInvoice(params)         { return this._call('new_invoice', [params]); }
  parseInvoice(invoice)      { return this._call('parse_invoice', [{ invoice }]); }
  getInvoice(payment_hash)   { return this._call('get_invoice', [{ payment_hash }]); }
  cancelInvoice(payment_hash){ return this._call('cancel_invoice', [{ payment_hash }]); }

  // Payments
  sendPayment(params)        { return this._call('send_payment', [params]); }
  getPayment(payment_hash)   { return this._call('get_payment', [{ payment_hash }]); }
  buildRouter(params)        { return this._call('build_router', [params]); }

  // Graph
  graphNodes(params)         { return this._call('graph_nodes', [params]); }
  graphChannels(params)      { return this._call('graph_channels', [params]); }
}
