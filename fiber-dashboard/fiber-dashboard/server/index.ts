import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { FiberClient, FiberRpcException } from "../../ckb-fiber/index.js";

// ── Bech32m encoding for CKB address derivation (RFC 0021 full format) ────────
const BECH32M_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;
const BECH32M_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32mPolymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) chk ^= (b >> i) & 1 ? BECH32M_GEN[i] : 0;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const r: number[] = [];
  for (const c of hrp) r.push(c.charCodeAt(0) >> 5);
  r.push(0);
  for (const c of hrp) r.push(c.charCodeAt(0) & 31);
  return r;
}

function bech32mChecksum(hrp: string, data: number[]): number[] {
  const poly = bech32mPolymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ BECH32M_CONST;
  return [0, 1, 2, 3, 4, 5].map(i => (poly >> (5 * (5 - i))) & 31);
}

function convertBits(data: number[], from: number, to: number): number[] {
  let acc = 0, bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) { bits -= to; ret.push((acc >> bits) & maxv); }
  }
  if (bits > 0) ret.push((acc << (to - bits)) & maxv);
  return ret;
}

function encodeCkbAddress(
  lockScript: { code_hash: string; hash_type: string; args: string },
  isMainnet: boolean
): string {
  const hrp = isMainnet ? 'ckb' : 'ckt';
  const hashTypeByte = lockScript.hash_type === 'type' ? 0x01 : lockScript.hash_type === 'data1' ? 0x02 : 0x00;
  const codeHash = Buffer.from(lockScript.code_hash.replace(/^0x/, ''), 'hex');
  const args = lockScript.args.length > 2 ? Buffer.from(lockScript.args.replace(/^0x/, ''), 'hex') : Buffer.alloc(0);
  const payload = Buffer.concat([Buffer.from([0x00]), codeHash, Buffer.from([hashTypeByte]), args]);
  const data5 = convertBits(Array.from(payload), 8, 5);
  const checksum = bech32mChecksum(hrp, data5);
  return hrp + '1' + [...data5, ...checksum].map(d => BECH32M_CHARSET[d]).join('');
}

const MAINNET_CHAIN_HASH = '0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT      = process.env.PORT      ? parseInt(process.env.PORT) : 3001;
const BIND_HOST = process.env.BIND_HOST ?? "127.0.0.1";
const FIBER_RPC_URL = process.env.FIBER_RPC_URL ?? "http://localhost:8227";
const IS_PROD = process.env.NODE_ENV === "production";

const fiber = new FiberClient(FIBER_RPC_URL);

app.use(cors());
app.use(express.json());

function handleError(res: express.Response, err: unknown) {
  if (err instanceof FiberRpcException) {
    res.status(400).json({ error: err.message, code: err.code });
  } else if (err instanceof Error) {
    const isConnRefused = err.message.includes("ECONNREFUSED") || err.message.includes("fetch");
    res.status(isConnRefused ? 503 : 500).json({
      error: isConnRefused
        ? `Cannot connect to Fiber node at ${FIBER_RPC_URL}. Is it running?`
        : err.message,
    });
  } else {
    res.status(500).json({ error: "Unknown error" });
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: Date.now(), fiberRpcUrl: FIBER_RPC_URL });
});

app.get("/api/node-info", async (_req, res) => {
  try {
    const info = await fiber.getNodeInfo();
    res.json(info);
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/channels", async (_req, res) => {
  try {
    const result = await fiber.listChannels({});
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/channels/open", async (req, res) => {
  try {
    const result = await fiber.openChannel(req.body);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/channels/close", async (req, res) => {
  try {
    await fiber.shutdownChannel(req.body);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/channels/abandon", async (req, res) => {
  try {
    await fiber.abandonChannel(req.body.channel_id);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/channels/update", async (req, res) => {
  try {
    await fiber.updateChannel(req.body);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/peers", async (_req, res) => {
  try {
    const result = await fiber.listPeers();
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/peers/connect", async (req, res) => {
  try {
    await fiber.connectPeer(req.body.address, req.body.save ?? false);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/peers/disconnect", async (req, res) => {
  try {
    await fiber.disconnectPeer(req.body.peer_id);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/invoices/create", async (req, res) => {
  try {
    const result = await fiber.newInvoice(req.body);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/invoices/parse", async (req, res) => {
  try {
    const result = await fiber.parseInvoice(req.body.invoice);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/invoices/:hash", async (req, res) => {
  try {
    const result = await fiber.getInvoice(req.params.hash);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/invoices/:hash/cancel", async (req, res) => {
  try {
    const result = await fiber.cancelInvoice(req.params.hash);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/payments/send", async (req, res) => {
  try {
    const result = await fiber.sendPayment(req.body);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/payments/:hash", async (req, res) => {
  try {
    const result = await fiber.getPayment(req.params.hash);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/payments/route", async (req, res) => {
  try {
    const result = await fiber.buildRouter(req.body);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/wallet", async (_req, res) => {
  try {
    const info = await fiber.getNodeInfo();
    const lockScript = (info as Record<string, unknown>)["default_funding_lock_script"] as {
      code_hash: string; hash_type: string; args: string;
    } | undefined;

    if (!lockScript) {
      res.status(400).json({ error: "Node did not return default_funding_lock_script" });
      return;
    }

    const isMainnet = info.chain_hash === MAINNET_CHAIN_HASH;
    const address = encodeCkbAddress(lockScript, isMainnet);

    // Query CKB L1 for unspent capacity at this address
    const ckbRpcUrl = isMainnet ? "https://mainnet.ckbapp.dev/" : "https://testnet.ckbapp.dev/";
    let capacity = "0x0";
    try {
      const balRes = await fetch(ckbRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: 1, jsonrpc: "2.0", method: "get_cells_capacity",
          params: [{ script: { code_hash: lockScript.code_hash, hash_type: lockScript.hash_type, args: lockScript.args }, script_type: "lock" }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      const balData = await balRes.json() as { result?: { capacity: string } };
      capacity = balData.result?.capacity ?? "0x0";
    } catch {
      // L1 unreachable — return 0 and let the UI indicate stale data
    }

    res.json({ address, capacity, isMainnet, ckbRpcUrl });
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/graph/nodes", async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 200;
    const after = req.query.after as string | undefined;
    const result = await fiber.graphNodes({ limit: '0x' + limit.toString(16), after });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/graph/channels", async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 500;
    const after = req.query.after as string | undefined;
    const result = await fiber.graphChannels({ limit: '0x' + limit.toString(16), after });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

if (IS_PROD) {
  const distPath = join(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(join(distPath, "index.html"));
  });
  console.log(`[fiber-dashboard] Serving built frontend from ${distPath}`);
}

// BIND_HOST defaults to 127.0.0.1 (Linux/SSH-tunnel use case).
// Windows sets it to 0.0.0.0 and relies on the firewall to block external access.
app.listen(PORT, BIND_HOST, () => {
  console.log(`[fiber-dashboard] Server running on http://${BIND_HOST === "0.0.0.0" ? "localhost" : BIND_HOST}:${PORT}`);
  console.log(`[fiber-dashboard] Proxying Fiber RPC → ${FIBER_RPC_URL}`);
  if (IS_PROD) {
    console.log(`[fiber-dashboard] Dashboard available at http://localhost:${PORT}`);
  }
});
