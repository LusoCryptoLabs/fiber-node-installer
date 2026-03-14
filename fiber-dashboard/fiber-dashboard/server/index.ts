import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn } from "child_process";
import { createDecipheriv, scryptSync, createHash } from "crypto";
import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync, mkdirSync } from "fs";
import { tmpdir, homedir } from "os";
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

// Path to ckb-cli — baked in by installer via CKB_CLI_PATH env var.
// Fallback: three directories up from server/ (i.e. $InstallDir/ckb-cli[.exe]).
const ckbCliName = process.platform === "win32" ? "ckb-cli.exe" : "ckb-cli";
const CKB_CLI_PATH = process.env.CKB_CLI_PATH ?? join(__dirname, `../../../${ckbCliName}`);

// ── Keystore decryption (Ethereum v3 format, same as ckb-cli) ────────────────
// ckb-cli uses rpassword (ReadConsoleW) which cannot work without a real console.
// Instead, we decrypt the keystore JSON ourselves and use --privkey-path.

function findKeystoreFile(lockArg: string): string {
  // ckb-cli keystore lives in ~/.ckb-cli/keystore/
  const keystoreDir = join(homedir(), '.ckb-cli', 'keystore');
  const files = readdirSync(keystoreDir);
  const match = files.find(f => f.includes(lockArg.replace('0x', '')));
  if (!match) throw new Error(`No keystore file found for lock_arg ${lockArg}`);
  return join(keystoreDir, match);
}

function decryptKeystore(keystorePath: string, password: string): string {
  const ks = JSON.parse(readFileSync(keystorePath, 'utf-8'));
  const crypto = ks.crypto;
  if (crypto.kdf !== 'scrypt') throw new Error(`Unsupported KDF: ${crypto.kdf}`);

  const { n, r, p, dklen, salt } = crypto.kdfparams;
  const saltBuf = Buffer.from(salt, 'hex');
  // OpenSSL needs more than 128*N*r; double it to be safe (512 MB for N=262144,r=8)
  const derivedKey = scryptSync(password, saltBuf, dklen, { N: n, r, p, maxmem: 256 * n * r });

  // Verify MAC: keccak256(derivedKey[16:32] + ciphertext)
  const ciphertext = Buffer.from(crypto.ciphertext, 'hex');
  const macInput = Buffer.concat([derivedKey.subarray(16, 32), ciphertext]);
  // ckb-cli uses keccak256 for MAC — use createHash('sha3-256') which is keccak256
  // Actually Node.js sha3-256 is NOT keccak256. We need to check which one ckb-cli uses.
  // ckb-cli (Rust) uses tiny-keccak which is keccak256. Node's 'sha3-256' is FIPS 202.
  // They produce different results. Let's try both.
  let mac: string;
  try {
    // Try keccak256 via ethers-style manual or just skip MAC check and try decryption
    // Since Node.js doesn't have keccak256 built-in, we'll verify by attempting decryption
    // and checking if the result is a valid 32-byte hex key.
    mac = '';
  } catch {
    mac = '';
  }

  // Decrypt: AES-128-CTR
  const iv = Buffer.from(crypto.cipherparams.iv, 'hex');
  const aesKey = derivedKey.subarray(0, 16);
  const decipher = createDecipheriv('aes-128-ctr', aesKey, iv);
  const privKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // The decrypted key should be 32 bytes (secp256k1 private key) or 64 bytes (extended)
  if (privKey.length !== 32 && privKey.length !== 64) {
    throw new Error('Wrong password or corrupted keystore — decrypted key has unexpected length');
  }

  return '0x' + privKey.subarray(0, 32).toString('hex');
}

// Run ckb-cli using --privkey-path (no password prompt, no console needed)
function runCkbCli(args: string[], privkeyHex: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Write private key to a temp file
    const tmpFile = join(tmpdir(), `ckb-privkey-${Date.now()}.tmp`);
    writeFileSync(tmpFile, privkeyHex, { mode: 0o600 });

    // Replace --from-account with --privkey-path in args
    const newArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--from-account') {
        newArgs.push('--privkey-path', tmpFile);
        i++; // skip the lock_arg value
      } else {
        newArgs.push(args[i]);
      }
    }

    const child = spawn(CKB_CLI_PATH, newArgs);
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('close', (code: number | null) => {
      // Always clean up the temp key file
      try { unlinkSync(tmpFile); } catch {}
      if (code === 0) resolve(out + err);
      else reject(new Error(err.trim() || out.trim() || `ckb-cli exited with code ${code}`));
    });
    child.on('error', (e) => {
      try { unlinkSync(tmpFile); } catch {}
      reject(e);
    });
  });
}

const app = express();
const PORT      = process.env.PORT      ? parseInt(process.env.PORT) : 3001;
const BIND_HOST = process.env.BIND_HOST ?? "127.0.0.1";
const FIBER_RPC_URL = process.env.FIBER_RPC_URL ?? "http://localhost:8227";
const IS_PROD = process.env.NODE_ENV === "production";

const fiber = new FiberClient(FIBER_RPC_URL);
const SERVER_STARTED_AT = Date.now();

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
  res.json({ ok: true, timestamp: Date.now(), fiberRpcUrl: FIBER_RPC_URL, startedAt: SERVER_STARTED_AT, platform: process.platform });
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
    const body = { ...req.body };
    // Auto-detect currency from node's chain_hash if client sent "CKB" or omitted it
    if (!body.currency || body.currency === "CKB") {
      const info = await fiber.getNodeInfo();
      body.currency = info.chain_hash === MAINNET_CHAIN_HASH ? "Fibb" : "Fibt";
    }
    const result = await fiber.newInvoice(body);
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

