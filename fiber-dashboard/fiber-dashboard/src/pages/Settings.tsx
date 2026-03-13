import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Settings, CheckCircle, XCircle, Moon, Sun, ExternalLink, ArrowUpCircle, RefreshCw, Copy, Check, Heart } from "lucide-react";
import { api } from "../api.js";

const SUPPORT_ADDRESSES = [
  { label: "CKB", address: "ckb1qrgqep8saj8agswr30pls73hra28ry8jlnlc3ejzh3dl2ju7xxpjxqgqq9fwtuqzxaww3afzur45fntyhhrvnrplq5se06q0" },
  { label: "ETH", address: "0x5F407a63b13873BbFb1E926Adb487E6D615461eA" },
  { label: "BTC", address: "bc1qsceyf6yrlrn2fxrgxtpk55n48nsx4er8cpup5q" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="btn-ghost p-1 flex-shrink-0" title="Copy to clipboard">
      {copied ? <Check size={13} className="text-accent-green" /> : <Copy size={13} />}
    </button>
  );
}

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

  const { data: versionData, refetch: recheckVersion, isFetching: versionChecking } = useQuery({
    queryKey: ["version-check"],
    queryFn: api.checkVersion,
    refetchInterval: 30 * 60 * 1000, // recheck every 30 min
    staleTime: 10 * 60 * 1000,
  });

  const testMut = useMutation({
    mutationFn: () => api.health(),
  });

  const updateMut = useMutation({
    mutationFn: () => api.triggerUpdate(),
  });

  const handleSave = () => {
    localStorage.setItem("fiber_rpc_override", rpcUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-bold text-white">Settings</h1>

      {versionData?.updateAvailable && (
        <div className="bg-accent-green/10 border border-accent-green/30 rounded-lg p-4 flex items-start gap-3">
          <ArrowUpCircle size={20} className="text-accent-green flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <div className="text-sm font-semibold text-white">
              Update available: {versionData.latest}
            </div>
            <p className="text-xs text-gray-400">
              You're running {versionData.current}.
              {versionData.publishedAt && (
                <> Released {new Date(versionData.publishedAt).toLocaleDateString()}.</>
              )}
            </p>
            {versionData.releaseNotes && (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{versionData.releaseNotes}</p>
            )}
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={() => updateMut.mutate()}
                disabled={updateMut.isPending || updateMut.isSuccess}
                className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
              >
                {updateMut.isSuccess ? (
                  <><RefreshCw size={12} className="animate-spin" /> Updating…</>
                ) : updateMut.isPending ? (
                  "Starting…"
                ) : (
                  <><ArrowUpCircle size={12} /> Update Now</>
                )}
              </button>
              {updateMut.isSuccess && (
                <span className="text-xs text-gray-400">Dashboard will restart. Refresh this page in a few seconds.</span>
              )}
              {updateMut.isError && (
                <span className="text-xs text-accent-red">{(updateMut.error as Error).message}</span>
              )}
              {versionData.releaseUrl && (
                <a
                  href={versionData.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent-green hover:text-green-300 flex items-center gap-1"
                >
                  <ExternalLink size={12} /> Release notes
                </a>
              )}
            </div>
          </div>
        </div>
      )}

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

      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Heart size={15} className="text-accent-red" />
          <h2 className="section-title mb-0">About & Support</h2>
        </div>
        <div>
          <div className="text-sm font-semibold text-white">Fiber Node Dashboard</div>
          <p className="text-xs text-gray-500 mt-0.5">Built by tecmeup</p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://x.com/tecmeup"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-xs flex items-center gap-1.5"
          >
            <span className="font-bold">𝕏</span> Follow on X
          </a>
          <a
            href="https://github.com/tecmeup123/fiber-node-installer"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-xs flex items-center gap-1.5"
          >
            <ExternalLink size={13} /> GitHub
          </a>
        </div>
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Support the project</div>
          <div className="space-y-2">
            {SUPPORT_ADDRESSES.map(({ label, address }) => (
              <div key={label} className="flex items-center gap-2 bg-bg-surface rounded-md px-3 py-2">
                <span className="text-xs font-medium text-gray-400 w-8 flex-shrink-0">{label}</span>
                <span className="mono text-xs text-gray-300 truncate flex-1">{address}</span>
                <CopyButton text={address} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-600 pt-2 flex items-center gap-3">
        <span>Fiber Dashboard {versionData?.current ?? "v1.4.3"}</span>
        <button
          onClick={() => recheckVersion()}
          disabled={versionChecking}
          className="text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
          title="Check for updates"
        >
          <RefreshCw size={11} className={versionChecking ? "animate-spin" : ""} />
          {versionChecking ? "Checking…" : "Check for updates"}
        </button>
        {versionData && !versionData.updateAvailable && !versionData.error && (
          <span className="text-accent-green flex items-center gap-1">
            <CheckCircle size={11} /> Up to date
          </span>
        )}
      </div>
    </div>
  );
}
