# Fiber Network Node — Setup Guide

This guide walks you through installing your own Fiber Network Node — the node software **and** the web dashboard that lets you manage it. No technical experience needed. Just follow the steps in order.

---

## What You Get

Running a Fiber Network Node gives you a full Lightning-style payment node on the CKB blockchain, plus a private web dashboard to control everything.

### Instant, near-zero-fee payments
Standard CKB transactions confirm in ~10 seconds. Fiber payments are **instant** and cost a fraction of a cent — no waiting, no per-transaction overhead. Once your channels are open, payments settle in milliseconds.

### You earn routing fees
Every payment that flows *through* your node earns you a small fee. The more liquidity you provide and the better your uptime, the more traffic your node attracts — passive income for keeping the network healthy.

### Infrastructure you actually own
Your keys stay on your own machine. Your node connects directly to peers. You control your liquidity, your channels, and your fees — no third-party service in between.

### Support the CKB ecosystem
Fiber is CKB's answer to Bitcoin's Lightning Network. Every node that joins adds capacity and reliability to the whole network — more nodes means payments route more easily for everyone.

### Developer and builder access
If you're building apps that need fast CKB payments, running your own node gives you a direct, low-latency RPC endpoint — no rate limits, no third-party dependencies.

---

## The Dashboard

The installer optionally sets up a **private web dashboard** at `http://localhost:3333` (Windows) or via SSH tunnel on Linux. Here's what you can do from it:

| Tab | What it does |
|-----|-------------|
| **Overview** | Node status, open channels, peer count, local balance, uptime, and routing income earned |
| **Channels** | Open channels to peers, close channels, update fee rates, and see channel liquidity at a glance |
| **Payments** | Send payments by invoice or direct keysend; live status tracking per payment |
| **Invoices** | Create payment requests to receive funds; copy invoice strings; live paid/expired status; cancel open invoices |
| **Peers** | Connect to peers by address, disconnect, and browse connected peers |
| **Network Graph** | Interactive force-directed map of all known nodes and channels on the network |
| **Wallet** | View your on-chain CKB address and balance; send CKB to any address |
| **Settings** | Change the RPC URL the dashboard connects to |

> The dashboard is **local only** — it has no login screen, but the installer adds a firewall rule so only your own machine can reach it.

---

## Quick Install — One-Liner for Any Server

SSH into your server and run a single command. No files to download manually.

### Linux / VPS (Ubuntu · Debian)

```bash
curl -sSL https://raw.githubusercontent.com/tecmeup123/fiber-node-installer/master/install-fiber.sh \
  -o install-fiber.sh && chmod +x install-fiber.sh && ./install-fiber.sh
```

Or with `wget` if curl is not available:

```bash
wget -qO install-fiber.sh https://raw.githubusercontent.com/tecmeup123/fiber-node-installer/master/install-fiber.sh \
  && chmod +x install-fiber.sh && ./install-fiber.sh
```

### Windows / Windows Server VPS

Open PowerShell **as Administrator** and run:

```powershell
irm https://raw.githubusercontent.com/tecmeup123/fiber-node-installer/master/install-fiber.ps1 `
  -OutFile install-fiber.ps1; Set-ExecutionPolicy Bypass -Scope Process -Force; .\install-fiber.ps1