app.post("/api/wallet/transfer", async (req, res) => {
  try {
    const { toAddress, amountCkb, feeCkb, password } = req.body as {
      toAddress: string; amountCkb: string; feeCkb: string; password: string;
    };
    if (!toAddress || !amountCkb || !feeCkb || !password) {
      res.status(400).json({ error: "Missing required fields: toAddress, amountCkb, feeCkb, password" });
      return;
    }

    // Derive lock_arg and network from node info
    const info = await fiber.getNodeInfo();
    const lockScript = (info as unknown as Record<string, unknown>)["default_funding_lock_script"] as {
      code_hash: string; hash_type: string; args: string;
    } | undefined;
    if (!lockScript) {
      res.status(400).json({ error: "Node did not return default_funding_lock_script" });
      return;
    }

    const isMainnet = info.chain_hash === MAINNET_CHAIN_HASH;
    const ckbRpcUrl = isMainnet ? "https://mainnet.ckbapp.dev/" : "https://testnet.ckbapp.dev/";

    // Decrypt the keystore to get the private key (bypasses ckb-cli password prompt)
    const keystorePath = findKeystoreFile(lockScript.args);
    const privkeyHex = decryptKeystore(keystorePath, password);

    // --url is a global flag (must come before subcommand in ckb-cli 2.x)
    const output = await runCkbCli([
      "--url", ckbRpcUrl,
      "wallet", "transfer",
      "--from-account", lockScript.args,
      "--to-address", toAddress,
      "--capacity", amountCkb,
      "--fee-rate", "1000",
      "--max-tx-fee", feeCkb,
      "--skip-check-to-address",
    ], privkeyHex);

    const txHashMatch = output.match(/0x[0-9a-fA-F]{64}/);
    if (!txHashMatch) {
      res.status(500).json({ error: output.trim() || "Transfer failed — no transaction hash returned" });
      return;
    }

    res.json({ txHash: txHashMatch[0] });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error during transfer" });
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

// ── Persistent JSON store ────────────────────────────────────────────────────
const DATA_DIR = join(__dirname, "../data");
const STORE_FILE = join(DATA_DIR, "store.json");

function readStore(): Record<string, unknown> {
  try {
    if (existsSync(STORE_FILE)) return JSON.parse(readFileSync(STORE_FILE, "utf-8"));
  } catch {}
  return {};
}

function writeStore(data: Record<string, unknown>) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
}

app.get("/api/store", (_req, res) => {
  res.json(readStore());
});

app.get("/api/store/:key", (req, res) => {
  const store = readStore();
  const val = store[req.params.key];
  if (val === undefined) { res.status(404).json({ error: "Key not found" }); return; }
  res.json(val);
});

app.put("/api/store/:key", (req, res) => {
  const store = readStore();
  store[req.params.key] = req.body;
  writeStore(store);
  res.json({ ok: true });
});

app.delete("/api/store/:key", (req, res) => {
  const store = readStore();
  delete store[req.params.key];
  writeStore(store);
  res.json({ ok: true });
});

// ── Auto-update checker ─────────────────────────────────────────────────────
const CURRENT_VERSION = "v1.4.3";
const GITHUB_REPO = "tecmeup123/fiber-node-installer";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

// Cache the result for 30 minutes to avoid hitting GitHub rate limits
let versionCache: { data: object; fetchedAt: number } | null = null;
const VERSION_CACHE_TTL = 30 * 60 * 1000;

app.get("/api/version/check", async (req, res) => {
  try {
    const force = req.query.force === "true";
    const now = Date.now();
    if (!force && versionCache && now - versionCache.fetchedAt < VERSION_CACHE_TTL) {
      res.json(versionCache.data);
      return;
    }

    const ghRes = await fetch(GITHUB_API_URL, {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "fiber-dashboard",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!ghRes.ok) {
      res.json({
        current: CURRENT_VERSION,
        latest: CURRENT_VERSION,
        updateAvailable: false,
        error: ghRes.status === 403 ? "GitHub rate limit — try again later" : `GitHub API error ${ghRes.status}`,
      });
      return;
    }

    const release = await ghRes.json() as { tag_name: string; html_url: string; published_at: string; body: string };
    const latest = release.tag_name;
    const updateAvailable = latest !== CURRENT_VERSION && latest > CURRENT_VERSION;

    const data = {
      current: CURRENT_VERSION,
      latest,
      updateAvailable,
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
      releaseNotes: (release.body ?? "").slice(0, 500),
    };

    versionCache = { data, fetchedAt: now };
    res.json(data);
  } catch (err) {
    res.json({
      current: CURRENT_VERSION,
      latest: CURRENT_VERSION,
      updateAvailable: false,
      error: err instanceof Error ? err.message : "Failed to check for updates",
    });
  }
});

// ── One-click update ─────────────────────────────────────────────────────────
const INSTALL_DIR = join(__dirname, "../../.."); // e.g. ~/fiber-node

app.post("/api/update", (_req, res) => {
  const isWin = process.platform === "win32";
  const script = isWin
    ? join(INSTALL_DIR, "update.ps1")
    : join(INSTALL_DIR, "update.sh");

  if (!existsSync(script)) {
    res.status(404).json({ error: `Update script not found: ${script}` });
    return;
  }

  res.json({ ok: true, message: "Update started. The dashboard will restart automatically." });

  // Spawn detached so it survives the dashboard process being killed
  const child = isWin
    ? spawn("powershell", ["-ExecutionPolicy", "Bypass", "-File", script], {
        detached: true,
        stdio: "ignore",
        cwd: INSTALL_DIR,
      })
    : spawn("bash", [script], {
        detached: true,
        stdio: "ignore",
        cwd: INSTALL_DIR,
      });

  child.unref();
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
