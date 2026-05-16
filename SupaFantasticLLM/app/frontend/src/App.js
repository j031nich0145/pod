// ============================================================
// 🚀 App.js — SupaFantastic LLM (Polished)
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { useTheme } from "./theme/ThemeProvider";
import { ThemeEditor } from "./theme/ThemeEditor";

// ─────────────────────────────────────
// GLOBAL STYLE RESET (kills white border)
// ─────────────────────────────────────
const GLOBAL_RESET = `
  html, body, #root {
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    outline: none !important;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--color-bg, #0a0a0a);
  }
  *, *::before, *::after {
    box-sizing: border-box;
  }
  @keyframes thinkingPulse {
    0%, 100% { opacity: 0.5; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.03); }
  }
`;

function useGlobalReset() {
  useEffect(() => {
    const id = "sf-global-reset";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = GLOBAL_RESET;
      document.head.appendChild(style);
    }
  }, []);
}

// ─────────────────────────────────────
// MARKDOWN RENDERER WITH CODE COPY
// ─────────────────────────────────────
function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <pre
      style={{
        background: "var(--color-code)",
        borderRadius: "8px",
        padding: "12px",
        overflowX: "auto",
        margin: "8px 0",
        fontFamily: "var(--font-family-mono)",
        fontSize: "13px",
        lineHeight: "1.5",
        border: "1px solid var(--color-border)",
        position: "relative",
      }}
    >
      {lang && (
        <span
          style={{
            color: "var(--color-text-subtle)",
            fontSize: "11px",
            position: "absolute",
            top: "8px",
            left: "10px",
          }}
        >
          {lang}
        </span>
      )}
      <button
        onClick={handleCopy}
        style={{
          position: "absolute",
          top: "8px",
          right: "10px",
          background: copied ? "var(--color-success)" : "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "6px",
          padding: "4px 8px",
          fontSize: "11px",
          color: copied ? "#fff" : "var(--color-text-muted)",
          cursor: "pointer",
          fontFamily: "var(--font-family)",
          transition: "all 0.15s ease",
        }}
      >
        {copied ? "✓ Copied" : "Copy"}
      </button>
      <code style={{ display: "block", marginTop: lang ? "20px" : "0" }}>{code}</code>
    </pre>
  );
}

function renderMarkdown(text) {
  if (!text) return "";

  const lines = text.split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(<CodeBlock key={i} code={codeLines.join("\n")} lang={lang} />);
      i++;
      continue;
    }

    // Headers
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} style={{ margin: "10px 0 4px", fontSize: "14px", fontWeight: 700 }}>
          {line.slice(4)}
        </h3>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} style={{ margin: "12px 0 4px", fontSize: "16px", fontWeight: 700 }}>
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h1 key={i} style={{ margin: "12px 0 4px", fontSize: "18px", fontWeight: 800 }}>
          {line.slice(2)}
        </h1>
      );
    } else if (line.startsWith("- ") || line.startsWith("• ")) {
      elements.push(
        <div key={i} style={{ display: "flex", gap: "8px", margin: "2px 0" }}>
          <span style={{ color: "var(--color-accent)", flexShrink: 0 }}>•</span>
          <span>{inlineFormat(line.slice(2))}</span>
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: "8px" }} />);
    } else {
      elements.push(<div key={i}>{inlineFormat(line)}</div>);
    }

    i++;
  }

  return elements;
}

function inlineFormat(text) {
  const parts = [];
  const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let last = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));

    if (match[2]) {
      parts.push(
        <strong key={match.index} style={{ fontWeight: 700 }}>
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      parts.push(<em key={match.index}>{match[3]}</em>);
    } else if (match[4]) {
      parts.push(
        <code
          key={match.index}
          style={{
            background: "var(--color-code)",
            padding: "1px 5px",
            borderRadius: "4px",
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.9em",
          }}
        >
          {match[4]}
        </code>
      );
    }

    last = match.index + match[0].length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : parts;
}

