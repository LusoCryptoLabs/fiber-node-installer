# Fiber Network Node — Setup Guide

This guide walks you through installing your own Fiber Network Node. No technical experience needed. Just follow the steps in order.

---

## What is a Fiber Node?

A Fiber Network Node lets your server participate in CKB's Layer 2 payment network. Once running, it can send and receive near-instant payments without waiting for a blockchain transaction every time.

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

Save `install-fiber.ps1` to your Desktop (or anywhere easy to find).

### Step 2 — Run the installer

Right-click `install-fiber.ps1` → **Run with PowerShell**

> A blue window labelled "Windows PowerShell" will open. If Windows asks "Do you want to allow this app to make changes?", click **Yes**. The installer needs this to configure your firewall.

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
| `Start automatically when Windows logs in? [Y/n]` | Press **Enter** to say Yes (recommended) |

> **Two passwords, two purposes:**
> - **ckb-cli password** — protects your wallet file. Only needed during setup.
> - **Node password** — protects the node's secret key. Saved in `start.ps1`. If you forget it, the node cannot start.

### Step 4 — Fund your wallet

After setup, you will see a green box with your **CKB funding address**. Send CKB to this address to enable payment channels.

- **Mainnet:** Send at least 1,000 CKB (10,000+ recommended). Use JoyID or any CKB wallet.
- **Testnet:** Get free test CKB at [faucet.nervos.org](https://faucet.nervos.org)

### Step 5 — Your node is ready

Files created in `C:\Users\YourName\fiber-node\`:

| File | What it does |
|------|-------------|
| `start.ps1` | Double-click this to start your node manually |
| `uninstall.ps1` | Double-click this to remove everything |
| `fnn.log` | Log output — check this if something goes wrong |
| `config.yml` | Node configuration |
| `ckb\key` | Your encrypted private key — **keep this safe, never share it** |

### Starting and stopping the node (Windows)

**Start manually:**
```
cd C:\Users\YourName\fiber-node
.\start.ps1
```

**Check if it's running:** Open Task Manager → look for `fnn.exe`

**Stop it:** Close the PowerShell window running `start.ps1`, or end the `fnn.exe` process in Task Manager

---

## Linux Installation (Ubuntu / Debian)

### Step 1 — Download the installer

Copy `install-fiber.sh` to your server (via SCP, SFTP, or paste into a text editor).

### Step 2 — Make it executable and run it

```bash
chmod +x install-fiber.sh
./install-fiber.sh
```

> If prompted, enter your `sudo` password. The installer needs it to configure the firewall and create a background service.

### Step 3 — Answer the prompts

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

### Step 4 — Fund your wallet

Same as Windows — send CKB to the address shown during setup.

### Step 5 — Managing the node (Linux)

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
```

---

## Uninstalling

### Windows

1. Go to `C:\Users\YourName\fiber-node\`
2. Right-click `uninstall.ps1` → **Run with PowerShell**
3. Click **Yes** on the UAC prompt
4. Type `UNINSTALL` and press Enter

> **Important:** If your wallet contains real CKB, transfer it out BEFORE uninstalling. Your private key at `ckb\key` will be deleted permanently.

### Linux

```bash
sudo systemctl stop fiber-node
sudo systemctl disable fiber-node
sudo rm /etc/systemd/system/fiber-node.service
sudo systemctl daemon-reload
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

### "The node exited unexpectedly"

Check the log for the error:

- **Windows:** Open `C:\Users\YourName\fiber-node\fnn.log`
- **Linux:** `sudo journalctl -u fiber-node -n 50`

Common causes:

| Error in log | Fix |
|-------------|-----|
| `decryption failed: aead::Error` | Wrong node password in `start.ps1`. Edit the file and correct it. |
| `Secret key file error: please set FIBER_SECRET_KEY_PASSWORD` | The `FIBER_SECRET_KEY_PASSWORD` line is missing from `start.ps1`. Re-run the installer. |
| `Cannot resolve cell dep` | Your `config.yml` has wrong script hashes. Re-run the installer to regenerate it. |
| `Os { code: 2, kind: NotFound }` | The node is missing the `-d` flag pointing to its data directory. Re-run the installer. |

### "Node did not respond to RPC within 15 seconds" (during install)

This is normal on the **very first run**. The node encrypts your key file on first start, which takes a few extra seconds. Run `start.ps1` (Windows) or `sudo systemctl start fiber-node` (Linux) after setup completes — it should start fine.

### "Check password failed" (during install)

You entered the wrong ckb-cli keystore password during the export step. The installer will ask you to try again — just enter the correct password.

### The installer says "ckb-cli already installed" but nothing happens

This is correct — the installer skips re-downloading tools it already has. It will proceed to the next step automatically.

### Windows: "cannot be loaded because running scripts is disabled"

Open PowerShell as Administrator and run:
```
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```
Then run the installer again.

---

## Security Notes

- **Never share `ckb\key` or `ckb/key`** — this file controls your funds
- **Never expose port 8227 to the internet** — the RPC controls your node with no authentication by default. The installer blocks it at the firewall.
- **`start.ps1` (Windows) contains your node password in plain text** — do not share this file or store it in cloud services
- The Linux service stores the password in the systemd unit file (`/etc/systemd/system/fiber-node.service`), readable only by root

---

## Files Reference

| Location | File | Purpose |
|----------|------|---------|
| `fiber-node/fnn.exe` (Win) / `fiber-node/fnn` (Linux) | Node binary | The actual Fiber node software |
| `fiber-node/config.yml` | Configuration | Network settings, key path, RPC address |
| `fiber-node/ckb/key` | Encrypted private key | Generated once — back this up |
| `fiber-node/start.ps1` | Windows startup script | Sets password env var and starts fnn |
| `fiber-node/uninstall.ps1` | Windows uninstaller | Removes everything cleanly |
| `/etc/systemd/system/fiber-node.service` | Linux service unit | Manages node as a background service |

---

## Getting Help

- **Fiber documentation:** https://github.com/nervosnetwork/fiber
- **CKB Explorer (mainnet):** https://explorer.nervos.org
- **Testnet faucet:** https://faucet.nervos.org
- **Nervos Discord** (`#fiber` channel): https://discord.gg/nervos
