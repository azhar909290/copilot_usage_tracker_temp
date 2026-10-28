"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Network,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Zap,
  Bot,
  Users,
  Cpu,
  ArrowUpRight,
  Filter,
  X,
  Layers,
  ChevronDown,
} from "lucide-react";

export type CallEvent = {
  key?: string;
  timestamp: string;
  date?: string;
  user: string;
  agent: string;
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  latency_ms?: number | null;
  cost?: number;
};

export type UsageRow = {
  date: string;
  user: string;
  agent: string;
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
};

interface AgentNetworkProps {
  events: CallEvent[];
  rows: UsageRow[];
  loading?: boolean;
  userList?: string[];
  selectedUser?: string;
  selectedAgent?: string;
  selectedModel?: string;
  onFilterUser?: (user: string) => void;
  onFilterAgent?: (agent: string) => void;
  onFilterModel?: (model: string) => void;
}

type NodeItem = {
  id: string;
  label: string;
  value: number;
  type: "user" | "agent" | "model";
  tokens: number;
  latencySum: number;
  latencyCount: number;
};

type LinkItem = {
  source: string;
  target: string;
  value: number;
  color: string;
  tokens: number;
  latencySum: number;
  latencyCount: number;
};

function formatCompactNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "k";
  return String(Math.round(num));
}