// ─────────────────────────────────────
// MESSAGE BUBBLE
// ─────────────────────────────────────
function MessageBubble({ msg, isLast, onRegenerate }) {
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === "user";

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setCopied(false); }}
      style={{
        display: "flex",
        flexDirection: isUser ? "row-reverse" : "row",
        gap: "10px",
        alignItems: "flex-start",
        maxWidth: "100%",
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: "32px",
          height: "32px",
          borderRadius: "var(--radius-avatar)",
          background: isUser ? "var(--color-user-bubble)" : "var(--color-surface)",
          border: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "14px",
          flexShrink: 0,
          marginTop: "2px",
        }}
      >
        {isUser ? "👤" : "🤖"}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          maxWidth: "75%",
          alignItems: isUser ? "flex-end" : "flex-start",
        }}
      >
        {/* Role label */}
        <span
          style={{
            fontSize: "11px",
            color: "var(--color-text-subtle)",
            fontWeight: 500,
            paddingLeft: "2px",
            paddingRight: "2px",
            marginBottom: "4px",
          }}
        >
          {isUser ? "You" : "Assistant"}
          {msg.model && (
            <span style={{ marginLeft: "6px", color: "var(--color-text-subtle)", fontWeight: 400 }}>
              · {msg.model}
            </span>
          )}
        </span>

        {/* Bubble + side action row */}
        <div style={{ display: "flex", flexDirection: isUser ? "row-reverse" : "row", alignItems: "flex-end", gap: "8px" }}>
          {/* The bubble */}
          <div
            style={{
              background: isUser ? "var(--color-user-bubble)" : "var(--color-assistant-bubble)",
              color: isUser ? "var(--color-user-bubble-fg)" : "var(--color-assistant-bubble-fg)",
              padding: "10px 14px",
              borderRadius: isUser
                ? "var(--radius-bubble) 4px var(--radius-bubble) var(--radius-bubble)"
                : "4px var(--radius-bubble) var(--radius-bubble) var(--radius-bubble)",
              fontSize: "var(--font-size-base)",
              lineHeight: "var(--line-height)",
              boxShadow: isUser ? "none" : "var(--shadow-sm)",
              border: isUser ? "none" : "1px solid var(--color-border)",
            }}
          >
            {msg.thinking && (
              <div style={{
                fontSize: "12px",
                color: "var(--color-text-muted)",
                fontStyle: "italic",
                animation: "thinkingPulse 2s ease-in-out infinite",
                transformOrigin: "left center",
              }}>
                ⟳ Thinking...
              </div>
            )}
            {!msg.thinking && (
              <div style={{ lineHeight: "var(--line-height)" }}>
                {isUser ? msg.content : renderMarkdown(msg.content)}
              </div>
            )}
          </div>

          {/* Side actions — visible on hover, no layout shift */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              opacity: hover && !msg.thinking ? 1 : 0,
              transition: "opacity 0.15s ease",
              pointerEvents: hover && !msg.thinking ? "auto" : "none",
              flexShrink: 0,
              paddingBottom: "4px",
            }}
          >
            <button
              onClick={handleCopy}
              title="Copy message"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-subtle)",
                fontSize: "12px",
                padding: "2px 4px",
                borderRadius: "4px",
                fontFamily: "var(--font-family)",
                whiteSpace: "nowrap",
                transition: "color 0.15s ease",
              }}
            >
              {copied ? "✓" : "📋"}
            </button>
            {!isUser && isLast && onRegenerate && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRegenerate();
                }}
                title="Regenerate"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-subtle)",
                  fontSize: "12px",
                  padding: "2px 4px",
                  borderRadius: "4px",
                  fontFamily: "var(--font-family)",
                }}
              >
                ↺
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────
function EmptyState({ onSend }) {
  const starters = [
    "Explain quantum entanglement simply",
    "Write a Python script to sort files by date",
    "Help me debug this React component",
    "What's the best way to structure a REST API?",
  ];

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        gap: "24px",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "40px", marginBottom: "12px" }}>✦</div>
        <div
          style={{
            fontSize: "22px",
            fontWeight: 700,
            color: "var(--color-text)",
            fontFamily: "var(--font-family-display)",
            marginBottom: "6px",
          }}
        >
          SupaFantastic LLM
        </div>
        <div style={{ fontSize: "14px", color: "var(--color-text-muted)" }}>
          How can I help you today?
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10px",
          maxWidth: "480px",
          width: "100%",
        }}
      >
        {starters.map((s, i) => (
          <button
            key={i}
            onClick={() => onSend(s)}
            style={{
              padding: "12px 14px",
              borderRadius: "var(--radius-card)",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              color: "var(--color-text)",
              cursor: "pointer",
              fontSize: "13px",
              textAlign: "left",
              lineHeight: "1.4",
              fontFamily: "var(--font-family)",
              transition: "all var(--transition-speed) var(--transition-easing)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-surface)")}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────
// SIDEBAR ITEM
// ─────────────────────────────────────
function SidebarItem({ conv, isActive, onClick, onRename, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(conv.title);
  const menuRef = useRef();

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const saveEdit = () => {
    onRename(conv.id, editVal || "Untitled");
    setEditing(false);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "8px 10px",
        borderRadius: "var(--radius-sidebar-item)",
        background: isActive ? "var(--color-accent-subtle)" : "transparent",
        border: `1px solid ${isActive ? "var(--color-accent)" : "transparent"}`,
        cursor: "pointer",
        transition: "all var(--transition-speed) var(--transition-easing)",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "var(--color-surface-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ fontSize: "13px", flexShrink: 0, opacity: 0.7 }}>💬</span>

      <div style={{ flex: 1, minWidth: 0 }} onClick={() => !editing && onClick(conv.id)}>
        {editing ? (
          <input
            autoFocus
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveEdit();
              if (e.key === "Escape") setEditing(false);
            }}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--color-text)",
              fontFamily: "var(--font-family)",
              fontSize: "var(--font-size-base)",
            }}
          />
        ) : (
          <div
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "var(--font-size-base)",
              color: isActive ? "var(--color-accent)" : "var(--color-text)",
              fontWeight: isActive ? 500 : 400,
            }}
          >
            {conv.title}
          </div>
        )}
      </div>

      <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            padding: "2px 4px",
            borderRadius: "4px",
            fontSize: "14px",
            lineHeight: 1,
            opacity: menuOpen ? 1 : 0.5,
          }}
        >
          ⋮
        </button>

        {menuOpen && (
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 4px)",
              background: "var(--color-panel)",
              borderRadius: "var(--radius-card)",
              border: "1px solid var(--color-border-strong)",
              boxShadow: "var(--shadow-lg)",
              zIndex: 9999,
              minWidth: "130px",
              overflow: "hidden",
            }}
          >
            <MenuItem
              label="Rename"
              icon="✏️"
              onClick={() => {
                setEditing(true);
                setMenuOpen(false);
              }}
            />
            <MenuItem
              label="Delete"
              icon="🗑"
              danger
              onClick={() => {
                onDelete(conv.id);
                setMenuOpen(false);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ label, icon, onClick, danger }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        cursor: "pointer",
        fontSize: "13px",
        color: danger ? "var(--color-danger)" : "var(--color-text)",
        background: hover
          ? danger
            ? "var(--color-danger-subtle)"
            : "var(--color-surface-hover)"
          : "transparent",
        fontFamily: "var(--font-family)",
        transition: "background 0.1s ease",
      }}
    >
      <span style={{ fontSize: "12px" }}>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────