```

> Both scripts are interactive — they guide you step by step and ask before making any changes.

---

## Before You Start

Make sure you have:

- **Windows 10/11** (64-bit) — for the Windows installer
- **Ubuntu or Debian Linux** — for the Linux installer
- A **stable internet connection**
- A **public IP address** (your home router IP, or a cloud server IP)
- About **15–30 minutes**

---

## Windows Installation

### Step 1 — Download the installer

Save both `install-fiber.ps1` **and** `run-installer.bat` to the same folder (e.g. your Desktop).

### Step 2 — Run the installer

You have two options:

**Option A — Double-click (simplest):**

Double-click `run-installer.bat`

> A black Command Prompt window will open and launch the installer. If Windows asks "Do you want to allow this app to make changes?", click **Yes**. The installer needs this to configure your firewall.

> **Note:** Do not right-click `install-fiber.ps1` and choose "Run with PowerShell" — Windows may block the script or fail to elevate it correctly. Always use `run-installer.bat` instead.

---

**Option B — Manual PowerShell (if Option A is blocked):**

1. Press `Win + S`, search for **PowerShell**, right-click it → **Run as Administrator**
2. Navigate to where you saved the file, for example:
   ```powershell
   cd "$env:USERPROFILE\Desktop"
   ```
3. Allow the script to run and launch it:
   ```powershell
   Set-ExecutionPolicy Bypass -Scope Process -Force
   .\install-fiber.ps1
   ```

> **Why run as Administrator?** The installer sets Windows Firewall rules to open port 8228 (P2P) and block ports 8227 (RPC) and 3333 (dashboard) from the internet. Without admin rights it cannot do this.

---

### Step 3 — Answer the prompts

The installer will ask you a few questions. Here's what each one means:

| Prompt | What to do |
|--------|-----------|
| `Enter 1 or 2` (Network) | Type `1` for Mainnet (real CKB) or `2` for Testnet (free test CKB) |
| `Use X.X.X.X as your public IP?` | Press **Enter** to accept — the installer detected it automatically |
| `Choose a name for your node` | Press **Enter** to keep the default, or type a nickname for your node |
| `Input new password` (ckb-cli) | **Invent a password** to protect your wallet file. You will need this again in a moment |
| `Repeat password` | Type the same password again |
| `Input password` (export) | Type the **same password** you just set |
| `Node password` | **Invent a second password** — this one protects your node's secret key. Store it somewhere safe |
| `Confirm password` | Type the node password again |
| `Register as Windows Service?` | Press **Enter** to say Yes — the node will start on boot without you logging in |
| `Install dashboard?` | Press **Enter** to say Yes — installs the web UI at `http://localhost:3333` |
| `Enable weekly auto-update?` | Press **Enter** to say Yes — keeps fnn up to date automatically |

> **Two passwords, two purposes:**
> - **ckb-cli password** — protects your wallet file. Only needed during setup.
> - **Node password** — protects the node's secret key. Saved in `start.ps1`. If you forget it, the node cannot start.

### Step 4 — Fund your wallet

After setup, you will see a green box with your **CKB funding address**. Send CKB to this address to enable payment channels.