export default function AgentNetwork({
  events,
  rows,
  loading = false,
  userList = [],
  selectedUser,
  selectedAgent,
  selectedModel,
  onFilterUser,
  onFilterAgent,
  onFilterModel,
}: AgentNetworkProps) {
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [userLimit, setUserLimit] = useState<number | "all">(10);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    node: NodeItem | null;
  }>({ visible: false, x: 0, y: 0, node: null });

  // Set of verified team users from userlist
  const validUserSet = useMemo(() => {
    if (!userList || userList.length === 0) return null;
    return new Set(userList.map((u) => u.toLowerCase().trim()));
  }, [userList]);

  // 1. Compute Network Graph from events or aggregated rows
  const graphData = useMemo(() => {
    const userMap: Record<string, { requests: number; tokens: number; latencySum: number; latencyCount: number }> = {};
    const agentMap: Record<string, { requests: number; tokens: number; latencySum: number; latencyCount: number }> = {};
    const modelMap: Record<string, { requests: number; tokens: number; latencySum: number; latencyCount: number }> = {};
    const linkMap: Record<string, LinkItem> = {};

    const addLink = (
      src: string,
      dst: string,
      val: number,
      color: string,
      tokens: number,
      lat: number | null | undefined
    ) => {
      const key = `${src}>${dst}`;
      if (!linkMap[key]) {
        linkMap[key] = {
          source: src,
          target: dst,
          value: 0,
          color,
          tokens: 0,
          latencySum: 0,
          latencyCount: 0,
        };
      }
      linkMap[key].value += val;
      linkMap[key].tokens += tokens;
      if (lat != null && lat > 0) {
        linkMap[key].latencySum += lat;
        linkMap[key].latencyCount += 1;
      }
    };

    // Filter helper: ensure user is in validUserSet if provided
    const isAllowedUser = (u: string) => {
      if (!u || u === "unknown") return false;
      if (!validUserSet) return true;
      return validUserSet.has(u.toLowerCase());
    };

    if (events && events.length > 0) {
      events.forEach((ev) => {
        const u = ev.user || "unknown";
        if (!isAllowedUser(u)) return;

        const a = ev.agent || "general";
        const m = ev.model || "default";
        const tok = (ev.input_tokens || 0) + (ev.output_tokens || 0);
        const lat = ev.latency_ms || 0;

        if (!userMap[u]) userMap[u] = { requests: 0, tokens: 0, latencySum: 0, latencyCount: 0 };
        userMap[u].requests += 1;
        userMap[u].tokens += tok;
        if (lat > 0) {
          userMap[u].latencySum += lat;
          userMap[u].latencyCount += 1;
        }

        if (!agentMap[a]) agentMap[a] = { requests: 0, tokens: 0, latencySum: 0, latencyCount: 0 };
        agentMap[a].requests += 1;
        agentMap[a].tokens += tok;
        if (lat > 0) {
          agentMap[a].latencySum += lat;
          agentMap[a].latencyCount += 1;
        }

        if (!modelMap[m]) modelMap[m] = { requests: 0, tokens: 0, latencySum: 0, latencyCount: 0 };
        modelMap[m].requests += 1;
        modelMap[m].tokens += tok;
        if (lat > 0) {
          modelMap[m].latencySum += lat;
          modelMap[m].latencyCount += 1;
        }
      });

      // Sort users by volume and apply density limit
      const sortedUsers = Object.entries(userMap)
        .sort((a, b) => b[1].requests - a[1].requests)
        .map(([k]) => k);

      let displayedUsers = userLimit === "all" ? sortedUsers : sortedUsers.slice(0, userLimit);
      // If a specific user is selected in dashboard, make sure they are included
      if (selectedUser && selectedUser !== "all" && sortedUsers.includes(selectedUser)) {
        if (!displayedUsers.includes(selectedUser)) {
          displayedUsers = [selectedUser, ...displayedUsers.slice(0, displayedUsers.length - 1)];
        }
      }

      const topAgents = Object.entries(agentMap)
        .sort((a, b) => b[1].requests - a[1].requests)
        .slice(0, 12)
        .map(([k]) => k);

      events.forEach((ev) => {
        const u = ev.user || "unknown";
        if (!isAllowedUser(u)) return;

        const a = ev.agent || "general";
        const m = ev.model || "default";
        const tok = (ev.input_tokens || 0) + (ev.output_tokens || 0);
        const lat = ev.latency_ms || 0;

        if (displayedUsers.includes(u) && topAgents.includes(a)) {
          addLink(`u:${u}`, `a:${a}`, 1, "#3fa9ff", tok, lat);
        }
        if (topAgents.includes(a)) {
          addLink(`a:${a}`, `m:${m}`, 1, "#7c5cff", tok, lat);
        }
      });
    } else if (rows && rows.length > 0) {
      rows.forEach((r) => {
        const u = r.user || "unknown";
        if (!isAllowedUser(u)) return;

        const a = r.agent || "general";
        const m = r.model || "default";
        const req = r.requests || 1;
        const tok = (r.input_tokens || 0) + (r.output_tokens || 0);

        if (!userMap[u]) userMap[u] = { requests: 0, tokens: 0, latencySum: 0, latencyCount: 0 };
        userMap[u].requests += req;
        userMap[u].tokens += tok;

        if (!agentMap[a]) agentMap[a] = { requests: 0, tokens: 0, latencySum: 0, latencyCount: 0 };
        agentMap[a].requests += req;
        agentMap[a].tokens += tok;

        if (!modelMap[m]) modelMap[m] = { requests: 0, tokens: 0, latencySum: 0, latencyCount: 0 };
        modelMap[m].requests += req;
        modelMap[m].tokens += tok;
      });

      const sortedUsers = Object.entries(userMap)
        .sort((a, b) => b[1].requests - a[1].requests)
        .map(([k]) => k);

      let displayedUsers = userLimit === "all" ? sortedUsers : sortedUsers.slice(0, userLimit);
      if (selectedUser && selectedUser !== "all" && sortedUsers.includes(selectedUser)) {
        if (!displayedUsers.includes(selectedUser)) {
          displayedUsers = [selectedUser, ...displayedUsers.slice(0, displayedUsers.length - 1)];
        }
      }

      const topAgents = Object.entries(agentMap)
        .sort((a, b) => b[1].requests - a[1].requests)
        .slice(0, 12)
        .map(([k]) => k);

      rows.forEach((r) => {
        const u = r.user || "unknown";
        if (!isAllowedUser(u)) return;

        const a = r.agent || "general";
        const m = r.model || "default";
        const req = r.requests || 1;
        const tok = (r.input_tokens || 0) + (r.output_tokens || 0);

        if (displayedUsers.includes(u) && topAgents.includes(a)) {
          addLink(`u:${u}`, `a:${a}`, req, "#3fa9ff", tok, null);
        }
        if (topAgents.includes(a)) {
          addLink(`a:${a}`, `m:${m}`, req, "#7c5cff", tok, null);
        }
      });
    }

    const sortedUserEntries = Object.entries(userMap).sort((a, b) => b[1].requests - a[1].requests);
    const displayedUserEntries =
      userLimit === "all" ? sortedUserEntries : sortedUserEntries.slice(0, userLimit);

    const topAgentEntries = Object.entries(agentMap)
      .sort((a, b) => b[1].requests - a[1].requests)
      .slice(0, 12);
    const modelEntries = Object.entries(modelMap).sort((a, b) => b[1].requests - a[1].requests);

    const cols: [NodeItem[], NodeItem[], NodeItem[]] = [
      displayedUserEntries.map(([k, v]) => ({
        id: `u:${k}`,
        label: k,
        value: v.requests,
        type: "user",
        tokens: v.tokens,
        latencySum: v.latencySum,
        latencyCount: v.latencyCount,
      })),
      topAgentEntries.map(([k, v]) => ({
        id: `a:${k}`,
        label: k,
        value: v.requests,
        type: "agent",
        tokens: v.tokens,
        latencySum: v.latencySum,
        latencyCount: v.latencyCount,
      })),
      modelEntries.map(([k, v]) => ({
        id: `m:${k}`,
        label: k,
        value: v.requests,
        type: "model",
        tokens: v.tokens,
        latencySum: v.latencySum,
        latencyCount: v.latencyCount,
      })),
    ];

    const links = Object.values(linkMap).filter((l) => l.value > 0);
    const maxNode = Math.max(1, ...cols.flat().map((c) => c.value));
    const maxLink = Math.max(1, ...links.map((l) => l.value));
    const totalRequests = cols[0].reduce((sum, n) => sum + n.value, 0);

    return {
      cols,
      links,
      maxNode,
      maxLink,
      totalRequests,
      userCount: cols[0].length,
      totalUserCount: sortedUserEntries.length,
      agentCount: cols[1].length,
      modelCount: cols[2].length,
    };
  }, [events, rows, validUserSet, userLimit, selectedUser]);

  // Connected nodes & edges calculation for active node
  const activeFocus = hoveredNodeId || selectedNodeId;
  const connectedNodeIds = useMemo(() => {
    if (!activeFocus) return new Set<string>();
    const set = new Set<string>();
    set.add(activeFocus);
    graphData.links.forEach((l) => {
      if (l.source === activeFocus) set.add(l.target);
      if (l.target === activeFocus) set.add(l.source);
    });
    return set;
  }, [activeFocus, graphData.links]);

  const isEdgeLit = (l: LinkItem) => {
    if (!activeFocus) return true;
    return l.source === activeFocus || l.target === activeFocus;
  };

  const isNodeLit = (n: NodeItem) => {
    if (!activeFocus) return true;
    return connectedNodeIds.has(n.id);
  };

  // Node Click Drill-down handler
  const handleNodeClick = (node: NodeItem) => {
    if (selectedNodeId === node.id) {
      setSelectedNodeId(null);
    } else {
      setSelectedNodeId(node.id);
      if (node.type === "user" && onFilterUser) onFilterUser(node.label);
      if (node.type === "agent" && onFilterAgent) onFilterAgent(node.label);
      if (node.type === "model" && onFilterModel) onFilterModel(node.label);
    }
  };

  // SVG Geometry constants
  const svgWidth = 1100;
  const maxRowsInCol = Math.max(
    1,
    graphData.cols[0].length,
    graphData.cols[1].length,
    graphData.cols[2].length
  );
  const rowSpacing = Math.max(38, Math.min(52, 600 / maxRowsInCol));
  const svgHeight = Math.max(540, maxRowsInCol * rowSpacing + 70);
  const colX = [150, svgWidth / 2, svgWidth - 150];

  const nodePositions = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    graphData.cols.forEach((col, colIdx) => {
      col.forEach((node, nodeIdx) => {
        pos[node.id] = {
          x: colX[colIdx],
          y: 55 + (nodeIdx + 0.5) * ((svgHeight - 90) / Math.max(1, col.length)),
        };
      });
    });
    return pos;
  }, [graphData.cols, svgHeight]);

  return (
    <section className="net-section" aria-label="Agent Network Flow">
      {/* Top Section Header */}
      <div className="net-topbar">
        <div>
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, color: "#3fa9ff" }}>
            <Sparkles size={13} />
            <span>AGENT TELEMETRY NETWORK</span>
          </div>
          <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: "2px 0 4px" }}>
            Agent Network
          </h2>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
            How requests flow from team members, through agents, to foundation models. Hover any node.
          </p>
        </div>

        {/* View Switcher & Action Controls */}
        <div className="net-controls-group">
          {/* User Count Density Selector */}
          <div className="net-view-toggle">
            <button
              type="button"
              className={`net-view-btn ${userLimit === 10 ? "active" : ""}`}
              onClick={() => setUserLimit(10)}
              title="Show Top 10 team users"
            >
              Top 10
            </button>
            <button
              type="button"
              className={`net-view-btn ${userLimit === 15 ? "active" : ""}`}
              onClick={() => setUserLimit(15)}
              title="Show Top 15 team users"
            >
              Top 15
            </button>
            <button
              type="button"
              className={`net-view-btn ${userLimit === "all" ? "active" : ""}`}
              onClick={() => setUserLimit("all")}
              title={`Show all active team users (${graphData.totalUserCount})`}
            >
              All ({graphData.totalUserCount})
            </button>
          </div>

          <div className="net-view-toggle">
            <button
              type="button"
              className={`net-view-btn ${viewMode === "2d" ? "active" : ""}`}
              onClick={() => setViewMode("2d")}
              title="2D Vector Flow Graph"
            >
              <Network size={14} />
              <span>2D Flow</span>
            </button>
            <button
              type="button"
              className={`net-view-btn ${viewMode === "3d" ? "active" : ""}`}
              onClick={() => setViewMode("3d")}
              title="Three.js 3D Particle Conduits"
            >
              <Boxes size={14} />
              <span>3D Three.js</span>
            </button>
          </div>

          <button
            type="button"
            className="net-stat-pill"
            style={{ cursor: "pointer" }}
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? "Resume pulse animation" : "Pause pulse animation"}
          >
            {isPaused ? <Play size={12} color="#2ee6a6" /> : <Pause size={12} />}
            <span>{isPaused ? "Paused" : "Live Pulse"}</span>
          </button>
        </div>
      </div>

      {/* Network Live KPIs Bar */}
      <div className="net-stats-bar">
        <span className="net-stat-pill">
          <Users size={12} color="#3fa9ff" />
          <span>Team Users</span>
          <strong>{graphData.userCount} of {graphData.totalUserCount}</strong>
        </span>
        <span className="net-stat-pill">
          <Bot size={12} color="#7c5cff" />
          <span>Active Agents</span>
          <strong>{graphData.agentCount}</strong>
        </span>
        <span className="net-stat-pill">
          <Cpu size={12} color="#2ee6a6" />
          <span>Models</span>
          <strong>{graphData.modelCount}</strong>
        </span>
        <span className="net-stat-pill">
          <Zap size={12} color="#f59e0b" />
          <span>Total Requests</span>
          <strong>{formatCompactNumber(graphData.totalRequests)}</strong>
        </span>
        <span className="net-stat-pill">
          <Layers size={12} color="#ec4899" />
          <span>Active Conduits</span>
          <strong>{graphData.links.length}</strong>
        </span>
      </div>

      {/* Filter notification if a node is pinned or user selected */}
      {(selectedNodeId || (selectedUser && selectedUser !== "all")) && (
        <div className="net-filter-alert">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Filter size={14} />
            <span>
              Highlighting traffic for:{" "}
              <strong>
                {selectedNodeId
                  ? selectedNodeId.replace(/^[uam]:/, "")
                  : selectedUser}
              </strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedNodeId(null);
              if (onFilterUser) onFilterUser("all");
              if (onFilterAgent) onFilterAgent("all");
              if (onFilterModel) onFilterModel("all");
            }}
          >
            Reset filter <X size={13} style={{ verticalAlign: "middle" }} />
          </button>
        </div>
      )}

      {/* Main Flow Card Container */}
      <div className="net-card">
        {/* Card Header with Legend */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 20px",
            borderBottom: "1px solid var(--line)",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 13 }}>
            <Network size={16} color="#7c5cff" />
            <span>Request flow graph</span>
          </div>

          <div className="net-legend-inline">
            <span>
              <i style={{ background: "#3fa9ff" }} /> Users
            </span>
            <span>
              <i style={{ background: "#7c5cff" }} /> Agents
            </span>
            <span>
              <i style={{ background: "#2ee6a6" }} /> Models
            </span>
          </div>
        </div>

        {/* View Mode 1: 2D Interactive SVG Network Flow */}
        {viewMode === "2d" && (
          <div className="net-wrap">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="net-svg"
              style={{ animationPlayState: isPaused ? "paused" : "running" }}
            >
              {/* Column Category Titles */}
              {["USERS", "AGENTS", "MODELS"].map((colTitle, idx) => (
                <text key={colTitle} x={colX[idx]} y={26} className="net-col-text">
                  {colTitle}
                </text>
              ))}

              {/* Curved Connection Flow Paths */}
              {graphData.links.map((link, idx) => {
                const src = nodePositions[link.source];
                const dst = nodePositions[link.target];
                if (!src || !dst) return null;

                const midX = (src.x + dst.x) / 2;
                const pathD = `M ${src.x},${src.y} C ${midX},${src.y} ${midX},${dst.y} ${dst.x},${dst.y}`;
                const strokeWidth = 1 + (link.value / graphData.maxLink) * 7;
                const isLit = isEdgeLit(link);
                const animDuration = Math.max(1, 2.8 - (link.value / graphData.maxLink) * 1.8) / speed;
                const animDelay = (idx % 9) * -0.3;

                return (
                  <g
                    key={`${link.source}-${link.target}-${idx}`}
                    className={`net-edge ${isLit ? "lit" : "dim"}`}
                    style={{ color: link.color }}
                  >
                    {/* Static underlying glow wire */}
                    <path
                      d={pathD}
                      strokeWidth={strokeWidth}
                      stroke={link.color}
                      className="edge-base"
                    />

                    {/* Animated flowing particle stream */}
                    {!isPaused && (
                      <path
                        d={pathD}
                        strokeWidth={Math.max(1.8, strokeWidth * 0.55)}
                        stroke="#ffffff"
                        className="edge-flow"
                        style={{
                          animationDuration: `${animDuration}s`,
                          animationDelay: `${animDelay}s`,
                        }}
                      />
                    )}
                  </g>
                );
              })}

              {/* Column Nodes */}
              {graphData.cols.flat().map((node) => {
                const pos = nodePositions[node.id];
                if (!pos) return null;

                const radius = 7 + Math.sqrt(node.value / graphData.maxNode) * 16;
                const isLit = isNodeLit(node);
                const isSelected = selectedNodeId === node.id || (node.type === "user" && selectedUser === node.label);

                return (
                  <g
                    key={node.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    className={`net-node ${node.type} ${isLit ? "" : "dim"} ${
                      isSelected ? "selected" : ""
                    }`}
                    onMouseEnter={(e) => {
                      setHoveredNodeId(node.id);
                      const rect = e.currentTarget.getBoundingClientRect();
                      setTooltip({
                        visible: true,
                        x: rect.left + rect.width / 2,
                        y: rect.top,
                        node,
                      });
                    }}
                    onMouseLeave={() => {
                      setHoveredNodeId(null);
                      setTooltip({ visible: false, x: 0, y: 0, node: null });
                    }}
                    onClick={() => handleNodeClick(node)}
                  >
                    {/* Outer Breathing Halo */}
                    <circle r={radius + 8} className="halo" />

                    {/* Core Glowing Node Circle */}
                    <circle r={radius} className="node-core" />

                    {/* Node Label Text & Volume Counter */}
                    <text
                      x={node.type === "user" ? -radius - 10 : radius + 10}
                      y={4}
                      textAnchor={node.type === "user" ? "end" : "start"}
                    >
                      {node.label}
                      <tspan className="nv"> {formatCompactNumber(node.value)}</tspan>
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* View Mode 2: Three.js Interactive 3D WebGL Particle Conduits */}
        {viewMode === "3d" && (
          <ThreeDNetworkCanvas
            data={graphData}
            activeFocus={activeFocus}
            connectedNodeIds={connectedNodeIds}
            speed={speed}
            isPaused={isPaused}
            onSelectNode={handleNodeClick}
          />
        )}
      </div>

      {/* Floating Interactive HUD Tooltip */}
      {tooltip.visible && tooltip.node && (
        <div
          className="net-tooltip"
          style={{
            position: "fixed",
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
          }}
        >
          <div className="net-tooltip-title">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background:
                  tooltip.node.type === "user"
                    ? "#3fa9ff"
                    : tooltip.node.type === "agent"
                    ? "#7c5cff"
                    : "#2ee6a6",
              }}
            />
            <span>{tooltip.node.label}</span>
            <small style={{ color: "var(--muted)", textTransform: "capitalize" }}>
              ({tooltip.node.type})
            </small>
          </div>
          <div className="net-tooltip-row">
            <span>Requests:</span>
            <strong>{tooltip.node.value.toLocaleString()}</strong>
          </div>
          {tooltip.node.tokens > 0 && (
            <div className="net-tooltip-row">
              <span>Tokens:</span>
              <strong>{formatCompactNumber(tooltip.node.tokens)}</strong>
            </div>
          )}
          {tooltip.node.latencyCount > 0 && (
            <div className="net-tooltip-row">
              <span>Avg Latency:</span>
              <strong>
                {Math.round(tooltip.node.latencySum / tooltip.node.latencyCount)}ms
              </strong>
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: 10, color: "#3fa9ff" }}>
            Click to pin and filter call logs
          </div>
        </div>
      )}
    </section>
  );
}

// ============================================================================
// Three.js 3D WebGL Particle Scene Component
// ============================================================================
function ThreeDNetworkCanvas({
  data,
  activeFocus,
  connectedNodeIds,
  speed,
  isPaused,
  onSelectNode,
}: {
  data: {
    cols: [NodeItem[], NodeItem[], NodeItem[]];
    links: LinkItem[];
    maxNode: number;
    maxLink: number;
  };
  activeFocus: string | null;
  connectedNodeIds: Set<string>;
  speed: number;
  isPaused: boolean;
  onSelectNode: (node: NodeItem) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [threeStatus, setThreeStatus] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => {
    let renderer: any = null;
    let animId: number = 0;
    let isDisposed = false;

    async function initThree() {
      if (!mountRef.current) return;

      // 1. Load Three.js dynamically (from window, import, or unpkg CDN fallback)
      let THREE: any = null;
      if (typeof window !== "undefined" && (window as any).THREE) {
        THREE = (window as any).THREE;
      } else {
        try {
          const mod = await import("three");
          THREE = mod;
        } catch {
          THREE = await new Promise((resolve) => {
            const script = document.createElement("script");
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
            script.async = true;
            script.onload = () => resolve((window as any).THREE);
            script.onerror = () => resolve(null);
            document.head.appendChild(script);
          });
        }
      }

      if (!THREE || isDisposed) {
        setThreeStatus("fallback");
        return;
      }
      setThreeStatus("ready");

      const width = mountRef.current.clientWidth || 950;
      const height = 560;

      // 2. Scene, Camera & Lights
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x080a14);

      const camera = new THREE.PerspectiveCamera(45, width / height, 1, 3000);
      camera.position.set(0, 0, 750);

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
      scene.add(ambientLight);

      const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
      dirLight.position.set(100, 200, 300);
      scene.add(dirLight);

      // 3. Background Cyber Starfield / Dust
      const dustCount = 350;
      const dustGeo = new THREE.BufferGeometry();
      const dustPos = new Float32Array(dustCount * 3);
      for (let i = 0; i < dustCount * 3; i += 3) {
        dustPos[i] = (Math.random() - 0.5) * 1600;
        dustPos[i + 1] = (Math.random() - 0.5) * 1000;
        dustPos[i + 2] = (Math.random() - 0.5) * 600 - 200;
      }
      dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
      const dustMat = new THREE.PointsMaterial({
        color: 0x4f6494,
        size: 2.2,
        transparent: true,
        opacity: 0.45,
      });
      const dustPoints = new THREE.Points(dustGeo, dustMat);
      scene.add(dustPoints);

      // 4. Calculate 3D Positions for 3 Columns
      const colX = [-260, 0, 260];
      const nodePos3D: Record<string, { x: number; y: number; z: number }> = {};
      const nodeMeshes: { mesh: any; node: NodeItem }[] = [];

      data.cols.forEach((col, cIdx) => {
        const count = col.length;
        const totalHeight = Math.max(340, count * 36);
        col.forEach((node, nIdx) => {
          const y = totalHeight / 2 - (nIdx + 0.5) * (totalHeight / Math.max(1, count));
          const z = (Math.sin(nIdx * 0.7 + cIdx) * 20);
          nodePos3D[node.id] = { x: colX[cIdx], y, z };

          const baseRadius = 6 + Math.sqrt(node.value / data.maxNode) * 10;
          const sphereGeo = new THREE.SphereGeometry(baseRadius, 24, 24);
          const colorHex =
            node.type === "user" ? 0x3fa9ff : node.type === "agent" ? 0x7c5cff : 0x2ee6a6;

          const sphereMat = new THREE.MeshStandardMaterial({
            color: colorHex,
            emissive: colorHex,
            emissiveIntensity: 0.65,
            roughness: 0.2,
            metalness: 0.8,
          });
          const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
          sphereMesh.position.set(colX[cIdx], y, z);
          sphereMesh.userData = { nodeId: node.id, node };
          scene.add(sphereMesh);
          nodeMeshes.push({ mesh: sphereMesh, node });
        });
      });

      // 5. Build 3D Curved Conduits & Flowing Particles
      const curves: any[] = [];
      const particleStreams: {
        pointsMesh: any;
        curve: any;
        offsets: Float32Array;
        speed: number;
      }[] = [];

      data.links.forEach((link) => {
        const p1 = nodePos3D[link.source];
        const p2 = nodePos3D[link.target];
        if (!p1 || !p2) return;

        const v0 = new THREE.Vector3(p1.x, p1.y, p1.z);
        const v1 = new THREE.Vector3((p1.x + p2.x) * 0.5, p1.y, (p1.z + p2.z) * 0.5 + 40);
        const v2 = new THREE.Vector3((p1.x + p2.x) * 0.5, p2.y, (p1.z + p2.z) * 0.5 + 40);
        const v3 = new THREE.Vector3(p2.x, p2.y, p2.z);

        const curve = new THREE.CubicBezierCurve3(v0, v1, v2, v3);
        curves.push(curve);

        // Base Conduit Wire
        const pts = curve.getPoints(36);
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const lineColor = link.color === "#3fa9ff" ? 0x3fa9ff : 0x7c5cff;
        const lineMat = new THREE.LineBasicMaterial({
          color: lineColor,
          transparent: true,
          opacity: 0.18,
          linewidth: 1,
        });
        const lineMesh = new THREE.Line(lineGeo, lineMat);
        scene.add(lineMesh);

        // Flowing Photons / Particles along spline
        const particleCount = Math.max(3, Math.min(14, Math.round(3 + (link.value / data.maxLink) * 10)));
        const pGeo = new THREE.BufferGeometry();
        const pPositions = new Float32Array(particleCount * 3);
        const offsets = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
          offsets[i] = i / particleCount;
          const pos = curve.getPointAt(offsets[i]);
          pPositions[i * 3] = pos.x;
          pPositions[i * 3 + 1] = pos.y;
          pPositions[i * 3 + 2] = pos.z;
        }

        pGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
        const pMat = new THREE.PointsMaterial({
          color: 0xffffff,
          size: 4.5,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
        });
        const pMesh = new THREE.Points(pGeo, pMat);
        scene.add(pMesh);

        particleStreams.push({
          pointsMesh: pMesh,
          curve,
          offsets,
          speed: 0.004 + (link.value / data.maxLink) * 0.008,
        });
      });

      // 6. Renderer setup
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      if (mountRef.current) {
        mountRef.current.innerHTML = "";
        mountRef.current.appendChild(renderer.domElement);
      }

      // 7. Interactive Mouse Orbit / Tilt
      let mouseX = 0;
      let mouseY = 0;
      let targetRotX = 0;
      let targetRotY = 0;

      const handleMouseMove = (e: MouseEvent) => {
        if (!mountRef.current) return;
        const rect = mountRef.current.getBoundingClientRect();
        mouseX = ((e.clientX - rect.left) / width - 0.5) * 2;
        mouseY = ((e.clientY - rect.top) / height - 0.5) * 2;
        targetRotY = mouseX * 0.35;
        targetRotX = -mouseY * 0.25;
      };

      mountRef.current.addEventListener("mousemove", handleMouseMove);

      // 8. Animation Render Loop
      let clock = 0;
      const animate = () => {
        if (isDisposed) return;
        animId = requestAnimationFrame(animate);

        // Gentle camera dampening
        scene.rotation.y += (targetRotY - scene.rotation.y) * 0.05;
        scene.rotation.x += (targetRotX - scene.rotation.x) * 0.05;

        // Slow starfield drift
        dustPoints.rotation.y += 0.0004;

        // Update flowing particles
        if (!isPaused) {
          clock += 0.01 * speed;
          particleStreams.forEach((stream) => {
            const posAttr = stream.pointsMesh.geometry.attributes.position;
            const arr = posAttr.array;
            for (let i = 0; i < stream.offsets.length; i++) {
              stream.offsets[i] = (stream.offsets[i] + stream.speed * speed) % 1;
              const pt = stream.curve.getPointAt(stream.offsets[i]);
              arr[i * 3] = pt.x;
              arr[i * 3 + 1] = pt.y;
              arr[i * 3 + 2] = pt.z;
            }
            posAttr.needsUpdate = true;
          });
        }

        // Pulse node glow
        const pulse = 1 + Math.sin(clock * 4) * 0.05;
        nodeMeshes.forEach(({ mesh }) => {
          mesh.scale.set(pulse, pulse, pulse);
        });

        renderer.render(scene, camera);
      };

      animate();

      const handleResize = () => {
        if (!mountRef.current || !renderer) return;
        const w = mountRef.current.clientWidth || 950;
        camera.aspect = w / height;
        camera.updateProjectionMatrix();
        renderer.setSize(w, height);
      };
      window.addEventListener("resize", handleResize);

      return () => {
        isDisposed = true;
        cancelAnimationFrame(animId);
        window.removeEventListener("resize", handleResize);
        if (renderer && renderer.domElement && renderer.domElement.parentElement) {
          renderer.domElement.parentElement.removeChild(renderer.domElement);
          renderer.dispose();
        }
      };
    }

    const cleanupPromise = initThree();

    return () => {
      isDisposed = true;
      cleanupPromise.then((cleanup) => {
        if (typeof cleanup === "function") cleanup();
      });
    };
  }, [data, speed, isPaused]);

  return (
    <div className="net-canvas-wrap" ref={mountRef}>
      <div className="net-canvas-overlay">
        <h4>Three.js 3D Interactive Conduits</h4>
        <p>Interactive WebGL particle stream. Move cursor to rotate angle.</p>
      </div>
      <div className="net-canvas-controls">
        <span>3D Scene Active</span>
        <button
          type="button"
          className="net-canvas-btn"
          onClick={() => {
            if (mountRef.current) {
              const evt = new MouseEvent("mousemove", { clientX: 0, clientY: 0 });
              mountRef.current.dispatchEvent(evt);
            }
          }}
        >
          <RotateCcw size={10} style={{ marginRight: 4 }} /> Center
        </button>
      </div>
    </div>
  );
}
