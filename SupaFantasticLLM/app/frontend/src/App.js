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

// ─────────────────────────────────────
// INLINE SSH TERMINAL
// ─────────────────────────────────────

// ─────────────────────────────────────
// INLINE SSH TERMINAL
// ─────────────────────────────────────
function InlineSSHTerminal() {
  const containerRef = useRef(null);
  const termRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let term, ws;

    const init = () => {
      const el = containerRef.current;
      if (!el) return;

      Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-attach"),
        import("@xterm/xterm/css/xterm.css"),
      ]).then(([{ Terminal }, { AttachAddon }]) => {
        const charW = 7.8;
        const charH = 17;
        const cols  = Math.max(40, Math.floor((el.clientWidth  - 20) / charW));
        const rows  = Math.max(10, Math.floor((el.clientHeight - 10) / charH));

        term = new Terminal({
          cursorBlink: true, fontSize: 13,
          fontFamily: "'Fira Code','Cascadia Code','Courier New',monospace",
          cols, rows,
          scrollback: 5000,
          wordWrap: false,   // terminal wraps at cols boundary naturally
          theme: {
            background: "#0d1117", foreground: "#e6edf3", cursor: "#58a6ff",
            black: "#0d1117", red: "#ff7b72", green: "#3fb950",
            yellow: "#d29922", blue: "#58a6ff", magenta: "#bc8cff",
            cyan: "#39c5cf", white: "#b1bac4",
          },
        });

        term.open(el);
        term.write("\r\n  " + String.fromCharCode(27) + "[36mConnecting to pod SSH..." + String.fromCharCode(27) + "[0m\r\n\r\n");

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(`${proto}//localhost:5000/ssh/terminal`);
        ws.binaryType = "arraybuffer";
        ws.onopen  = () => { term.loadAddon(new AttachAddon(ws)); };
        ws.onerror = () => term.write("\r\n  " + String.fromCharCode(27) + "[31m[connection error]" + String.fromCharCode(27) + "[0m\r\n");
        ws.onclose = () => term.write("\r\n  " + String.fromCharCode(27) + "[33m[disconnected]" + String.fromCharCode(27) + "[0m\r\n");
        termRef.current = { term, ws };

        // Resize terminal when container size changes
        const ro = new ResizeObserver(() => {
          if (!termRef.current?.term || !el) return;
          const newCols = Math.max(40, Math.floor((el.clientWidth  - 20) / charW));
          const newRows = Math.max(10, Math.floor((el.clientHeight - 10) / charH));
          try { termRef.current.term.resize(newCols, newRows); } catch {}
        });
        ro.observe(el);
        termRef.current.ro = ro;

      }).catch(e => console.error("xterm load failed:", e));
    };

    // Defer slightly so container has real dimensions
    const t = setTimeout(init, 50);

    return () => {
      clearTimeout(t);
      try { termRef.current?.ro?.disconnect(); } catch {}
      try { termRef.current?.ws?.close(); } catch {}
      try { termRef.current?.term?.dispose(); } catch {}
    };
  }, []);

  return <div ref={containerRef} style={{ flex: 1, background: "#0d1117", overflow: "hidden", minHeight: 0 }} />;
}