// RUNPOD STATUS PILL (header indicator)
// ─────────────────────────────────────
function RunpodPill({ config, onStart, onStop, loading }) {
  if (!config.enabled) return null;

  const isOn = config.podRunning;
  const providerLabel = config.provider === "vast" ? "Vast.ai" : "RunPod";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <div
        style={{
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          background: isOn ? "var(--color-success)" : "var(--color-text-subtle)",
          boxShadow: isOn ? "0 0 6px var(--color-success)" : "none",
          transition: "all 0.3s ease",
        }}
      />
      <span style={{ fontSize: "11px", color: "var(--color-text-muted)", fontWeight: 500 }}>
        {providerLabel}
      </span>
      <button
        onClick={isOn ? onStop : onStart}
        disabled={loading}
        style={{
          padding: "4px 10px",
          borderRadius: "var(--radius-button)",
          border: "1px solid var(--color-border)",
          background: isOn ? "var(--color-surface)" : "var(--color-accent-subtle)",
          color: isOn ? "var(--color-text-muted)" : "var(--color-accent)",
          cursor: loading ? "wait" : "pointer",
          fontSize: "11px",
          fontWeight: 600,
          fontFamily: "var(--font-family)",
          opacity: loading ? 0.6 : 1,
          transition: "all 0.15s ease",
        }}
      >
        {loading ? "..." : isOn ? "Stop" : "Start"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────
// SSH TERMINAL MODAL
// ─────────────────────────────────────
function TerminalModal({ onClose }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let term, ws;

    Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-attach"),
      import("@xterm/xterm/css/xterm.css"),
    ]).then(([{ Terminal }, { AttachAddon }]) => {
      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'Fira Code', 'Cascadia Code', 'Courier New', monospace",
        theme: {
          background: "#0d1117",
          foreground: "#e6edf3",
          cursor: "#58a6ff",
          cursorAccent: "#0d1117",
          selectionBackground: "#264f78",
          black: "#0d1117", red: "#ff7b72", green: "#3fb950",
          yellow: "#d29922", blue: "#58a6ff", magenta: "#bc8cff",
          cyan: "#39c5cf", white: "#b1bac4",
        },
        cols: 120, rows: 36,
        scrollback: 2000,
      });

      term.open(containerRef.current);
      term.write("\r\n  \x1b[36mConnecting to pod SSH...\x1b[0m\r\n\r\n");

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//localhost:5000/ssh/terminal`);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        const addon = new AttachAddon(ws);
        term.loadAddon(addon);
      };
      ws.onerror = () => term.write("\r\n  \x1b[31m[connection error]\x1b[0m\r\n");
      ws.onclose = () => term.write("\r\n  \x1b[33m[disconnected]\x1b[0m\r\n");

      termRef.current = { term, ws };
    }).catch((err) => {
      console.error("xterm load failed:", err);
    });

    return () => {
      try { termRef.current?.ws?.close(); } catch {}
      try { termRef.current?.term?.dispose(); } catch {}
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#0d1117", borderRadius: "10px",
        border: "1px solid var(--color-border)",
        width: "min(960px, 95vw)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.8)",
        overflow: "hidden", display: "flex", flexDirection: "column",
      }}>
        {/* Title bar */}
        <div style={{
          padding: "10px 16px", background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <div style={{ display: "flex", gap: "6px" }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ffbd2e" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
          </div>
          <span style={{
            flex: 1, textAlign: "center", fontSize: "12px",
            color: "var(--color-text-muted)", fontFamily: "var(--font-family-mono)",
          }}>
            root@pod — ssh
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: "var(--color-text-muted)", fontSize: "16px", padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>
        {/* Terminal container */}
        <div ref={containerRef} style={{ padding: "8px 12px", background: "#0d1117" }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────
// MODES PANEL (slide-out)
// ─────────────────────────────────────
function ModesPanel({ config, onChange, onClose, onStart, onStop, loading, startLogs, models, selectedModel, onSelectModel, elapsedSecs }) {
  const panelRef = useRef();
  const logsEndRef = useRef();
  const [podInfo, setPodInfo] = useState(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(320);
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  const [logHeight, setLogHeight] = useState(220);
  const [isLogResizing, setIsLogResizing] = useState(false);
  const [providerOpen, setProviderOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(true);

  // Auto-collapse settings when job starts to give log more room
  useEffect(() => {
    if (loading) { setSettingsOpen(false); setProviderOpen(false); }
    if (!loading && !config.podRunning) { setSettingsOpen(true); setProviderOpen(true); }
  }, [loading, config.podRunning]);

  useEffect(() => {
    const handleMove = (e) => {
      if (!isPanelResizing) return;
      const newWidth = window.innerWidth - e.clientX;
      setPanelWidth(Math.max(280, Math.min(900, newWidth)));
    };
    const handleUp = () => setIsPanelResizing(false);
    if (isPanelResizing) {
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
      return () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
    }
  }, [isPanelResizing]);

  useEffect(() => {
    const handleMove = (e) => {
      if (!isLogResizing) return;
      const logEl = document.getElementById("sf-log-body");
      if (!logEl) return;
      const rect = logEl.parentElement.getBoundingClientRect();
      const newH = Math.max(80, Math.min(600, e.clientY - rect.top));
      setLogHeight(newH);
    };
    const handleUp = () => setIsLogResizing(false);
    if (isLogResizing) {
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
      return () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
    }
  }, [isLogResizing]);

  useEffect(() => {
    const poll = () => {
      fetch("http://localhost:5000/runpod/config")
        .then((r) => r.json())
        .then((d) => setPodInfo(d.config || null))
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (terminalOpen) return;  // don't close panel while terminal is open
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, terminalOpen]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [startLogs]);

  const set = (key, value) => onChange({ ...config, [key]: value });

  const SectionLabel = ({ children }) => (
    <div style={{
      fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
      letterSpacing: "0.08em", color: "var(--color-text-muted)",
      marginBottom: "8px", marginTop: "4px",
    }}>
      {children}
    </div>
  );

  const CollapsibleHeader = ({ label, open, onToggle }) => (
    <div
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        cursor: "pointer", padding: "4px 0", marginBottom: open ? "8px" : "4px",
        userSelect: "none",
      }}
    >
      <div style={{
        fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
        letterSpacing: "0.08em", color: "var(--color-text-muted)",
      }}>
        {label}
      </div>
      <div style={{
        fontSize: "10px", color: "var(--color-text-muted)", opacity: 0.6,
        transform: open ? "rotate(0deg)" : "rotate(-90deg)",
        transition: "transform 0.15s ease",
        lineHeight: 1,
      }}>▾</div>
    </div>
  );

  const Field = ({ label, value, onChange: onFieldChange, placeholder, type = "text" }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "10px" }}>
      <label style={{ fontSize: "12px", color: "var(--color-text-muted)", fontWeight: 500 }}>{label}</label>
      <input
        type={type}
        value={value || ""}
        onChange={(e) => onFieldChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background: "var(--color-input-bg)", border: "1px solid var(--color-input-border)",
          borderRadius: "6px", padding: "7px 10px", fontSize: "12px",
          fontFamily: "var(--font-family-mono)", color: "var(--color-text)",
          outline: "none", width: "100%", boxSizing: "border-box",
        }}
      />
    </div>
  );

  const Toggle = ({ label, checked, onChange: onToggle }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
      <span style={{ fontSize: "13px", color: "var(--color-text)", fontWeight: 500 }}>{label}</span>
      <button
        onClick={() => onToggle(!checked)}
        style={{
          width: "40px", height: "22px", borderRadius: "11px", border: "none",
          background: checked ? "var(--color-accent)" : "var(--color-surface)",
          cursor: "pointer", position: "relative", transition: "background 0.2s ease",
          boxShadow: "inset 0 1px 3px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{
          width: "16px", height: "16px", borderRadius: "50%", background: "#fff",
          position: "absolute", top: "3px", left: checked ? "20px" : "4px",
          transition: "left 0.2s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }} />
      </button>
    </div>
  );

  const podModels = models?.length
    ? models
    : [
        { id: "qwen-coder",  label: "Qwen2.5-Coder-32B (AWQ)" },
        { id: "deepseek-r1", label: "DeepSeek-R1-Distill-Qwen-32B (AWQ)" },
      ];

  return (
    <div ref={panelRef} style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: `${panelWidth}px`,
      background: "var(--color-panel)", borderLeft: "1px solid var(--color-border)",
      boxShadow: "var(--shadow-lg)", zIndex: 1000, display: "flex",
      flexDirection: "column", fontFamily: "var(--font-family)",
      userSelect: isPanelResizing ? "none" : "auto",
    }}>
      {/* Drag handle — left edge */}
      <div
        onMouseDown={() => setIsPanelResizing(true)}
        style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: "5px",
          cursor: "col-resize", zIndex: 10,
          background: isPanelResizing ? "var(--color-accent)" : "transparent",
          transition: "background 0.15s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-border-strong)")}
        onMouseLeave={(e) => { if (!isPanelResizing) e.currentTarget.style.background = "transparent"; }}
      />
      {/* Header */}
      <div style={{
        padding: "16px", borderBottom: "1px solid var(--color-border)",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "15px", color: "var(--color-text)" }}>⚡ Modes</div>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "2px" }}>
            Infrastructure & runtime settings
          </div>
        </div>
        <button onClick={onClose} style={{
          background: "transparent", border: "none", cursor: "pointer",
          color: "var(--color-text-muted)", fontSize: "18px", lineHeight: 1, padding: "4px",
        }}>×</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>

        <SectionLabel>Backend</SectionLabel>
        <Toggle label="Enable Backend Mode" checked={config.enabled} onChange={(v) => set("enabled", v)} />

        {config.enabled && (
          <>
            {/* Provider selector — collapsible */}
            <CollapsibleHeader
              label="Provider"
              open={providerOpen}
              onToggle={() => setProviderOpen(v => !v)}
            />
            {providerOpen && (
            <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
              {[
                { id: "runpod", label: "⚡ RunPod",   info: "from $0.34/hr · GPU cloud · templates" },
                { id: "vast",   label: "🌐 Vast.ai", info: "from $0.19/hr · fresh instance · no storage" },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => set("provider", p.id)}
                  disabled={loading || config.podRunning}
                  style={{
                    flex: 1, padding: "8px 6px", borderRadius: "var(--radius-button)",
                    border: config.provider === p.id ? "1.5px solid var(--color-accent)" : "1px solid var(--color-border)",
                    background: config.provider === p.id ? "var(--color-accent-subtle)" : "var(--color-surface)",
                    color: config.provider === p.id ? "var(--color-accent)" : "var(--color-text-muted)",
                    fontWeight: config.provider === p.id ? 700 : 500,
                    fontSize: "12px", cursor: (loading || config.podRunning) ? "not-allowed" : "pointer",
                    opacity: (loading || config.podRunning) ? 0.6 : 1,
                    fontFamily: "var(--font-family)", transition: "all 0.15s ease",
                    textAlign: "center",
                  }}
                >
                  <div>{p.label}</div>
                  <div style={{ fontSize: "10px", opacity: 0.7, marginTop: "2px", fontWeight: 400 }}>{p.info}</div>
                </button>
              ))}
            </div>
            )}

            {/* Settings — collapsible */}
            <CollapsibleHeader
              label="Settings"
              open={settingsOpen}
              onToggle={() => setSettingsOpen(v => !v)}
            />
            {settingsOpen && (<>
            {/* Model selector */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "10px" }}>
              <label style={{ fontSize: "12px", color: "var(--color-text-muted)", fontWeight: 500 }}>Model</label>
              <select
                value={selectedModel?.id || "qwen-coder"}
                onChange={(e) => onSelectModel(podModels.find((m) => m.id === e.target.value) || podModels[0])}
                disabled={loading || config.podRunning}
                style={{
                  background: "var(--color-input-bg)", border: "1px solid var(--color-input-border)",
                  borderRadius: "6px", padding: "7px 10px", fontSize: "12px",
                  fontFamily: "var(--font-family)", color: "var(--color-text)",
                  outline: "none", width: "100%",
                  cursor: (loading || config.podRunning) ? "not-allowed" : "pointer",
                  opacity: (loading || config.podRunning) ? 0.6 : 1,
                }}
              >
                {podModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              {config.podRunning && (
                <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                  Stop the pod to switch models
                </div>
              )}
            </div>

            <div style={{ height: "1px", background: "var(--color-border)", margin: "4px 0" }} />

            <Toggle label="Auto-timeout" checked={config.timeoutEnabled} onChange={(v) => set("timeoutEnabled", v)} />
            {config.timeoutEnabled && (
              <Field
                label="Timeout (minutes of inactivity)"
                value={config.timeoutMinutes}
                onChange={(v) => set("timeoutMinutes", v)}
                placeholder="15"
                type="number"
              />
            )}
            </>)}

            <div style={{ height: "1px", background: "var(--color-border)", margin: "4px 0" }} />

            {/* Start button — Kill is in the log header when running */}
            {!config.podRunning && (
            <button
              onClick={onStart}
              disabled={loading}
              style={{
                width: "100%", padding: "11px", borderRadius: "var(--radius-button)",
                cursor: loading ? "wait" : "pointer", fontWeight: 700, fontSize: "13px",
                fontFamily: "var(--font-family)", transition: "all 0.15s ease",
                background: loading ? "var(--color-surface)" : "var(--color-accent)",
                color: loading ? "var(--color-text-muted)" : "#fff",
                border: "none",
              }}
            >
              {loading
                ? `Working…  ${elapsedSecs >= 60 ? `${Math.floor(elapsedSecs/60)}m ${elapsedSecs%60}s` : `${elapsedSecs}s`}`
                : "▶  Start Backend"
              }
            </button>
            )}

            {/* Log area + integrated status bar */}
            {(startLogs.length > 0 || loading || config.podRunning) && (
              <div style={{
                borderRadius: "6px", border: "1px solid var(--color-border)",
                background: "var(--color-code, #0d1117)", overflow: "hidden",
                userSelect: isLogResizing ? "none" : "auto",
              }}>

                {/* Header: status dot + label + SSH + Kill */}
                <div style={{
                  padding: "5px 8px", borderBottom: "1px solid var(--color-border)",
                  fontSize: "11px", display: "flex", alignItems: "center", gap: "6px",
                }}>
                  <div style={{
                    width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0,
                    background: loading ? "var(--color-accent)"
                      : config.podRunning ? "var(--color-success, #4ade80)"
                      : "var(--color-text-subtle)",
                    boxShadow: config.podRunning && !loading ? "0 0 6px var(--color-success,#4ade80)" : "none",
                    transition: "all 0.4s ease",
                  }} />
                  <span style={{ fontWeight: 600, color: "var(--color-text-muted)", flex: 1, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {loading ? `Working… ${elapsedSecs >= 60 ? `${Math.floor(elapsedSecs/60)}m ${elapsedSecs%60}s` : `${elapsedSecs}s`}`
                      : config.podRunning ? (config.provider === "vast" ? "Vast.ai · Running" : "RunPod · Running")
                      : "Stopped"}
                  </span>
                  {/* Connection info inline */}
                  {(podInfo?.SSH_HOST || podInfo?.VAST_SSH_HOST) && (
                    <span style={{ fontSize: "10px", color: "var(--color-text-subtle)", fontFamily: "var(--font-family-mono)" }}>
                      {podInfo.SSH_HOST || podInfo.VAST_SSH_HOST}
                    </span>
                  )}
                  {/* SSH button */}
                  {config.podRunning && (podInfo?.SSH_HOST || podInfo?.VAST_SSH_HOST) && (
                    <button onClick={() => setTerminalOpen(true)} style={{
                      padding: "2px 7px", borderRadius: "4px",
                      border: "1px solid var(--color-accent)", background: "var(--color-accent-subtle)",
                      color: "var(--color-accent)", cursor: "pointer",
                      fontSize: "10px", fontWeight: 700, fontFamily: "var(--font-family)",
                    }}>SSH</button>
                  )}
                  {/* Kill button */}
                  {(loading || config.podRunning) && (
                    <button onClick={onStop} style={{
                      padding: "2px 7px", borderRadius: "4px",
                      border: "1px solid var(--color-danger,#f87171)", background: "transparent",
                      color: "var(--color-danger,#f87171)", cursor: "pointer",
                      fontSize: "10px", fontWeight: 700, fontFamily: "var(--font-family)",
                    }}>Kill</button>
                  )}
                  <span style={{ fontSize: "10px", opacity: 0.5 }}>{loading ? "● LIVE" : "■ DONE"}</span>
                </div>

                {/* Log lines */}
                <div
                  id="sf-log-body"
                  style={{ height: `${logHeight}px`, overflowY: "auto", padding: "8px 10px" }}
                >
                  {startLogs.map((line, i) => (
                    <div key={i} style={{
                      fontSize: "11px", fontFamily: "var(--font-family-mono)",
                      color: line.startsWith("✗") || line.startsWith("ERROR") ? "var(--color-danger, #f87171)"
                           : (line.startsWith("✅") || line.startsWith("✓")) ? "var(--color-success, #4ade80)"
                           : line.startsWith("⚠") ? "#facc15"
                           : "var(--color-text-muted)",
                      lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-all",
                    }}>
                      {line}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>

                {/* Drag handle */}
                <div
                  onMouseDown={(e) => { e.preventDefault(); setIsLogResizing(true); }}
                  style={{
                    height: "8px", cursor: "row-resize", flexShrink: 0,
                    background: isLogResizing ? "var(--color-accent)" : "linear-gradient(transparent,var(--color-border))",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-accent)")}
                  onMouseLeave={(e) => { if (!isLogResizing) e.currentTarget.style.background = "linear-gradient(transparent,var(--color-border))"; }}
                  title="Drag to resize"
                >
                  <div style={{ width: "32px", height: "3px", borderRadius: "2px", background: "rgba(255,255,255,0.2)" }} />
                </div>
              </div>
            )}

          </>
        )}
      </div>

      {/* TerminalModal rendered at panel root so it isn't clipped by scroll container */}
      {terminalOpen && (
        <TerminalModal onClose={() => setTerminalOpen(false)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────
// SETTINGS PANEL
// ─────────────────────────────────────
function SettingsPanel({ models, selectedModel, onSelectModel, onOpenTheme, onOpenModes, onClose }) {
  const panelRef = useRef();

  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        right: 0,
        background: "var(--color-panel)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "var(--radius-modal)",
        boxShadow: "var(--shadow-lg)",
        zIndex: 500,
        minWidth: "260px",
        maxHeight: "400px",
        overflowY: "auto",
      }}
    >
      {/* Model selector */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--color-border)" }}>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--color-text-muted)",
            marginBottom: "8px",
          }}
        >
          Model
        </div>
        {models.map((m) => (
          <div
            key={m.id}
            onClick={() => {
              onSelectModel(m);
              onClose();
            }}
            style={{
              padding: "10px 12px",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              background: selectedModel?.id === m.id ? "var(--color-accent-subtle)" : "transparent",
              borderLeft:
                selectedModel?.id === m.id ? "2px solid var(--color-accent)" : "2px solid transparent",
              borderRadius: "6px",
              marginBottom: "4px",
              transition: "background 0.1s ease",
            }}
            onMouseEnter={(e) => {
              if (selectedModel?.id !== m.id) e.currentTarget.style.background = "var(--color-surface-hover)";
            }}
            onMouseLeave={(e) => {
              if (selectedModel?.id !== m.id) e.currentTarget.style.background = "transparent";
            }}
          >
            <span
              style={{
                fontSize: "13px",
                fontWeight: 500,
                color: selectedModel?.id === m.id ? "var(--color-accent)" : "var(--color-text)",
              }}
            >
              {m.label}
            </span>
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{m.provider}</span>
          </div>
        ))}
      </div>

      {/* Theme + Modes buttons */}
      <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
        <button
          onClick={() => {
            onOpenTheme();
            onClose();
          }}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: "var(--radius-button)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "13px",
            fontFamily: "var(--font-family)",
            fontWeight: 500,
            transition: "all var(--transition-speed) var(--transition-easing)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-surface)")}
        >
          <span>🎨</span>
          <span>Themes</span>
        </button>

        <button
          onClick={() => {
            onOpenModes();
            onClose();
          }}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: "var(--radius-button)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "13px",
            fontFamily: "var(--font-family)",
            fontWeight: 500,
            transition: "all var(--transition-speed) var(--transition-easing)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-surface)")}
        >
          <span>⚡</span>
          <span>Modes</span>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────
