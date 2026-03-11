import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Network, RefreshCw, ZoomIn, ZoomOut, RotateCcw, Search } from "lucide-react";
import { api } from "../api.js";
import { shannonsToCkb } from "../types.js";
import type { GraphNode, ChannelInfo } from "../types.js";

interface NodeData {
  id: string;
  alias: string;
  addresses: string[];
  isOwn: boolean;
  channelCount: number;
}

interface EdgeData {
  source: string;
  target: string;
  capacity: string;
  outpoint: string;
}

// ── Outer component ───────────────────────────────────────────────────────────

export default function NetworkGraph() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<EdgeData | null>(null);

  const { data: nodesData, isLoading: loadingNodes, refetch: refetchNodes } = useQuery({
    queryKey: ["graph-nodes"],
    queryFn: () => api.getGraphNodes(500),
    staleTime: 60_000,
  });

  const { data: channelsData, isLoading: loadingChannels, refetch: refetchChannels } = useQuery({
    queryKey: ["graph-channels"],
    queryFn: () => api.getGraphChannels(2000),
    staleTime: 60_000,
  });

  const { data: nodeInfoData } = useQuery({
    queryKey: ["node-info"],
    queryFn: api.getNodeInfo,
  });

  const ownNodeId = nodeInfoData?.node_id;

  const nodes: NodeData[] = (nodesData?.nodes ?? []).map((n: GraphNode) => ({
    id: n.node_id,
    alias: n.node_name ?? "",
    addresses: n.addresses ?? [],
    isOwn: n.node_id === ownNodeId,
    channelCount: (channelsData?.channels ?? []).filter(
      (c: ChannelInfo) => c.node1 === n.node_id || c.node2 === n.node_id
    ).length,
  }));

  const edges: EdgeData[] = (channelsData?.channels ?? []).map((c: ChannelInfo) => ({
    source: c.node1,
    target: c.node2,
    capacity: c.capacity,
    outpoint: c.channel_outpoint,
  }));

  const matchedIds: Set<string> | null =
    searchQuery.length >= 2
      ? new Set(
          nodes
            .filter(
              (n) =>
                n.id.includes(searchQuery) ||
                n.alias.toLowerCase().includes(searchQuery.toLowerCase())
            )
            .map((n) => n.id)
        )
      : null;

  const isLoading = loadingNodes || loadingChannels;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Network Graph</h1>
        <button
          onClick={() => { refetchNodes(); refetchChannels(); }}
          className="btn-ghost text-xs flex items-center gap-1"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="card text-center py-3">
          <div className="text-xl font-bold text-white">{nodes.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">Nodes</div>
        </div>
        <div className="card text-center py-3">
          <div className="text-xl font-bold text-white">{edges.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">Channels</div>
        </div>
        <div className="card text-center py-3">
          <div className="text-xl font-bold text-accent-green">{ownNodeId ? 1 : 0}</div>
          <div className="text-xs text-gray-500 mt-0.5">Your Node</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        <input
          className="input pl-8 text-sm w-full"
          placeholder="Search by node name or ID…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {matchedIds && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
            {matchedIds.size} found
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="card flex items-center justify-center" style={{ height: 540 }}>
          <RefreshCw size={20} className="animate-spin text-gray-500 mr-2" />
          <span className="text-gray-500">Loading network data…</span>
        </div>
      ) : nodes.length === 0 ? (
        <div className="card flex flex-col items-center justify-center" style={{ height: 540 }}>
          <Network size={36} className="text-gray-600 mb-3" />
          <p className="text-gray-400 text-sm">No network data yet. Connect to peers to populate the graph.</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden rounded-xl" style={{ height: 540 }}>
          <ForceDiagram
            nodes={nodes}
            edges={edges}
            matchedIds={matchedIds}
            onNodeClick={(n) => { setSelectedNode(n); setSelectedEdge(null); }}
            onEdgeClick={(e) => { setSelectedEdge(e); setSelectedNode(null); }}
          />
        </div>
      )}

      {/* Detail panel */}
      {selectedNode && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">
              {selectedNode.alias || "Unknown Node"}
              {selectedNode.isOwn && <span className="badge-green ml-2 text-xs">Your Node</span>}
            </h3>
            <button onClick={() => setSelectedNode(null)} className="btn-ghost p-1 text-sm">✕</button>
          </div>
          <div className="text-xs text-gray-400 space-y-1.5">
            <div>
              <span className="label block mb-0.5">Node ID</span>
              <span className="mono text-gray-300 break-all">{selectedNode.id}</span>
            </div>
            <div>
              <span className="label">Channels </span>
              <span className="text-gray-300">{selectedNode.channelCount}</span>
            </div>
            {selectedNode.addresses.length > 0 && (
              <div>
                <span className="label block mb-0.5">Addresses</span>
                {selectedNode.addresses.map((a, i) => (
                  <div key={i} className="mono text-gray-400">{a}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedEdge && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">Channel</h3>
            <button onClick={() => setSelectedEdge(null)} className="btn-ghost p-1 text-sm">✕</button>
          </div>
          <div className="text-xs text-gray-400 space-y-1.5">
            <div>
              <span className="label">Capacity </span>
              <span className="text-accent-green">
                {shannonsToCkb(BigInt(selectedEdge.capacity).toString())} CKB
              </span>
            </div>
            <div>
              <span className="label block mb-0.5">Outpoint</span>
              <span className="mono text-gray-400 break-all">{selectedEdge.outpoint}</span>
            </div>
            <div>
              <span className="label block mb-0.5">Node 1</span>
              <span className="mono text-gray-400 break-all">{selectedEdge.source}</span>
            </div>
            <div>
              <span className="label block mb-0.5">Node 2</span>
              <span className="mono text-gray-400 break-all">{selectedEdge.target}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Force-directed canvas ─────────────────────────────────────────────────────

const W = 1400;
const H = 510;

function ForceDiagram({
  nodes,
  edges,
  matchedIds,
  onNodeClick,
  onEdgeClick,
}: {
  nodes: NodeData[];
  edges: EdgeData[];
  matchedIds: Set<string> | null;
  onNodeClick: (n: NodeData) => void;
  onEdgeClick: (e: EdgeData) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Simulation data — plain refs so nothing triggers re-renders
  const posRef    = useRef(new Map<string, { x: number; y: number }>());
  const velRef    = useRef(new Map<string, { x: number; y: number }>());
  const alphaRef  = useRef(1.0); // "temperature" — decays toward 0

  // Keep latest props accessible inside the RAF loop
  const nodesRef      = useRef(nodes);
  const edgesRef      = useRef(edges);
  const matchedIdsRef = useRef(matchedIds);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { matchedIdsRef.current = matchedIds; }, [matchedIds]);

  // View
  const panRef   = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(0.85);

  // Interaction
  const dragRef      = useRef<{ id: string; hasMoved: boolean } | null>(null);
  const panStartRef  = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);
  const hoverNodeRef = useRef<string | null>(null);
  const hoverEdgeRef = useRef<number>(-1);

  const rafRef = useRef<number>(0);
  const [cursor, setCursor] = useState("grab");

  // ── Draw ────────────────────────────────────────────────────────────────────
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nodes      = nodesRef.current;
    const edges      = edgesRef.current;
    const pos        = posRef.current;
    const pan        = panRef.current;
    const scale      = scaleRef.current;
    const matched    = matchedIdsRef.current;
    const hoverNode  = hoverNodeRef.current;
    const hoverEdge  = hoverEdgeRef.current;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(scale, scale);

    // Count parallel edges between each pair
    const pairCount = new Map<string, number>();
    for (const e of edges) {
      const k = [e.source, e.target].sort().join("|");
      pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
    }

    // Draw edges (one visual line per unique pair, thickness = count)
    const drawnPairs = new Set<string>();
    const hoverPair  = hoverEdge >= 0 && edges[hoverEdge]
      ? [edges[hoverEdge].source, edges[hoverEdge].target].sort().join("|")
      : null;

    for (const e of edges) {
      const k = [e.source, e.target].sort().join("|");
      if (drawnPairs.has(k)) continue;
      drawnPairs.add(k);

      const s = pos.get(e.source);
      const t = pos.get(e.target);
      if (!s || !t) continue;

      const isHover = k === hoverPair;
      const count   = pairCount.get(k) ?? 1;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = isHover ? "rgba(96,165,250,0.9)" : "rgba(59,130,246,0.2)";
      ctx.lineWidth   = isHover ? 2.5 : Math.min(5, 0.6 + count * 0.7);
      ctx.stroke();

      // Multiplicity badge
      if (count > 1 && scale > 0.4) {
        const mx = (s.x + t.x) / 2;
        const my = (s.y + t.y) / 2;
        ctx.fillStyle = "rgba(96,165,250,0.65)";
        ctx.font = `${Math.round(9 / scale)}px sans-serif`;
        ctx.fillText(`×${count}`, mx + 4, my - 4);
      }
    }

    // Draw nodes
    for (const node of nodes) {
      const p = pos.get(node.id);
      if (!p) continue;

      const r         = node.isOwn ? 13 : Math.max(5, Math.min(11, 4 + Math.sqrt(node.channelCount) * 2));
      const isHover   = hoverNode === node.id;
      const isMatch   = matched?.has(node.id) ?? false;
      const isDimmed  = matched !== null && !isMatch && !node.isOwn;

      // Glow rings
      if (node.isOwn) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 10, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(34,197,94,0.1)";
        ctx.fill();
      }
      if (isMatch) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 7, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(250,204,21,0.25)";
        ctx.fill();
      }
      if (isHover && !isDimmed) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(147,197,253,0.2)";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
      ctx.fillStyle =
        node.isOwn  ? "#22c55e"
        : isMatch   ? "#fde047"
        : isHover   ? "#93c5fd"
        : isDimmed  ? "rgba(59,130,246,0.18)"
        :             "#3b82f6";
      ctx.fill();

      // Label
      const showLabel = !isDimmed || isHover;
      if (showLabel && (node.alias || node.isOwn || isHover)) {
        const label = node.alias || node.id.slice(0, 10) + "…";
        const fontSize = Math.max(8, Math.round(10 / Math.max(0.5, scale)));
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = isDimmed ? "rgba(156,163,175,0.35)" : "#d1d5db";
        ctx.fillText(label, p.x + r + 4, p.y + 4);
      }
    }

    ctx.restore();
  }, []); // only reads from refs — stable

  // ── Simulation tick ──────────────────────────────────────────────────────────
  const simTick = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const pos   = posRef.current;
    const vel   = velRef.current;
    const alpha = alphaRef.current;

    if (alpha < 0.001) return;

    const REPULSION    = 14000;
    const SPRING_REST  = 200;
    const SPRING_K     = 0.025;
    const GRAVITY      = 0.0006;
    const DAMPING      = 0.78;

    // Node–node repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const pa = pos.get(nodes[i].id);
        const pb = pos.get(nodes[j].id);
        if (!pa || !pb) continue;
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        const d2 = Math.max(1, dx * dx + dy * dy);
        const d  = Math.sqrt(d2);
        const f  = (REPULSION * alpha) / d2;
        dx /= d; dy /= d;
        const va = vel.get(nodes[i].id)!;
        const vb = vel.get(nodes[j].id)!;
        vel.set(nodes[i].id, { x: va.x - dx * f, y: va.y - dy * f });
        vel.set(nodes[j].id, { x: vb.x + dx * f, y: vb.y + dy * f });
      }
    }

    // Spring attraction (one spring per unique pair)
    const seen = new Set<string>();
    for (const e of edges) {
      const k = [e.source, e.target].sort().join("|");
      if (seen.has(k)) continue;
      seen.add(k);
      const pa = pos.get(e.source);
      const pb = pos.get(e.target);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d  = Math.sqrt(dx * dx + dy * dy) || 1;
      const f  = (d - SPRING_REST) * SPRING_K * alpha;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      const va = vel.get(e.source)!;
      const vb = vel.get(e.target)!;
      vel.set(e.source, { x: va.x + fx, y: va.y + fy });
      vel.set(e.target, { x: vb.x - fx, y: vb.y - fy });
    }

    // Gravity toward canvas centre
    for (const n of nodes) {
      if (dragRef.current?.id === n.id) continue;
      const p = pos.get(n.id);
      const v = vel.get(n.id);
      if (!p || !v) continue;
      vel.set(n.id, {
        x: v.x + (W / 2 - p.x) * GRAVITY,
        y: v.y + (H / 2 - p.y) * GRAVITY,
      });
    }

    // Integrate + damp
    for (const n of nodes) {
      if (dragRef.current?.id === n.id) continue;
      const p = pos.get(n.id);
      const v = vel.get(n.id);
      if (!p || !v) continue;
      const nv = { x: v.x * DAMPING, y: v.y * DAMPING };
      vel.set(n.id, nv);
      pos.set(n.id, {
        x: Math.max(20, Math.min(W - 20, p.x + nv.x)),
        y: Math.max(20, Math.min(H - 20, p.y + nv.y)),
      });
    }

    alphaRef.current *= 0.997;
  }, []); // only reads from refs — stable

  // ── RAF loop ─────────────────────────────────────────────────────────────────
  const wake = useCallback(() => {
    if (rafRef.current) return;
    const loop = () => {
      simTick();
      drawFrame();
      const running = alphaRef.current > 0.001 || dragRef.current !== null || panStartRef.current !== null;
      rafRef.current = running ? requestAnimationFrame(loop) : 0;
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [simTick, drawFrame]);

  // ── Init / re-heat when nodes change ────────────────────────────────────────
  useEffect(() => {
    nodes.forEach((n, i) => {
      if (!posRef.current.has(n.id)) {
        const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1);
        const radius = Math.min(W, H) * 0.3;
        posRef.current.set(n.id, {
          x: W / 2 + radius * Math.cos(angle) + (Math.random() - 0.5) * 60,
          y: H / 2 + radius * Math.sin(angle) + (Math.random() - 0.5) * 60,
        });
        velRef.current.set(n.id, { x: 0, y: 0 });
      }
    });
    alphaRef.current = 1.0;
    wake();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.map((n) => n.id).join(","), wake]);

  // Redraw when search changes (sim may be idle)
  useEffect(() => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => { drawFrame(); rafRef.current = 0; });
    }
  }, [matchedIds, drawFrame]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // ── Coordinate helpers ───────────────────────────────────────────────────────
  const toWorld = (cx: number, cy: number) => ({
    x: (cx - panRef.current.x) / scaleRef.current,
    y: (cy - panRef.current.y) / scaleRef.current,
  });

  const canvasXY = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      cx: (e.clientX - r.left) * (W / r.width),
      cy: (e.clientY - r.top) * (H / r.height),
    };
  };

  const findNode = (wx: number, wy: number): NodeData | null => {
    for (const n of nodesRef.current) {
      const p = posRef.current.get(n.id);
      if (!p) continue;
      const r = n.isOwn ? 15 : Math.max(7, 4 + Math.sqrt(n.channelCount) * 2);
      if (Math.hypot(wx - p.x, wy - p.y) <= r) return n;
    }
    return null;
  };

  const findEdge = (wx: number, wy: number): number => {
    const THRESHOLD = 8 / scaleRef.current;
    let best = -1, bestD = THRESHOLD;
    for (let i = 0; i < edgesRef.current.length; i++) {
      const e = edgesRef.current[i];
      const s = posRef.current.get(e.source);
      const t = posRef.current.get(e.target);
      if (!s || !t) continue;
      const dx = t.x - s.x, dy = t.y - s.y;
      const len2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((wx - s.x) * dx + (wy - s.y) * dy) / len2));
      const d = Math.hypot(wx - (s.x + u * dx), wy - (s.y + u * dy));
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  // ── Mouse events ─────────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy } = canvasXY(e);
    const { x: wx, y: wy } = toWorld(cx, cy);
    const node = findNode(wx, wy);
    if (node) {
      dragRef.current = { id: node.id, hasMoved: false };
    } else {
      panStartRef.current = { cx, cy, px: panRef.current.x, py: panRef.current.y };
    }
    setCursor("grabbing");
    wake();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy } = canvasXY(e);
    const { x: wx, y: wy } = toWorld(cx, cy);

    if (dragRef.current) {
      posRef.current.set(dragRef.current.id, { x: wx, y: wy });
      velRef.current.set(dragRef.current.id, { x: 0, y: 0 });
      dragRef.current.hasMoved = true;
      wake();
    } else if (panStartRef.current) {
      const ps = panStartRef.current;
      panRef.current = { x: ps.px + (cx - ps.cx), y: ps.py + (cy - ps.cy) };
      wake();
    } else {
      const node = findNode(wx, wy);
      const newHoverNode = node?.id ?? null;
      const newHoverEdge = node ? -1 : findEdge(wx, wy);
      const changed =
        newHoverNode !== hoverNodeRef.current || newHoverEdge !== hoverEdgeRef.current;
      hoverNodeRef.current = newHoverNode;
      hoverEdgeRef.current = newHoverEdge;
      setCursor(node || newHoverEdge >= 0 ? "pointer" : "grab");
      if (changed) wake();
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy } = canvasXY(e);
    const { x: wx, y: wy } = toWorld(cx, cy);

    if (dragRef.current && !dragRef.current.hasMoved) {
      const node = findNode(wx, wy);
      if (node) onNodeClick(node);
    } else if (!dragRef.current) {
      const node = findNode(wx, wy);
      if (!node) {
        const ei = findEdge(wx, wy);
        if (ei >= 0) onEdgeClick(edgesRef.current[ei]);
      }
    }

    dragRef.current = null;
    panStartRef.current = null;
    setCursor("grab");
  };

  const handleMouseLeave = () => {
    dragRef.current = null;
    panStartRef.current = null;
    hoverNodeRef.current = null;
    hoverEdgeRef.current = -1;
    setCursor("grab");
    wake();
  };

  // Wheel zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const cx = (e.clientX - r.left) * (W / r.width);
      const cy = (e.clientY - r.top) * (H / r.height);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const s0 = scaleRef.current;
      const s1 = Math.max(0.08, Math.min(8, s0 * factor));
      const wx = (cx - panRef.current.x) / s0;
      const wy = (cy - panRef.current.y) / s0;
      panRef.current   = { x: cx - wx * s1, y: cy - wy * s1 };
      scaleRef.current = s1;
      wake();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [wake]);

  const zoomIn  = () => { scaleRef.current = Math.min(8, scaleRef.current * 1.3); wake(); };
  const zoomOut = () => { scaleRef.current = Math.max(0.08, scaleRef.current / 1.3); wake(); };
  const reset   = () => { panRef.current = { x: 0, y: 0 }; scaleRef.current = 0.85; wake(); };

  return (
    <div className="relative w-full h-full bg-bg">
      {/* Controls */}
      <div className="absolute top-2 right-2 flex flex-col gap-1 z-10">
        <button onClick={zoomIn}  className="btn-ghost p-1.5" title="Zoom in"><ZoomIn  size={14} /></button>
        <button onClick={zoomOut} className="btn-ghost p-1.5" title="Zoom out"><ZoomOut size={14} /></button>
        <button onClick={reset}   className="btn-ghost p-1.5" title="Reset view"><RotateCcw size={14} /></button>
      </div>

      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="w-full h-full"
        style={{ cursor }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />

      <div className="absolute bottom-2 left-3 text-xs text-gray-700 select-none pointer-events-none">
        Scroll to zoom · Drag background to pan · Drag nodes to rearrange · Click node or channel for details
      </div>
    </div>
  );
}