- **Mainnet:** Send at least 1,000 CKB (10,000+ recommended for opening channels). Use JoyID or any CKB wallet.
- **Testnet:** Get free test CKB at [faucet.nervos.org](https://faucet.nervos.org)

> Minimum to open one channel: **100 CKB** (covers channel funding + on-chain fees).

### Step 5 — Your node is ready

Files created in `C:\Users\YourName\fiber-node\`:

| File | What it does |
|------|-------------|
| `start.ps1` | Starts your node manually |
| `start-dashboard.ps1` | Starts the web dashboard (if installed) |
| `update.ps1` | Updates fnn to the latest version |
| `uninstall.ps1` | Removes everything cleanly |
| `fnn.log` | Log output — check this if something goes wrong |
| `config.yml` | Node configuration |
| `ckb\key` | Your encrypted private key — **keep this safe, never share it** |

### Starting the node and dashboard (Windows)

Open **two separate PowerShell windows** — one for the node, one for the dashboard.

**Terminal 1 — node:**
```powershell
cd "$env:USERPROFILE\fiber-node"
.\start.ps1
```

**Terminal 2 — dashboard:**
```powershell
cd "$env:USERPROFILE\fiber-node"
.\start-dashboard.ps1
```

Then open **http://localhost:3333** in your browser.

> **Note:** If you registered the node as a Windows Service (NSSM) during install, the node is already running in the background — do **not** run `start.ps1` again or you will get a `fnn.log` file-lock error. Use the service commands below instead.

### Managing the node service (Windows)

**If registered as a Windows Service (NSSM):**
```powershell
# Check status
Get-Service FiberNetworkNode

# Start the node
Start-Service FiberNetworkNode

# Stop the node
Stop-Service FiberNetworkNode -Force

# Force-kill if the service won't stop
Get-Process fnn | Stop-Process -Force
```

**Manual update:**
```powershell
cd "$env:USERPROFILE\fiber-node"
PowerShell -ExecutionPolicy Bypass -File .\update.ps1
```

---

## Linux Installation (Ubuntu / Debian)

### Step 1 — Run the installer

SSH into your server and run:

```bash
curl -sSL https://raw.githubusercontent.com/tecmeup123/fiber-node-installer/master/install-fiber.sh \
  -o install-fiber.sh && chmod +x install-fiber.sh && ./install-fiber.sh
```

Or with `wget`:

```bash
wget -qO install-fiber.sh https://raw.githubusercontent.com/tecmeup123/fiber-node-installer/master/install-fiber.sh \
  && chmod +x install-fiber.sh && ./install-fiber.sh
```

> If prompted, enter your `sudo` password. The installer needs it to configure the firewall and create a background service.

### Step 2 — Answer the prompts

The installer guides you through each step with explanations. Key decisions:

| Prompt | What to do |
|--------|-----------|
| Network (1 or 2) | `1` for Mainnet, `2` for Testnet |
| Public IP | Press **Enter** to accept the auto-detected IP |
| Node name | Press **Enter** for default, or type a nickname |
| Set up firewall? | Type `y` — this is important for security |
| ckb-cli account password | Invent a password for your wallet keystore |
| Export password | Same password again |
| Node password (confirm twice) | Invent a password for the node's secret key |
| Install as background service? | The installer does this automatically (systemd) |
| Install dashboard? | Type `y` — installs the web UI (accessible via SSH tunnel) |
| Enable weekly auto-update? | Type `y` — keeps fnn updated via cron |

### Step 3 — Fund your wallet

Same as Windows — send CKB to the address shown during setup.

### Step 4 — Managing the node (Linux)

```bash
# Check if the node is running
sudo systemctl status fiber-node

# Start the node
sudo systemctl start fiber-node

# Stop the node
sudo systemctl stop fiber-node

# Restart after config changes
sudo systemctl restart fiber-node

# Watch live logs
sudo journalctl -u fiber-node -f

# Manual update
~/fiber-node/update.sh
```

### Accessing the dashboard on Linux (SSH tunnel)

The dashboard runs on `localhost:3001` on the server — it is never exposed to the internet. To access it from your laptop:

```bash
# Run this on your laptop (not the server):
ssh -L 3001:localhost:3001 youruser@your-server-ip
```

Then open **http://localhost:3001** in your browser. Keep the SSH window open.

---

## Opening Your First Channel

Once your wallet has CKB and your node is running:

1. Open the **Dashboard → Peers** tab
2. Connect to a peer using their multiaddr (e.g. `/ip4/1.2.3.4/tcp/8228/p2p/Qm...`)
3. Go to **Channels → Open Channel**
4. Enter the peer's public key and funding amount (minimum 100 CKB)
5. Wait for the channel to confirm on-chain (~30 seconds to a few minutes)
6. Once the channel shows **ChannelReady**, you can send and receive payments

> You can find public Fiber nodes to connect to on the **Network Graph** tab or in the Nervos Discord `#fiber` channel.

---

## Uninstalling

### Windows

1. Open a **new** PowerShell window as Administrator — do **not** open it from inside the `fiber-node` folder, or the uninstaller will fail to delete the directory
2. Run:
   ```powershell
   & "$env:USERPROFILE\fiber-node\uninstall.ps1"
   ```
3. Click **Yes** on the UAC prompt
4. Type `UNINSTALL` and press Enter

> **Important:** If your wallet contains real CKB, transfer it out BEFORE uninstalling. Your private key at `ckb\key` will be deleted permanently.

### Linux

```bash
sudo systemctl stop fiber-node fiber-dashboard 2>/dev/null
sudo systemctl disable fiber-node fiber-dashboard 2>/dev/null
sudo rm -f /etc/systemd/system/fiber-node.service /etc/systemd/system/fiber-dashboard.service
sudo systemctl daemon-reload
( crontab -l 2>/dev/null | grep -v 'fiber-node.*update\.sh' ) | crontab -
rm -rf ~/fiber-node
```

---

## Re-running the Installer

You can run the installer again at any time to update your config or fix a broken setup.

**If your node has already run before** (there is a `ckb\key` or `ckb/key` file):
- The installer will skip wallet generation
- It will ask for your **node password** to update `start.ps1`
- **Enter the exact same password you set originally** — a different password will prevent the node from starting

---

## Troubleshooting

### Windows: "cannot be loaded because running scripts is disabled"

Use `run-installer.bat` instead of running `install-fiber.ps1` directly — it bypasses the execution policy automatically. If you must use PowerShell manually, open it as Administrator and run:
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\install-fiber.ps1
```

### "The node exited unexpectedly"

Check the log for the error:

- **Windows:** `Get-Content "$env:USERPROFILE\fiber-node\fnn.log" -Tail 50`
- **Linux:** `sudo journalctl -u fiber-node -n 50`

Common causes:

| Error in log | Fix |
|-------------|-----|
| `decryption failed: aead::Error` | Wrong node password in `start.ps1`. Edit the file and correct it. |
| `Secret key file error: please set FIBER_SECRET_KEY_PASSWORD` | The `FIBER_SECRET_KEY_PASSWORD` line is missing from `start.ps1`. Re-run the installer. |
| `duplicate field 'announced_node_name'` | Config has a duplicate entry. Re-run the installer to regenerate `config.yml`. |
| `Cannot resolve cell dep` | Your `config.yml` has wrong script hashes. Re-run the installer to regenerate it. |
| `Os { code: 2, kind: NotFound }` | The node is missing the `-d` flag pointing to its data directory. Re-run the installer. |

### "Node did not respond to RPC within 15 seconds" (during install)

This is normal on the **very first run**. The node encrypts your key file on first start, which takes a few extra seconds. Run `start.ps1` (Windows) or `sudo systemctl start fiber-node` (Linux) after setup completes — it should start fine.

### "fnn.log is being used by another process" when running start.ps1

The NSSM service is already running `fnn.exe` in the background and has the log file open. You don't need to run `start.ps1` — the node is already up. Use the service commands to manage it:

```powershell
Get-Service FiberNetworkNode        # check status
Stop-Service FiberNetworkNode -Force  # stop it
Start-Service FiberNetworkNode        # start it
```

### "Check password failed" (during install)

You entered the wrong ckb-cli keystore password during the export step. The installer allows up to 3 attempts then exits — re-run the installer and enter the correct password.

### Dashboard won't open / shows "Cannot connect to Fiber node"

- Make sure the node (`fnn`) is running first — the dashboard is just a UI, it requires the node to be up
- Check the node log for errors (`fnn.log` on Windows, `journalctl -u fiber-node` on Linux)
- The dashboard connects to `http://localhost:8227` (the node's RPC). If you moved the node to a different machine, go to **Settings** in the dashboard and update the RPC URL

---

## Security Notes

- **Never share `ckb\key` or `ckb/key`** — this file controls your funds
- **Never expose port 8227 to the internet** — the RPC controls your node with no authentication. The installer blocks it at the firewall
- **Never expose port 3333 (Windows) or 3001 (Linux dashboard)** — the dashboard has no login screen. The installer blocks external access via firewall; on Linux use an SSH tunnel
- **`start.ps1` (Windows) contains your node password in plain text** — do not share this file or store it in cloud services
- The Linux service stores the password in the systemd unit file, readable only by root

---

## Files Reference

| Location | File | Purpose |
|----------|------|---------|
| `fiber-node/fnn.exe` (Win) / `fiber-node/fnn` (Linux) | Node binary | The actual Fiber node software |
| `fiber-node/config.yml` | Configuration | Network settings, key path, RPC address |
| `fiber-node/ckb/key` | Encrypted private key | Generated once — back this up |
| `fiber-node/start.ps1` | Windows startup script | Sets password env var and starts fnn |
| `fiber-node/start-dashboard.ps1` | Windows dashboard script | Starts the web dashboard on port 3333 |
| `fiber-node/dashboard/` | Dashboard files | Web UI source and built assets |
| `fiber-node/update.ps1` / `update.sh` | Auto-updater | Downloads and installs the latest fnn |
| `fiber-node/uninstall.ps1` | Windows uninstaller | Removes everything cleanly |
| `/etc/systemd/system/fiber-node.service` | Linux service unit | Manages node as a background service |

---

## Getting Help

- **Fiber documentation:** https://github.com/nervosnetwork/fiber
- **CKB Explorer (mainnet):** https://explorer.nervos.org
- **Testnet faucet:** https://faucet.nervos.org
- **Nervos Discord** (`#fiber` channel): https://discord.gg/nervos
