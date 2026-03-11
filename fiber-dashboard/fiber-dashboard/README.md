# Fiber Node Dashboard

A standalone web dashboard for managing your Fiber Network Node. Built for non-technical operators — gives you a clear view of your channels, payments, and network connections without ever touching the command line after initial setup.

---

## What it is

The Fiber Dashboard is a React + Express web app that connects to your Fiber node's RPC and gives you a visual interface for everything the node can do. It runs on your VPS alongside the node, accessible in any browser.

**Tabs:**
- **Overview** — node health, open channel count, total liquidity bar chart
- **Channels** — open/close/inspect channels, see local vs remote balance per channel
- **Payments** — send payments via invoice or keysend, track payment status in real time
- **Invoices** — generate invoices to request payment, decode any invoice
- **Peers** — connect/disconnect peers, quick-connect buttons for the official bootnodes
- **Network Graph** — visual map of connected nodes and channels in the network
- **Wallet** — total local/remote liquidity breakdown, channel capacity charts
- **Settings** — configure the RPC URL, test connection, links to docs

---

## Quick Start (Development)

```bash
# 1. Install dependencies
cd spark-deliverables/fiber-dashboard
npm install

# 2. Make sure your Fiber node is running locally (or set FIBER_RPC_URL)
export FIBER_RPC_URL=http://localhost:8227

# 3. Start dev server (Vite on :3000, Express backend on :3001)
npm run dev
```

Open http://localhost:3000.

---

## Production (on your VPS)

```bash
# 1. Install dependencies
npm install

# 2. Build the frontend
npm run build

# 3. Start the production server (serves frontend + API on port 3000)
PORT=3000 FIBER_RPC_URL=http://localhost:8227 NODE_ENV=production npm start
```

The Express server serves the built React app from `dist/` and handles all `/api/*` routes on the same port. No separate Vite server in production.

---

## Systemd Service

To run the dashboard as a background service alongside your Fiber node, create `/etc/systemd/system/fiber-dashboard.service`:

```ini
[Unit]
Description=Fiber Node Dashboard
After=network-online.target fiber-node.service
Wants=network-online.target

[Service]
Type=simple
User=scryve
WorkingDirectory=/home/scryve/fiber-dashboard
ExecStart=/usr/bin/node /home/scryve/fiber-dashboard/server/index.ts
Environment="FIBER_RPC_URL=http://localhost:8227"
Environment="PORT=3000"
Environment="NODE_ENV=production"
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable fiber-dashboard
sudo systemctl start fiber-dashboard

# Open port 3000 in your firewall (for external browser access)
sudo ufw allow 3000/tcp
```

Access the dashboard at `http://YOUR_VPS_IP:3000`.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `FIBER_RPC_URL` | URL of your Fiber node's RPC | `http://localhost:8227` |
| `PORT` | Port for the dashboard server | `3001` (dev) / `3000` (prod) |
| `NODE_ENV` | Set to `production` for prod | `development` |

---

## Architecture

```
browser ──── :3000 (Vite in dev, Express in prod)
                │
                ├── /api/* ──── Express server (server/index.ts)
                │                    │
                │               FiberClient ──── Fiber node RPC :8227
                │
                └── /* ──────── React SPA (served from dist/ in prod)
```

All Fiber RPC calls go through the Express backend. This avoids CORS entirely — your browser only ever talks to the dashboard server, never directly to the Fiber node.

---

## Troubleshooting

**"Cannot connect to Fiber node at http://localhost:8227"**
- Check the node is running: `sudo systemctl status fiber-node`
- Check logs: `sudo journalctl -u fiber-node -f`
- Make sure the RPC is on localhost only (`listening_addr: "127.0.0.1:8227"` in config.yml)

**Dashboard server won't start**
- Check Node.js version: `node --version` (requires 18+)
- Check logs: `sudo journalctl -u fiber-dashboard -f`
- Make sure the build ran: `ls dist/` — should contain `index.html`

**CORS errors in browser console**
- This shouldn't happen — all API calls go through the Express backend.
- If you're seeing CORS errors, you're connecting the browser directly to the Fiber node RPC, which is wrong. Always use the dashboard server.

**Port 3000 not accessible from browser**
- Check UFW: `sudo ufw status`
- Allow port 3000: `sudo ufw allow 3000/tcp`

---

## Security Notes

- The dashboard has no authentication by default. Don't expose port 3000 to the public internet unless you add authentication or restrict access to a VPN/known IP.
- The Fiber RPC port (8227) should remain blocked by your firewall — the dashboard communicates with it server-side over localhost.
- To add basic auth, use nginx as a reverse proxy in front of port 3000 with `htpasswd`.