export default function App() {
  useGlobalReset();
  const { editorOpen, setEditorOpen } = useTheme();
  const [models, setModels] = useState([]);

  const [input, setInput] = useState("");
  const [conversations, setConversations] = useState([{ id: 1, title: "New Chat", messages: [] }]);
  const [activeId, setActiveId] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inputHeight, setInputHeight] = useState(140);
  const [isResizingInput, setIsResizingInput] = useState(false);
  const [modesOpen, setModesOpen] = useState(false);
  const [runpodLoading, setRunpodLoading] = useState(false);
  const [startLogs, setStartLogs] = useState([]);
  const startTimeRef = useRef(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const startingRef  = useRef(false);  // guard against double-clicks

  const DEFAULT_RUNPOD = {
    enabled: false,
    provider: "runpod",      // "runpod" | "vast"
    apiKey: "",
    podId: "",
    endpointUrl: "",
    vastApiKey: "",
    timeoutEnabled: false,
    timeoutMinutes: "15",
    podRunning: false,
  };

  const [runpodConfig, setRunpodConfig] = useState(DEFAULT_RUNPOD);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const themeEditorRef = useRef(null);
  const abortControllerRef = useRef(null);

  const activeChat = conversations.find((c) => c.id === activeId) || conversations[0];
  const filteredConversations = searchQuery.trim()
    ? conversations.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : conversations;

  // ── Load / Save ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sf_conversations");
      const savedActive = localStorage.getItem("sf_activeId");
      if (saved) {
        const parsed = JSON.parse(saved);
        setConversations(parsed);
        if (savedActive) setActiveId(Number(savedActive));
        else if (parsed.length > 0) setActiveId(parsed[0].id);
      }
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem("sf_conversations", JSON.stringify(conversations));
    localStorage.setItem("sf_activeId", String(activeId));
  }, [conversations, activeId, loaded]);

  // ── RunPod config load / save ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sf_runpod");
      if (saved) setRunpodConfig((prev) => ({ ...prev, ...JSON.parse(saved) }));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("sf_runpod", JSON.stringify(runpodConfig));
  }, [runpodConfig]);

  // ── Elapsed timer — ticks while loading ──
  useEffect(() => {
    if (!runpodLoading) return;
    const id = setInterval(() => {
      if (startTimeRef.current)
        setElapsedSecs(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [runpodLoading]);

  // ── On mount: sync with live pod state ──
  useEffect(() => {
    const fmtUp = (secs) => {
      if (!secs) return "";
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
    };
    fetch("http://localhost:5000/runpod/config")
      .then((r) => r.json())
      .then((d) => {
        const cfg = d.config || {};
        if (!cfg.POD_ID) return;
        return fetch("http://localhost:5000/runpod/status")
          .then((r) => r.json())
          .then((s) => {
            const running = s.running === true;
            const uptime = s.pod?.runtime?.uptimeInSeconds;
            setRunpodConfig((prev) => ({
              ...prev,
              enabled: prev.enabled || running,
              podId: cfg.POD_ID || prev.podId,
              podRunning: running,
            }));
            if (running) {
              setStartLogs([
                `⚡ Pod already running  [${cfg.POD_ID}]`,
                uptime ? `⏱ Uptime: ${fmtUp(uptime)}` : "",
                cfg.SSH_HOST ? `✓  SSH  ${cfg.SSH_HOST}:${cfg.SSH_PORT}` : "",
              ].filter(Boolean));
            }
          });
      })
      .catch(() => {});
  }, []); // eslint-disable-line

  // ── RunPod auto-timeout ──
  useEffect(() => {
    if (!runpodConfig.enabled || !runpodConfig.timeoutEnabled || !runpodConfig.podRunning) return;

    const mins = parseInt(runpodConfig.timeoutMinutes, 10);
    if (!mins || mins <= 0) return;

    let timer;
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.log(`[runpod] Auto-stopping after ${mins}m inactivity`);
        handleStopPod();
      }, mins * 60 * 1000);
    };

    // Reset on user activity
    const events = ["mousemove", "keydown", "click"];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();

    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [runpodConfig.enabled, runpodConfig.timeoutEnabled, runpodConfig.podRunning, runpodConfig.timeoutMinutes]); // eslint-disable-line

  // ── Backend start/stop — provider-aware ──
  const handleStartPod = useCallback(async () => {
    if (startingRef.current || runpodLoading) return;
    startingRef.current = true;
    const provider   = runpodConfig.provider || "runpod";
    const startUrl   = provider === "vast" ? "http://localhost:5000/vastai/start"        : "http://localhost:5000/runpod/start";
    const streamBase = provider === "vast" ? "http://localhost:5000/vastai/start/stream" : "http://localhost:5000/runpod/start/stream";

    startTimeRef.current = Date.now();
    setElapsedSecs(0);
    setRunpodLoading(true);
    setStartLogs([]);
    setRunpodConfig((prev) => ({ ...prev, podRunning: false }));
    try {
      const res = await axios.post(startUrl, {
        model: selectedModel?.id || "qwen-coder",
        force_rebuild: true,
      });
      if (!res.data.success) throw new Error(res.data.error || "start failed");

      const es = new EventSource(`${streamBase}/${res.data.job_id}`);

      es.onmessage = (ev) => {
        const raw = ev.data;
        let display = raw;
        try {
          const evt = JSON.parse(raw);
          const labels = {
            spawn:                  `⚙️  Launching maestro (${provider})...`,
            start_begin:            `🎼 Starting  [model: ${evt.model || ""}]`,
            already_running:        "⚡ Instance already running — fast path",
            existing_instance:      `↩️  Found existing instance  [${evt.status || ""}]`,
            resume_attempt:         "↩️  Resuming stopped instance (disk intact)...",
            resume_ok:              "✓  Instance resumed — skipping model download",
            resume_failed:          "✗  Resume failed — trying fallback",
            search_begin:           "🔍 Searching for available GPUs...",
            offer_selected:         `✓  Selected: ${evt.gpu || ""} ${evt.vram || ""}GB @ $${evt.price || ""}/hr  ${evt.location || ""}`,
            create_attempt:         `→  ${evt.gpu || ""} · ${evt.cloud || ""} · ${evt.mode || ""}`,
            create_begin:           "🚀 Creating instance...",
            create_success:         `✓  Instance created  [${evt.pod_id || evt.instance_id || ""}]`,
            create_unavailable:     `–  Unavailable: ${evt.reason || ""}`,
            existing_volume_failed: "↘️  Existing-volume exhausted — global rebuild",
            global_rebuild_begin:   "🔨 Global rebuild: fresh volume + full setup",
            wait_ports:             "⏳ Waiting for port mappings...",
            wait_ssh:               "⏳ Waiting for SSH...",
            wait_ssh_poll:          `  ↳ ${evt.status || ""}  ${evt.host || ""}:${evt.port || ""}`,
            ssh_ready:              `✓  SSH ready  [${evt.host || ""}:${evt.port || ""}]`,
            setup_begin:            "📦 Running setup (vLLM + model download)...",
            setup_done:             "✓  Setup complete",
            stack_begin:            "🚀 Starting vLLM...",
            wait_vllm_begin:        "⏳ Waiting for vLLM (model download + warmup)...",
            vllm_ready:             `✅ vLLM ready  (${evt.elapsed_s || "?"}s)`,
            stack_ready:            "✅ vLLM ready — start coding!",
            stack_failed:           "✗  vLLM start failed",
            stop_done:              "■  Instance stopped",
            terminate_done:         "🗑  Instance terminated",
            error:                  `✗  Error: ${evt.message || ""}`,
            done:                   evt.returncode === 0
                                      ? `✓  Done  (${evt.duration_s}s)`
                                      : `✗  Failed  [exit ${evt.returncode}]`,
          };
          display = labels[evt.event] ?? raw;

          if (["stack_ready", "already_running", "vllm_ready"].includes(evt.event)) {
            const secs = startTimeRef.current
              ? Math.floor((Date.now() - startTimeRef.current) / 1000) : null;
            const timeStr = secs === null ? "" : secs >= 60
              ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
            if (timeStr) setStartLogs((prev) => [...prev, `⏱  Ready in ${timeStr}`]);
            setRunpodConfig((prev) => ({ ...prev, podRunning: true }));
          }
          if (evt.event === "done") {
            es.close();
            setRunpodLoading(false);
            startingRef.current = false;
            if (evt.returncode !== 0)
              setRunpodConfig((prev) => ({ ...prev, podRunning: false }));
          }
        } catch { /* plain text line */ }

        setStartLogs((prev) => [...prev.slice(-300), display]);
      };

      es.onerror = () => { es.close(); setRunpodLoading(false); startingRef.current = false; };
    } catch (err) {
      setStartLogs((prev) => [...prev, `✗ ${err.message}`]);
      setRunpodLoading(false);
      startingRef.current = false;
    }
  }, [selectedModel, runpodConfig.provider, runpodLoading]);

  const handleStopPod = useCallback(async () => {
    const provider = runpodConfig.provider || "runpod";
    const stopUrl  = provider === "vast" ? "http://localhost:5000/vastai/stop" : "http://localhost:5000/runpod/stop";
    setRunpodLoading(true);
    try {
      await axios.post(stopUrl);
      setRunpodConfig((prev) => ({ ...prev, podRunning: false }));
      setStartLogs((prev) => [...prev, `■  ${provider === "vast" ? "Vast.ai instance" : "Pod"} stopped`]);
    } catch (err) {
      console.error("[backend] Stop failed:", err.message);
    } finally {
      setRunpodLoading(false);
    }
  }, [runpodConfig.provider]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages]);

  useEffect(() => {
    const handleMove = (e) => {
      if (!isResizing) return;
      setSidebarWidth(Math.max(200, Math.min(420, e.clientX)));
    };
    const stopResize = () => setIsResizing(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", stopResize);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", stopResize);
    };
  }, [isResizing]);

  // ── Resize input panel (vertical drag) ──
  useEffect(() => {
    const handleMove = (e) => {
      if (!isResizingInput) return;
      const vh = window.innerHeight;
      const fromBottom = vh - e.clientY;
      setInputHeight(Math.max(100, Math.min(vh * 0.3, fromBottom)));
    };
    const stopResize = () => setIsResizingInput(false);
    if (isResizingInput) {
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", stopResize);
      return () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", stopResize);
      };
    }
  }, [isResizingInput]);

  // ── Close theme editor on outside click ──
  useEffect(() => {
    const handler = (e) => {
      if (themeEditorRef.current && !themeEditorRef.current.contains(e.target)) {
        setEditorOpen(false);
      }
    };
    if (editorOpen) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [editorOpen, setEditorOpen]);

  // ── Fetch models ──
  useEffect(() => {
    fetch("http://localhost:5000/models")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setModels(data);
          setSelectedModel(data[0]);
        }
      })
      .catch(() => {
        const fallback = [{ id: "gemma:2b", label: "gemma:2b", provider: "Ollama" }];
        setModels(fallback);
        setSelectedModel(fallback[0]);
      });
  }, []);

  // ─────────────────────────────────────
  // SEND MESSAGE
  // ─────────────────────────────────────
  const send = useCallback(
    async (overrideInput) => {
      const text = (overrideInput || input).trim();
      if (!text || isStreaming) return;

      const userMsg = { role: "user", content: text };
      const thinkingMsg = { role: "assistant", content: "", thinking: true, model: selectedModel?.label };

      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== activeId) return conv;
          return {
            ...conv,
            title: conv.messages.length === 0 ? text.slice(0, 35).replace(/\n/g, " ") : conv.title,
            messages: [...conv.messages, userMsg, thinkingMsg],
          };
        })
      );

      setInput("");
      setIsStreaming(true);

      // Create abort controller
      abortControllerRef.current = new AbortController();

      try {
        const res = await axios.post(
          "http://localhost:5000/chat",
          { prompt: text, model: selectedModel?.id },
          { timeout: 300000, signal: abortControllerRef.current.signal }
        );

        const botMsg = {
          role: "assistant",
          content: res.data.response,
          model: selectedModel?.label,
          timestamp: Date.now(),
        };

        setConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== activeId) return conv;
            const msgs = conv.messages.slice(0, -1);
            return { ...conv, messages: [...msgs, botMsg] };
          })
        );
      } catch (err) {
        if (axios.isCancel(err) || err.name === "CanceledError") {
          // User stopped generation
          setConversations((prev) =>
            prev.map((conv) => {
              if (conv.id !== activeId) return conv;
              return { ...conv, messages: conv.messages.slice(0, -1) };
            })
          );
        } else {
          const errMsg = {
            role: "assistant",
            content: `⚠️ **Error connecting to backend**\n\n\`\`\`\n${err.message}\n\`\`\`\n\nMake sure your local server is running at \`http://localhost:5000\`.`,
            model: selectedModel?.label,
          };
          setConversations((prev) =>
            prev.map((conv) => {
              if (conv.id !== activeId) return conv;
              return { ...conv, messages: [...conv.messages.slice(0, -1), errMsg] };
            })
          );
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [input, isStreaming, activeId, selectedModel]
  );

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const regenerate = useCallback(() => {
    const msgs = activeChat?.messages || [];
    const lastUserIdx = msgs.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0).pop();
    if (lastUserIdx === undefined) return;

    const lastUserMsg = msgs[lastUserIdx];

    // Remove assistant response
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== activeId) return conv;
        return { ...conv, messages: conv.messages.slice(0, lastUserIdx + 1) };
      })
    );

    // Re-send
    setTimeout(() => send(lastUserMsg.content), 100);
  }, [activeChat, activeId, send]);

  const newChat = () => {
    const id = Date.now();
    setConversations((prev) => [{ id, title: "New Chat", messages: [] }, ...prev]);
    setActiveId(id);
  };

  const deleteChat = (id) => {
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      if (id === activeId && filtered.length > 0) setActiveId(filtered[0].id);
      return filtered.length > 0 ? filtered : [{ id: Date.now(), title: "New Chat", messages: [] }];
    });
  };

  const renameChat = (id, title) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  };

  if (!selectedModel)
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "var(--color-bg)",
          color: "var(--color-text)",
          fontFamily: "var(--font-family)",
        }}
      >
        Connecting to backend...
      </div>
    );

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-family)",
        fontSize: "var(--font-size-base)",
        lineHeight: "var(--line-height)",
        overflow: "hidden",
        cursor: isResizing ? "col-resize" : isResizingInput ? "row-resize" : "default",
        userSelect: isResizing || isResizingInput ? "none" : "auto",
      }}
    >
      {/* SIDEBAR */}
      <div
        style={{
          width: sidebarOpen ? `${sidebarWidth}px` : "56px",
          flexShrink: 0,
          background: "var(--color-sidebar)",
          borderRight: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          transition: isResizing ? "none" : "width 0.2s ease",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px var(--spacing-sidebar)",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              fontSize: "18px",
              padding: "2px",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
            }}
          >
            ☰
          </button>
          {sidebarOpen && (
            <span
              style={{
                fontWeight: 700,
                fontFamily: "var(--font-family-display)",
                fontSize: "15px",
                color: "var(--color-text)",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              SupaFantastic
            </span>
          )}
        </div>

        <div style={{ padding: "10px var(--spacing-sidebar)", flexShrink: 0 }}>
          <button
            onClick={newChat}
            style={{
              width: "100%",
              padding: sidebarOpen ? "9px 14px" : "9px",
              borderRadius: "var(--radius-button)",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              color: "var(--color-text)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: sidebarOpen ? "flex-start" : "center",
              gap: "8px",
              fontSize: "var(--font-size-base)",
              fontFamily: "var(--font-family)",
              fontWeight: 500,
              transition: "all var(--transition-speed) var(--transition-easing)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-surface)")}
          >
            <span style={{ fontSize: "16px" }}>✦</span>
            {sidebarOpen && <span>New Chat</span>}
          </button>
        </div>

        {sidebarOpen && (
          <div style={{ padding: "0 var(--spacing-sidebar) 8px", flexShrink: 0 }}>
            <input
              type="text"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                background: "var(--color-input-bg)",
                border: "1px solid var(--color-input-border)",
                borderRadius: "var(--radius-input)",
                padding: "7px 10px",
                color: "var(--color-text)",
                fontFamily: "var(--font-family)",
                fontSize: "12px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "4px var(--spacing-sidebar)",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          {sidebarOpen ? (
            <>
              {filteredConversations.length === 0 && (
                <div style={{ fontSize: "12px", color: "var(--color-text-subtle)", padding: "12px 4px" }}>
                  No chats found
                </div>
              )}
              {filteredConversations.map((c) => (
                <SidebarItem
                  key={c.id}
                  conv={c}
                  isActive={c.id === activeId}
                  onClick={setActiveId}
                  onRename={renameChat}
                  onDelete={deleteChat}
                />
              ))}
            </>
          ) : (
            conversations.slice(0, 8).map((c) => (
              <div
                key={c.id}
                onClick={() => setActiveId(c.id)}
                title={c.title}
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "var(--radius-sidebar-item)",
                  background: c.id === activeId ? "var(--color-accent-subtle)" : "transparent",
                  border: `1px solid ${c.id === activeId ? "var(--color-accent)" : "transparent"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  fontSize: "14px",
                  margin: "0 auto",
                }}
              >
                💬
              </div>
            ))
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={() => setIsResizing(true)}
        style={{
          width: "4px",
          background: isResizing ? "var(--color-accent)" : "transparent",
          cursor: "col-resize",
          flexShrink: 0,
          transition: "background 0.15s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-border-strong)")}
        onMouseLeave={(e) => {
          if (!isResizing) e.currentTarget.style.background = "transparent";
        }}
      />

      {/* MAIN CHAT */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
        {/* HEADER */}
        <div
          style={{
            padding: "12px 20px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            background: "var(--color-bg)",
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: "16px",
              fontFamily: "var(--font-family-display)",
              color: "var(--color-text)",
            }}
          >
            SupaFantastic
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <RunpodPill
              config={runpodConfig}
              onStart={handleStartPod}
              onStop={handleStopPod}
              loading={runpodLoading}
            />

            <div style={{ position: "relative" }}>
              <button
                onClick={() => setSettingsOpen(!settingsOpen)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-button)",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  padding: "6px 10px",
                  fontSize: "13px",
                }}
                title="Settings"
              >
                ⚙️ Settings
              </button>

              {settingsOpen && (
                <SettingsPanel
                  models={models}
                  selectedModel={selectedModel}
                  onSelectModel={setSelectedModel}
                  onOpenTheme={() => setEditorOpen(true)}
                  onOpenModes={() => setModesOpen(true)}
                  onClose={() => setSettingsOpen(false)}
                />
              )}
            </div>
          </div>
        </div>

        {/* MESSAGES */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "var(--spacing-message)",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            scrollbarWidth: "thin",
            scrollbarColor: "var(--color-scrollbar) transparent",
          }}
        >
          {!activeChat?.messages?.length ? (
            <EmptyState onSend={send} />
          ) : (
            <>
              {activeChat.messages.map((msg, i) => (
                <MessageBubble
                  key={i}
                  msg={msg}
                  isLast={i === activeChat.messages.length - 1}
                  onRegenerate={regenerate}
                />
              ))}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* DRAG HANDLE */}
        <div
          onMouseDown={() => setIsResizingInput(true)}
          style={{
            height: "4px",
            background: isResizingInput ? "var(--color-accent)" : "transparent",
            cursor: "row-resize",
            flexShrink: 0,
            borderTop: "1px solid var(--color-border)",
            transition: isResizingInput ? "none" : "background 0.15s ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-border-strong)")}
          onMouseLeave={(e) => { if (!isResizingInput) e.currentTarget.style.background = "transparent"; }}
        />

        {/* INPUT */}
        <div
          style={{
            padding: "12px 20px 16px",
            flexShrink: 0,
            background: "var(--color-bg)",
            height: `${inputHeight}px`,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              background: "var(--color-input-bg)",
              border: "1px solid var(--color-input-border)",
              borderRadius: "var(--radius-input)",
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              transition: "border-color var(--transition-speed)",
            }}
            onFocusCapture={(e) => (e.currentTarget.style.borderColor = "var(--color-input-focus-border)")}
            onBlurCapture={(e) => (e.currentTarget.style.borderColor = "var(--color-input-border)")}
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message SupaFantastic..."
              disabled={isStreaming}
              style={{
                flex: 1,
                resize: "none",
                background: "transparent",
                color: "var(--color-text)",
                border: "none",
                outline: "none",
                padding: "12px 14px 4px",
                fontFamily: "var(--font-family)",
                fontSize: "var(--font-size-base)",
                lineHeight: "var(--line-height)",
                minHeight: 0,
                overflowY: "auto",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 10px 10px",
              }}
            >
              <span style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>
                {input.length > 0 ? `${input.length} chars` : ""}
              </span>

              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {isStreaming && (
                  <>
                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>⟳ Generating...</span>
                    <button
                      onClick={stopGeneration}
                      style={{
                        padding: "5px 12px",
                        borderRadius: "var(--radius-button)",
                        border: "1px solid var(--color-border)",
                        background: "var(--color-accent-subtle)",
                        color: "var(--color-accent)",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontFamily: "var(--font-family)",
                        fontSize: "12px",
                      }}
                    >
                      ⬛ Stop
                    </button>
                  </>
                )}
                <button
                  onClick={() => send()}
                  disabled={!input.trim() || isStreaming}
                  style={{
                    padding: "7px 16px",
                    borderRadius: "var(--radius-button)",
                    border: "none",
                    background: input.trim() && !isStreaming ? "var(--color-accent)" : "var(--color-surface)",
                    color:
                      input.trim() && !isStreaming ? "var(--color-accent-fg)" : "var(--color-text-subtle)",
                    cursor: input.trim() && !isStreaming ? "pointer" : "default",
                    fontWeight: 600,
                    fontFamily: "var(--font-family)",
                    fontSize: "13px",
                    transition: "all var(--transition-speed) var(--transition-easing)",
                  }}
                >
                  Send ↑
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* THEME EDITOR */}
      {editorOpen && (
        <div ref={themeEditorRef}>
          <ThemeEditor onClose={() => setEditorOpen(false)} />
        </div>
      )}

      {/* MODES PANEL */}
      {modesOpen && (
        <ModesPanel
          config={runpodConfig}
          onChange={setRunpodConfig}
          onClose={() => setModesOpen(false)}
          onStart={handleStartPod}
          onStop={handleStopPod}
          loading={runpodLoading}
          startLogs={startLogs}
          models={models}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          elapsedSecs={elapsedSecs}
        />
      )}
    </div>
  );
}