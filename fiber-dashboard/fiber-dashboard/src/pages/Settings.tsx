import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Settings, CheckCircle, XCircle, Moon, Sun, ExternalLink } from "lucide-react";
import { api } from "../api.js";

export default function SettingsPage() {
  const [rpcUrl, setRpcUrl] = useState(
    localStorage.getItem("fiber_rpc_override") ?? "http://localhost:8227"
  );
  const [theme, setTheme] = useState<"dark" | "light">(
    (localStorage.getItem("fiber_theme") as "dark" | "light") ?? "dark"
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("fiber_theme", theme);
  }, [theme]);

  const testMut = useMutation({
    mutationFn: () => api.health(),
  });

  const handleSave = () => {
    localStorage.setItem("fiber_rpc_override", rpcUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-bold text-white">Settings</h1>

      <div className="card space-y-4">
        <h2 className="section-title">Connection</h2>

        <div>
          <label className="label">Fiber Node RPC URL</label>
          <input
            className="input"
            value={rpcUrl}
            onChange={(e) => {
              setRpcUrl(e.target.value);
              setSaved(false);
            }}
            placeholder="http://localhost:8227"
            data-testid="input-rpc-url"
          />
          <p className="text-xs text-gray-500 mt-1">
            The URL of your running Fiber node's RPC server. Default is{" "}
            <span className="mono">http://localhost:8227</span>.
          </p>
        </div>

        <div className="flex gap-2 items-center">
          <button
            onClick={handleSave}
            className="btn-primary"
            data-testid="button-save-settings"
          >
            {saved ? "Saved!" : "Save"}
          </button>
          <button
            onClick={() => testMut.mutate()}
            disabled={testMut.isPending}
            className="btn-secondary flex items-center gap-2"
            data-testid="button-test-connection"
          >
            {testMut.isPending ? "Testing…" : "Test Connection"}
          </button>

          {testMut.isSuccess && (
            <span className="flex items-center gap-1 text-sm text-accent-green">
              <CheckCircle size={15} /> Connected
            </span>
          )}
          {testMut.isError && (
            <span className="flex items-center gap-1 text-sm text-accent-red">
              <XCircle size={15} /> {(testMut.error as Error).message.slice(0, 60)}
            </span>
          )}
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="section-title">Appearance</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTheme("dark")}
            className={`btn flex items-center gap-2 ${theme === "dark" ? "btn-primary" : "btn-secondary"}`}
            data-testid="button-theme-dark"
          >
            <Moon size={15} /> Dark
          </button>
          <button
            onClick={() => setTheme("light")}
            className={`btn flex items-center gap-2 ${theme === "light" ? "btn-primary" : "btn-secondary"}`}
            data-testid="button-theme-light"
          >
            <Sun size={15} /> Light
          </button>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="section-title">Node Configuration</h2>
        <p className="text-sm text-gray-400">
          Node settings like alias, listening address, and CKB RPC are configured in your{" "}
          <span className="mono text-gray-300">config.yml</span> file on the server, not here.
        </p>
        <div className="bg-bg-surface rounded-md p-3 text-sm text-gray-300 space-y-1">
          <div>Config file: <span className="mono text-xs">~/fiber-node/config.yml</span></div>
          <div>To apply changes: <span className="mono text-xs">sudo systemctl restart fiber-node</span></div>
        </div>
      </div>

      <div className="card space-y-3 border-border">
        <h2 className="section-title text-accent-red">Danger Zone</h2>
        <div className="space-y-3 text-sm text-gray-400">
          <div className="p-3 bg-red-900/10 border border-red-800/30 rounded-md">
            <div className="font-medium text-gray-300 mb-1">Close All Channels</div>
            <p className="text-xs">
              Closing channels requires on-chain transactions for each one. Use the Channels tab to
              close channels individually and safely. Force-close only if a peer is permanently offline.
            </p>
          </div>
          <div className="p-3 bg-amber-900/10 border border-amber-800/30 rounded-md">
            <div className="font-medium text-gray-300 mb-1">Upgrade Node Binary</div>
            <p className="text-xs">
              Before upgrading fnn, close all channels first (storage format can change between versions).
              See the setup guide for upgrade instructions.
            </p>
          </div>
        </div>
      </div>

      <div className="card space-y-2">
        <h2 className="section-title">Resources</h2>
        <div className="space-y-2 text-sm">
          {[
            { label: "Fiber Network Docs", url: "https://docs.fiber.world" },
            { label: "Fiber GitHub Releases", url: "https://github.com/nervosnetwork/fiber/releases" },
            { label: "CKB Explorer", url: "https://explorer.nervos.org" },
            { label: "Nervos Discord (#fiber)", url: "https://discord.gg/nervos" },
            { label: "FIBER-NODE-SETUP.md", url: "../FIBER-NODE-SETUP.md" },
          ].map(({ label, url }) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-accent-green hover:text-green-300 transition-colors"
              data-testid={`link-resource-${label.replace(/\s+/g, "-").toLowerCase()}`}
            >
              <ExternalLink size={13} /> {label}
            </a>
          ))}
        </div>
      </div>

      <div className="text-xs text-gray-600 pt-2">
        Fiber Dashboard v1.0.0 · Uses @scryve-tools/ckb-fiber
      </div>
    </div>
  );
}
