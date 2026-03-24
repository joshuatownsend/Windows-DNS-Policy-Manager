"use client";

import { useState, useEffect, useRef } from "react";
import { BridgeStatus } from "./bridge-status";
import { ExecutionToggle } from "./execution-toggle";
import { TabNav } from "./tab-nav";
import { HelpPanel } from "./help-panel";
import { useBridgeHealth } from "@/lib/use-bridge-health";
import { useStore } from "@/lib/store";

const STATUS_DOT: Record<string, string> = {
  online: "bg-emerald-500",
  offline: "bg-red-500",
  error: "bg-amber-500",
  unknown: "bg-zinc-500",
};

function ServerSwitcher() {
  const servers = useStore((s) => s.servers);
  const activeServerId = useStore((s) => s.activeServerId);
  const setActiveServerId = useStore((s) => s.setActiveServerId);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!mounted || servers.length === 0) return null;

  const active = servers.find((s) => s.id === activeServerId);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs hover:bg-secondary/50 transition-colors"
      >
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[active?.status || "unknown"]}`} />
        <span className="font-mono text-foreground/90 max-w-[140px] truncate">
          {active?.name || active?.hostname || "No server"}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-muted-foreground">
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[220px] rounded-md border border-border bg-popover shadow-lg py-1">
          {servers.map((s) => {
            const isActive = s.id === activeServerId;
            return (
              <button
                key={s.id}
                onClick={() => {
                  setActiveServerId(s.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
                  isActive
                    ? "bg-cyan-500/10 text-cyan-400"
                    : "text-foreground/80 hover:bg-secondary/50"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[s.status]}`} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{s.name || s.hostname}</div>
                  {s.name && s.name !== s.hostname && (
                    <div className="text-[10px] text-muted-foreground font-mono truncate">{s.hostname}</div>
                  )}
                </div>
                {s.status === "online" && s.zoneCount > 0 && (
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">
                    {s.zoneCount}z
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  useBridgeHealth();
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background ops-grid-bg">
      {/* ── Header ──────────────────────────────────────── */}
      <header className="relative ops-scanline">
        <div className="mx-auto max-w-[1400px] px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Brand */}
            <div className="flex items-center gap-4">
              <div className="relative flex items-center justify-center w-9 h-9">
                <div className="absolute inset-0 rounded-lg bg-cyan/10 border border-cyan/20" />
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="w-[18px] h-[18px] relative z-10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5Z" className="stroke-cyan" />
                  <path d="M2 17l10 5 10-5" className="stroke-cyan/50" />
                  <path d="M2 12l10 5 10-5" className="stroke-cyan/70" />
                </svg>
              </div>
              <div>
                <h1
                  className="text-[15px] font-semibold tracking-wide text-foreground"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  DNS POLICY MANAGER
                </h1>
                <p className="text-[11px] text-muted-foreground tracking-widest uppercase font-mono">
                  Windows Server Operations Console
                </p>
              </div>
            </div>

            {/* Right side: controls */}
            <div className="flex items-center gap-5">
              <ServerSwitcher />
              <div className="w-px h-5 bg-border" />
              <ExecutionToggle />
              <div className="w-px h-5 bg-border" />
              <BridgeStatus />
              <div className="w-px h-5 bg-border" />
              {/* Help button */}
              <button
                onClick={() => setHelpOpen(true)}
                className="group relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-[rgba(136,180,255,0.08)] transition-colors"
                title="Help (context-sensitive)"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-muted-foreground group-hover:text-cyan transition-colors"
                >
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M6 6.5a2 2 0 013.94.5c0 1-1.44 1.5-1.44 1.5" />
                  <circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div className="header-rule" />
      </header>

      {/* ── Tabs + Content ──────────────────────────────── */}
      <div className="mx-auto max-w-[1400px] px-6 pt-1">
        <TabNav />
        <main className="py-6 animate-fade-in">{children}</main>
      </div>

      {/* ── Help slide-over ─────────────────────────────── */}
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