// ─────────────────────────────────────
// SCAN RESULTS MODAL
// ─────────────────────────────────────
function ScanModal({ data, onClose }) {
  const vast   = data?.vast   || [];
  const runpod = data?.runpod || [];

  const fmtDist = km => {
    if (!km || km >= 99000) return "?";
    if (km < 1000) return `${km} km`;
    return `${(km/1000).toFixed(1)}k km`;
  };
  const fmtGpu = s => s.replace("NVIDIA ","").replace("GeForce ","").replace("RTX_","RTX ").replace(/_/g," ");

  // Best picks
  const cheapestVast   = [...vast].sort((a,b) => a.min_price - b.min_price)[0];
  const closestVast    = vast[0]; // already sorted by dist
  const cheapestRunpod = runpod[0]; // already sorted by price

  const Section = ({label}) => (
    <div style={{fontSize:"10px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",
      color:"var(--color-text-muted)",padding:"10px 20px 4px",borderTop:"1px solid var(--color-border)"}}>
      {label}
    </div>
  );

  return (
    <div onClick={e => e.target===e.currentTarget && onClose()} style={{
      position:"fixed",inset:0,zIndex:3000,background:"rgba(0,0,0,0.7)",
      display:"flex",alignItems:"center",justifyContent:"center",
    }}>
      <div style={{
        background:"var(--color-panel)",borderRadius:"10px",
        border:"1px solid var(--color-border)",boxShadow:"0 24px 80px rgba(0,0,0,0.8)",
        width:"min(640px,95vw)",maxHeight:"85vh",display:"flex",flexDirection:"column",
        overflow:"hidden",
      }}>
        {/* Header */}
        <div style={{padding:"14px 20px",borderBottom:"1px solid var(--color-border)",
          display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontWeight:700,fontSize:"15px",color:"var(--color-text)"}}>🔍 Host Scan Results</div>
            {data?.user_location && (
              <div style={{fontSize:"11px",color:"var(--color-text-muted)",marginTop:"2px"}}>
                📍 {data.user_location}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{background:"transparent",border:"none",
            cursor:"pointer",color:"var(--color-text-muted)",fontSize:"20px",padding:"4px"}}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{overflowY:"auto",flex:1}}>

          {/* Best picks */}
          {(cheapestVast || cheapestRunpod) && (
            <>
              <Section label="⭐ Best Options" />
              <div style={{padding:"6px 20px 10px",display:"flex",flexDirection:"column",gap:"6px"}}>
                {closestVast && (
                  <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 12px",
                    borderRadius:"6px",background:"rgba(74,222,128,0.07)",border:"1px solid rgba(74,222,128,0.2)"}}>
                    <span style={{fontSize:"18px"}}>📍</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:"12px",fontWeight:600,color:"var(--color-text)"}}>
                        Closest — Vast.ai {closestVast.country}  ·  {fmtDist(closestVast.dist_km)} away
                      </div>
                      <div style={{fontSize:"11px",color:"var(--color-text-muted)"}}>
                        {closestVast.count} offers · from <b style={{color:"var(--color-accent)"}}>${closestVast.min_price}/hr</b>
                        {closestVast.top_gpus?.[0] && ` · ${fmtGpu(closestVast.top_gpus[0].gpu)}`}
                      </div>
                    </div>
                  </div>
                )}
                {cheapestVast && cheapestVast.country !== closestVast?.country && (
                  <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 12px",
                    borderRadius:"6px",background:"rgba(88,166,255,0.07)",border:"1px solid rgba(88,166,255,0.2)"}}>
                    <span style={{fontSize:"18px"}}>💰</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:"12px",fontWeight:600,color:"var(--color-text)"}}>
                        Cheapest — Vast.ai {cheapestVast.country}  ·  {fmtDist(cheapestVast.dist_km)} away
                      </div>
                      <div style={{fontSize:"11px",color:"var(--color-text-muted)"}}>
                        {cheapestVast.count} offers · from <b style={{color:"var(--color-accent)"}}>${cheapestVast.min_price}/hr</b>
                        {cheapestVast.top_gpus?.[0] && ` · ${fmtGpu(cheapestVast.top_gpus[0].gpu)}`}
                      </div>
                    </div>
                  </div>
                )}
                {cheapestRunpod && (
                  <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 12px",
                    borderRadius:"6px",background:"rgba(251,191,36,0.07)",border:"1px solid rgba(251,191,36,0.2)"}}>
                    <span style={{fontSize:"18px"}}>⚡</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:"12px",fontWeight:600,color:"var(--color-text)"}}>
                        RunPod — {fmtGpu(cheapestRunpod.gpu)}  ·  {cheapestRunpod.vram}GB VRAM
                      </div>
                      <div style={{fontSize:"11px",color:"var(--color-text-muted)"}}>
                        ×{cheapestRunpod.count} available globally · <b style={{color:"var(--color-accent)"}}>${cheapestRunpod.price}/hr</b>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* RunPod table */}
          {runpod.length > 0 && (
            <>
              <Section label={`⚡ RunPod Community Cloud — ${runpod.length} GPU types available`} />
              <div style={{padding:"4px 20px 10px"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px"}}>
                  <thead>
                    <tr style={{color:"var(--color-text-muted)",fontSize:"10px",textTransform:"uppercase"}}>
                      <th style={{textAlign:"left",padding:"4px 8px",fontWeight:600}}>GPU</th>
                      <th style={{textAlign:"right",padding:"4px 8px",fontWeight:600}}>VRAM</th>
                      <th style={{textAlign:"right",padding:"4px 8px",fontWeight:600}}>Available</th>
                      <th style={{textAlign:"right",padding:"4px 8px",fontWeight:600}}>Price/hr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runpod.map((g,i) => (
                      <tr key={i} style={{borderTop:"1px solid var(--color-border)",
                        background: i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
                        <td style={{padding:"6px 8px",color:"var(--color-text)",fontFamily:"var(--font-family-mono)",fontSize:"11px"}}>
                          {fmtGpu(g.gpu)}
                        </td>
                        <td style={{padding:"6px 8px",textAlign:"right",color:"var(--color-text-muted)"}}>
                          {g.vram}GB
                        </td>
                        <td style={{padding:"6px 8px",textAlign:"right",color:"var(--color-success,#4ade80)",fontWeight:700}}>
                          ×{g.count}
                        </td>
                        <td style={{padding:"6px 8px",textAlign:"right",color:"var(--color-accent)",fontWeight:600}}>
                          ${g.price}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {runpod.length === 0 && !data?.runpod_error && (
            <>
              <Section label="⚡ RunPod" />
              <div style={{padding:"8px 20px 10px",fontSize:"12px",color:"var(--color-text-muted)"}}>
                No community cloud GPUs available right now. Try again later.
              </div>
            </>
          )}

          {/* Vast.ai by location */}
          {vast.length > 0 && (
            <>
              <Section label={`🌐 Vast.ai — ${vast.reduce((s,l)=>s+l.count,0)} offers across ${vast.length} countries`} />
              <div style={{padding:"4px 20px 12px",display:"flex",flexDirection:"column",gap:"4px"}}>
                {vast.map((loc,i) => {
                  const distColor = loc.dist_km < 2000 ? "var(--color-success,#4ade80)"
                                  : loc.dist_km < 8000 ? "#facc15" : "#f87171";
                  return (
                    <div key={i} style={{padding:"7px 10px",borderRadius:"6px",
                      border:"1px solid var(--color-border)",
                      background: i===0 ? "rgba(74,222,128,0.04)" : "transparent"}}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                        <span style={{width:"8px",height:"8px",borderRadius:"50%",
                          background:distColor,flexShrink:0,
                          boxShadow:`0 0 6px ${distColor}`}} />
                        <span style={{fontWeight:700,fontSize:"13px",color:"var(--color-text)",minWidth:"32px"}}>
                          {loc.country}
                        </span>
                        <span style={{fontSize:"11px",color:"var(--color-success,#4ade80)",fontWeight:600}}>
                          ×{loc.count} offers
                        </span>
                        <span style={{flex:1}}/>
                        <span style={{fontSize:"11px",color:"var(--color-text-muted)"}}>
                          {fmtDist(loc.dist_km)}
                        </span>
                        <span style={{fontSize:"12px",color:"var(--color-accent)",fontWeight:600}}>
                          from ${loc.min_price}/hr
                        </span>
                      </div>
                      <div style={{marginTop:"3px",marginLeft:"16px",fontSize:"10px",
                        color:"var(--color-text-muted)",fontFamily:"var(--font-family-mono)"}}>
                        {loc.top_gpus.map(g=>`${fmtGpu(g.gpu)} ×${g.count}`).join("  ·  ")}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Errors */}
          {(data?.runpod_error || data?.vast_error) && (
            <>
              <Section label="⚠ Errors" />
              <div style={{padding:"6px 20px 12px",fontSize:"11px",color:"#f87171",fontFamily:"var(--font-family-mono)"}}>
                {data.runpod_error && <div>RunPod: {data.runpod_error}</div>}
                {data.vast_error   && <div>Vast.ai: {data.vast_error}</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────
// HOST SCANNER (button only)
// ─────────────────────────────────────
function HostScanner() {
  const [state,    setState]   = useState("idle");
  const [data,     setData]    = useState(null);
  const [showModal,setShowModal] = useState(false);

  const scan = () => {
    setState("scanning");
    fetch("http://localhost:5000/scout/hosts")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { setData(d); setState("done"); setShowModal(true); })
      .catch(e => { console.error("Scout error:", e); setState("error"); });
  };

  return (
    <>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"4px"}}>
        <div style={{fontSize:"11px",fontWeight:600,textTransform:"uppercase",
          letterSpacing:"0.08em",color:"var(--color-text-muted)"}}>
          Scan Hosts
        </div>
        <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
          {state === "done" && (
            <button onClick={() => setShowModal(true)} style={{
              padding:"3px 8px",borderRadius:"4px",fontSize:"10px",
              border:"1px solid var(--color-border)",background:"transparent",
              color:"var(--color-text-muted)",cursor:"pointer",fontFamily:"var(--font-family)",
            }}>View Results</button>
          )}
          <button onClick={scan} disabled={state==="scanning"} style={{
            padding:"3px 10px",borderRadius:"5px",fontSize:"11px",fontWeight:600,
            border:"1px solid var(--color-border)",background:"var(--color-surface)",
            color:state==="scanning" ? "var(--color-text-muted)" : "var(--color-text)",
            cursor:state==="scanning" ? "wait" : "pointer",fontFamily:"var(--font-family)",
          }}>
            {state==="scanning" ? "Scanning…" : state==="done" ? "↺ Rescan" : "⟳ Scan"}
          </button>
        </div>
      </div>
      {state === "error" && (
        <div style={{fontSize:"10px",color:"var(--color-danger,#f87171)",marginBottom:"4px"}}>
          Scan failed — check Flask logs and API keys in supa_config.env
        </div>
      )}
      {showModal && data && <ScanModal data={data} onClose={() => setShowModal(false)} />}
    </>
  );
}

// ─────────────────────────────────────
// BILLING OVERVIEW
// ─────────────────────────────────────
function BillingOverview({ onStop }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("http://localhost:5000/billing/overview")
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const fmtUptime = s => {
    if (!s) return "—";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const stop = (provider, id) => {
    const url = provider === "vast"
      ? `http://localhost:5000/vastai/terminate`
      : `http://localhost:5000/runpod/terminate`;
    fetch(url, { method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ instance_id: id, pod_id: id }) })
      .then(() => setTimeout(load, 1000));
  };

  const vast   = data?.vast   || [];
  const runpod = data?.runpod || [];
  const all    = [...vast.map(i => ({...i, provider:"vast"})),
                  ...runpod.map(i => ({...i, provider:"runpod"}))];

  if (loading) return (
    <div style={{ padding: "8px 0", fontSize: "11px", color: "var(--color-text-muted)" }}>
      Checking running instances...
    </div>
  );

  if (all.length === 0) return null;

  const totalCost = all.reduce((s, i) => s + (i.cost || 0), 0);

  return (
    <div style={{
      marginBottom: "12px", borderRadius: "6px", overflow: "hidden",
      border: "1px solid var(--color-border)",
    }}>
      <div style={{
        padding: "6px 10px", background: "var(--color-surface)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          💸 Running Instances
        </span>
        <span style={{ fontSize: "11px", color: totalCost > 0.5 ? "#f87171" : "var(--color-text-muted)" }}>
          ${totalCost.toFixed(3)} so far · ${all.reduce((s,i) => s+(i.price||0),0).toFixed(3)}/hr
        </span>
      </div>
      {all.map(inst => (
        <div key={`${inst.provider}-${inst.id}`} style={{
          padding: "6px 10px", borderTop: "1px solid var(--color-border)",
          display: "flex", alignItems: "center", gap: "8px",
          background: inst.status === "running" ? "transparent" : "rgba(248,113,113,0.05)",
        }}>
          <span style={{ fontSize: "10px", opacity: 0.6 }}>
            {inst.provider === "vast" ? "🌐" : "⚡"}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "11px", color: "var(--color-text)", fontFamily: "var(--font-family-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {inst.gpu || inst.name || inst.id}
              <span style={{ marginLeft: "6px", opacity: 0.5 }}>#{String(inst.id).slice(-6)}</span>
            </div>
            <div style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>
              {inst.status} · {fmtUptime(inst.uptime_s)} · ${inst.price}/hr · spent ${inst.cost?.toFixed(3)}
            </div>
          </div>
          <button
            onClick={() => stop(inst.provider, inst.id)}
            style={{
              padding: "2px 7px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
              border: "1px solid var(--color-danger,#f87171)", background: "transparent",
              color: "var(--color-danger,#f87171)", cursor: "pointer", flexShrink: 0,
              fontFamily: "var(--font-family)",
            }}
          >
            Kill
          </button>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────
// MODES PANEL
// ─────────────────────────────────────
function ModesPanel({ isOpen, config, onChange, onClose, onStart, onStop, loading, startLogs, models, selectedModel, onSelectModel, elapsedSecs }) {
  const panelRef        = useRef();
  const logContainerRef = useRef();
  const [podInfo, setPodInfo]             = useState(null);
  const [panelWidth, setPanelWidth]       = useState(340);
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  const [providerOpen, setProviderOpen]   = useState(true);
  const [settingsOpen, setSettingsOpen]   = useState(true);
  const [activeTab, setActiveTab]         = useState("log");
  const [termView, setTermView]           = useState(false); // false=config, true=terminal fullscreen

  // Auto-collapse config when running
  useEffect(() => {
    if (loading) { setSettingsOpen(false); setProviderOpen(false); }
    if (!loading && !config.podRunning) { setSettingsOpen(true); setProviderOpen(true); }
  }, [loading, config.podRunning]);

  // Auto-switch to terminal view when job starts
  useEffect(() => {
    if (loading) setTermView(true);
  }, [loading]);

  // Panel resize
  useEffect(() => {
    const move = e => { if (!isPanelResizing) return; setPanelWidth(Math.max(300, Math.min(900, window.innerWidth - e.clientX))); };
    const up   = () => setIsPanelResizing(false);
    if (isPanelResizing) {
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    }
  }, [isPanelResizing]);

  // Config polling
  useEffect(() => {
    const poll = () => fetch("http://localhost:5000/runpod/config").then(r => r.json()).then(d => setPodInfo(d.config || null)).catch(() => {});
    poll(); const id = setInterval(poll, 8000); return () => clearInterval(id);
  }, []);

  // Outside click — collapse when clicking outside in config view
  useEffect(() => {
    const handler = e => {
      if (!isOpen) return;
      if (!termView && panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, termView, isOpen]);

  // Auto-scroll log — only when user is at/near the bottom
  useEffect(() => {
    const el = logContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [startLogs]);

  const set = (key, val) => onChange({ ...config, [key]: val });
  const isRunning = config.podRunning;
  const providerLabel = config.provider === "vast" ? "Vast.ai" : "RunPod";
  const sshHost = podInfo?.VAST_SSH_HOST || podInfo?.SSH_HOST || "";

  const podModels = models?.length ? models : [
    { id: "qwen-coder",  label: "Qwen2.5-Coder-32B (AWQ)" },
    { id: "deepseek-r1", label: "DeepSeek-R1-Distill-Qwen-32B (AWQ)" },
  ];

  // ── shared sub-components ─────────────────────────────────────
  const Toggle = ({ label, checked, onChange: onT }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
      <span style={{ fontSize: "13px", color: "var(--color-text)", fontWeight: 500 }}>{label}</span>
      <button onClick={() => onT(!checked)} style={{
        width: "40px", height: "22px", borderRadius: "11px", border: "none",
        background: checked ? "var(--color-accent)" : "var(--color-surface)",
        cursor: "pointer", position: "relative", transition: "background 0.2s",
        boxShadow: "inset 0 1px 3px rgba(0,0,0,0.3)",
      }}>
        <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: "#fff",
          position: "absolute", top: "3px", left: checked ? "20px" : "4px",
          transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
      </button>
    </div>
  );

  const CollapsibleHeader = ({ label, open, onToggle }) => (
    <div onClick={onToggle} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      cursor: "pointer", padding: "4px 0", marginBottom: open ? "6px" : "2px", userSelect: "none",
    }}>
      <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)" }}>{label}</div>
      <div style={{ fontSize: "10px", color: "var(--color-text-muted)", opacity: 0.6, transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s" }}>▾</div>
    </div>
  );

  const StatusDot = ({ style: s = {} }) => (
    <div style={{
      width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0,
      background: loading ? "var(--color-accent)" : isRunning ? "var(--color-success,#4ade80)" : "var(--color-text-subtle)",
      boxShadow: isRunning && !loading ? "0 0 6px var(--color-success,#4ade80)" : "none",
      transition: "all 0.4s", ...s,
    }} />
  );

  const StartStopBtn = ({ compact = false }) => (
    <button
      onClick={isRunning ? onStop : onStart}
      disabled={loading}
      style={{
        padding: compact ? "5px 12px" : "11px",
        width: compact ? "auto" : "100%",
        borderRadius: "var(--radius-button)",
        cursor: loading ? "wait" : "pointer",
        fontWeight: 700, fontSize: compact ? "11px" : "13px",
        fontFamily: "var(--font-family)", transition: "all 0.15s",
        background: loading ? "var(--color-surface)" : isRunning ? "transparent" : "var(--color-accent)",
        color: loading ? "var(--color-text-muted)" : isRunning ? "var(--color-text-muted)" : "#fff",
        border: isRunning ? "1px solid var(--color-border)" : "none",
        whiteSpace: "nowrap",
      }}
    >
      {loading
        ? `${elapsedSecs >= 60 ? `${Math.floor(elapsedSecs/60)}m ${elapsedSecs%60}s` : `${elapsedSecs}s`}`
        : isRunning ? "■ Stop" : "▶ Start"}
    </button>
  );

  // Terminal-view toggle button (pill icon)
  const TermViewToggle = () => (
    <button
      onClick={() => setTermView(v => !v)}
      title={termView ? "Back to config" : "Open log / SSH terminal"}
      style={{
        padding: "3px 8px", borderRadius: "5px", border: "1px solid var(--color-border)",
        background: termView ? "var(--color-accent-subtle)" : "var(--color-surface)",
        color: termView ? "var(--color-accent)" : "var(--color-text-muted)",
        cursor: "pointer", fontSize: "13px", lineHeight: 1,
        fontFamily: "var(--font-family)", transition: "all 0.15s",
      }}
    >
      {termView ? "◀" : "📋"}
    </button>
  );

  // ── Tab content (shared between views) ────────────────────────
  const TabContent = () => (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Tab bar */}
      <div style={{
        display: "flex", alignItems: "center", flexShrink: 0,
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-surface)",
      }}>
        {["log", "ssh"].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: "7px 14px", fontSize: "11px",
            fontWeight: activeTab === tab ? 700 : 500,
            color: activeTab === tab ? "var(--color-accent)" : "var(--color-text-muted)",
            background: "transparent", border: "none",
            borderBottom: activeTab === tab ? "2px solid var(--color-accent)" : "2px solid transparent",
            cursor: "pointer", fontFamily: "var(--font-family)",
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            {tab === "log" ? "📋 Log" : "⌨ SSH"}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <StatusDot style={{ marginRight: "6px" }} />
        <span style={{ fontSize: "10px", color: "var(--color-text-muted)", marginRight: "8px", opacity: 0.7 }}>
          {loading ? `${providerLabel} · starting…` : isRunning ? `${providerLabel}${sshHost ? ` · ${sshHost}` : ""}` : "stopped"}
        </span>
        <span style={{ fontSize: "10px", color: "var(--color-text-subtle)", marginRight: "8px", opacity: 0.4 }}>
          {loading ? "● LIVE" : startLogs.length > 0 ? "■ DONE" : ""}
        </span>
      </div>

      {/* Log tab */}
      {activeTab === "log" && (
        <div ref={logContainerRef} style={{ flex: 1, overflowY: "auto", padding: "8px 12px", background: "var(--color-code,#0d1117)" }}>
          {startLogs.length === 0 ? (
            <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", fontFamily: "var(--font-family-mono)", padding: "8px 0" }}>
              No logs yet. Click Start to begin.
            </div>
          ) : startLogs.map((line, i) => (
            <div key={i} style={{
              fontSize: "11px", fontFamily: "var(--font-family-mono)", lineHeight: 1.65,
              whiteSpace: "pre-wrap", wordBreak: "break-all",
              color: (line.startsWith("✗") || line.startsWith("ERROR")) ? "var(--color-danger,#f87171)"
                   : (line.startsWith("✅") || line.startsWith("✓")) ? "var(--color-success,#4ade80)"
                   : line.startsWith("⚠") ? "#facc15"
                   : line.startsWith("─") ? "var(--color-border)"
                   : "var(--color-text-muted)",
            }}>{line}</div>
          ))}
        </div>
      )}

      {/* SSH tab */}
      {activeTab === "ssh" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#0d1117" }}>
          {(isRunning || sshHost) ? <InlineSSHTerminal /> : (
            <div style={{ padding: "24px 16px", fontSize: "12px", color: "var(--color-text-muted)", textAlign: "center" }}>
              SSH available when backend is running.
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── panel shell ───────────────────────────────────────────────
  return (
    <div ref={panelRef} style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: `${panelWidth}px`,
      background: "var(--color-panel)", borderLeft: "1px solid var(--color-border)",
      boxShadow: "var(--shadow-lg)", zIndex: 1000,
      display: "flex", flexDirection: "column",
      fontFamily: "var(--font-family)",
      userSelect: isPanelResizing ? "none" : "auto",
      transform: isOpen ? "translateX(0)" : "translateX(100%)",
      transition: "transform 0.2s ease",
      visibility: isOpen ? "visible" : "hidden",
    }}>
      {/* Resize handle */}
      <div onMouseDown={() => setIsPanelResizing(true)} style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: "5px",
        cursor: "col-resize", zIndex: 10, background: "transparent",
      }}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--color-border-strong)")}
        onMouseLeave={e => { if (!isPanelResizing) e.currentTarget.style.background = "transparent"; }}
      />

      {/* ═══════════════════════════════════════════════════════ */}
      {/* TERMINAL VIEW                                           */}
      {/* ═══════════════════════════════════════════════════════ */}
      {termView && (
        <>
          {/* Compact header */}
          <div style={{
            padding: "10px 14px", borderBottom: "1px solid var(--color-border)",
            display: "flex", alignItems: "center", gap: "8px", flexShrink: 0,
          }}>
            <TermViewToggle />
            <StatusDot />
            <span style={{ flex: 1, fontSize: "12px", fontWeight: 600, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {loading ? `${providerLabel} · starting…`
                : isRunning ? `${providerLabel} · running`
                : `${providerLabel} · stopped`}
            </span>
            <StartStopBtn compact />
            <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: "16px", padding: "2px 4px" }}>×</button>
          </div>
          {/* Full-height tabs */}
          {TabContent()}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* CONFIG VIEW                                             */}
      {/* ═══════════════════════════════════════════════════════ */}
      {!termView && (
        <>
          {/* Header */}
          <div style={{
            padding: "12px 16px", borderBottom: "1px solid var(--color-border)",
            display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: "15px", color: "var(--color-text)" }}>⚡ Modes</div>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "1px" }}>Infrastructure & runtime settings</div>
            </div>
            <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: "18px", padding: "4px" }}>×</button>
          </div>

          {/* Config body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <BillingOverview />
            <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)", marginBottom: "6px" }}>Backend</div>

            {/* Enable toggle + terminal-view button on same row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <span style={{ fontSize: "13px", color: "var(--color-text)", fontWeight: 500 }}>Enable Backend Mode</span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {config.enabled && <TermViewToggle />}
                <button onClick={() => set("enabled", !config.enabled)} style={{
                  width: "40px", height: "22px", borderRadius: "11px", border: "none",
                  background: config.enabled ? "var(--color-accent)" : "var(--color-surface)",
                  cursor: "pointer", position: "relative", transition: "background 0.2s",
                  boxShadow: "inset 0 1px 3px rgba(0,0,0,0.3)",
                }}>
                  <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: "#fff",
                    position: "absolute", top: "3px", left: config.enabled ? "20px" : "4px",
                    transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                </button>
              </div>
            </div>

            {config.enabled && (<>
              {/* Provider */}
              <CollapsibleHeader label="Provider" open={providerOpen} onToggle={() => setProviderOpen(v => !v)} />
              {providerOpen && (
                <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
                  {[
                    { id: "runpod", label: "⚡ RunPod",  sub: "from $0.34/hr · GPU cloud" },
                    { id: "vast",   label: "🌐 Vast.ai", sub: "from $0.19/hr · no storage" },
                  ].map(p => (
                    <button key={p.id} onClick={() => set("provider", p.id)}
                      disabled={loading || isRunning}
                      style={{
                        flex: 1, padding: "7px 4px", borderRadius: "var(--radius-button)", textAlign: "center",
                        border: config.provider === p.id ? "1.5px solid var(--color-accent)" : "1px solid var(--color-border)",
                        background: config.provider === p.id ? "var(--color-accent-subtle)" : "var(--color-surface)",
                        color: config.provider === p.id ? "var(--color-accent)" : "var(--color-text-muted)",
                        fontWeight: config.provider === p.id ? 700 : 500, fontSize: "12px",
                        cursor: (loading || isRunning) ? "not-allowed" : "pointer",
                        opacity: (loading || isRunning) ? 0.6 : 1,
                        fontFamily: "var(--font-family)", transition: "all 0.15s",
                      }}>
                      <div>{p.label}</div>
                      <div style={{ fontSize: "10px", opacity: 0.65, marginTop: "1px", fontWeight: 400 }}>{p.sub}</div>
                    </button>
                  ))}
                </div>
              )}

              {/* Host Scanner */}
              <HostScanner onSelectProvider={provider => set("provider", provider)} />

              {/* Settings */}
              <CollapsibleHeader label="Settings" open={settingsOpen} onToggle={() => setSettingsOpen(v => !v)} />
              {settingsOpen && (<>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" }}>
                  <label style={{ fontSize: "12px", color: "var(--color-text-muted)", fontWeight: 500 }}>Model</label>
                  <select value={selectedModel?.id || "qwen-coder"}
                    onChange={e => onSelectModel(podModels.find(m => m.id === e.target.value) || podModels[0])}
                    disabled={loading || isRunning}
                    style={{
                      background: "var(--color-input-bg)", border: "1px solid var(--color-input-border)",
                      borderRadius: "6px", padding: "7px 10px", fontSize: "12px",
                      fontFamily: "var(--font-family)", color: "var(--color-text)", outline: "none", width: "100%",
                    }}>
                    {podModels.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                  <span style={{ fontSize: "13px", color: "var(--color-text)", fontWeight: 500 }}>Auto-timeout</span>
                  <button onClick={() => set("timeoutEnabled", !config.timeoutEnabled)} style={{
                    width: "40px", height: "22px", borderRadius: "11px", border: "none",
                    background: config.timeoutEnabled ? "var(--color-accent)" : "var(--color-surface)",
                    cursor: "pointer", position: "relative", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.3)",
                  }}>
                    <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: "#fff",
                      position: "absolute", top: "3px", left: config.timeoutEnabled ? "20px" : "4px" }} />
                  </button>
                </div>
                {config.timeoutEnabled && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" }}>
                    <label style={{ fontSize: "12px", color: "var(--color-text-muted)", fontWeight: 500 }}>Timeout (minutes of inactivity)</label>
                    <input type="number" value={config.timeoutMinutes||""} onChange={e => set("timeoutMinutes", e.target.value)} placeholder="15" style={{
                      background: "var(--color-input-bg)", border: "1px solid var(--color-input-border)",
                      borderRadius: "6px", padding: "7px 10px", fontSize: "12px",
                      fontFamily: "var(--font-family-mono)", color: "var(--color-text)", outline: "none", width: "100%", boxSizing: "border-box",
                    }} />
                  </div>
                )}
              </>)}

              <div style={{ height: "1px", background: "var(--color-border)", margin: "8px 0" }} />
              <StartStopBtn />
            </>)}
          </div>
        </>
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
    fetch("http://localhost:5000/backend/status")
      .then((r) => r.json())
      .then((d) => {
        if (!d.running && !d.job_running) return;
        const provider = d.provider || "runpod";
        setRunpodConfig((prev) => ({
          ...prev,
          enabled: true,
          provider,
          podRunning: d.running,
        }));
        const lines = [];
        const label = provider === "vast" ? "🌐 Vast.ai" : "⚡ RunPod";
        if (d.job_running) {
          lines.push(`${label} job is in progress — reconnect or wait for it to finish`);
        } else if (d.running) {
          lines.push(`${label} instance already running  [${d.instance_id}]`);
          if (d.uptime) lines.push(`⏱ Uptime: ${d.uptime}`);
          if (d.ssh_host) lines.push(`✓  SSH  ${d.ssh_host}:${d.ssh_port}`);
          lines.push(`✅ Ready — switch to Vast.ai tab to chat or open SSH`);
        }
        setStartLogs(lines.filter(Boolean));
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
    setStartLogs((prev) => prev.length > 0
      ? [...prev, "", "─".repeat(40), ""]   // separator between runs
      : []);
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

      es.onerror = () => { es.close(); setRunpodLoading(false); setTimeout(() => { startingRef.current = false; }, 3000); };
    } catch (err) {
      const msg = err.response?.data?.error || err.message || "Unknown error";
      setStartLogs((prev) => [...prev, `✗ ${msg}`]);
      setRunpodLoading(false);
      setTimeout(() => { startingRef.current = false; }, 3000);
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

      {/* MODES PANEL — always mounted so state survives collapse */}
      <ModesPanel
        isOpen={modesOpen}
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
    </div>
  );
}