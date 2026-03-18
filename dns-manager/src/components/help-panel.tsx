"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";
import { Menu, ExternalLink, X } from "lucide-react";
import { slugForRoute, titleForSlug, getAllDocs } from "@/lib/help-mapping";
import { useHelpDoc } from "@/lib/use-help-doc";
import { HelpSpinner, HelpMarkdown } from "./help-content";
import { cn } from "@/lib/utils";

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
}

export function HelpPanel({ open, onClose }: HelpPanelProps) {
  const pathname = usePathname();
  const [slug, setSlug] = useState(() => slugForRoute(pathname));
  const [showNav, setShowNav] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { content, loading, reload } = useHelpDoc(slug);

  // Load doc for current route when panel opens
  useEffect(() => {
    if (!open) return;
    const routeSlug = slugForRoute(pathname);
    // Schedule state updates for next microtask to avoid synchronous setState in effect
    queueMicrotask(() => {
      setSlug(routeSlug);
      reload(routeSlug);
      setShowNav(false);
    });
  }, [open, pathname, reload]);

  // Scroll to top on content change
  useEffect(() => {
    if (content && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [content]);

  const navigateTo = (newSlug: string) => {
    setSlug(newSlug);
    reload(newSlug);
    setShowNav(false);
  };

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const title = titleForSlug(slug);
  const allDocs = getAllDocs();

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={handleBackdropClick}
        aria-hidden={!open}
      />

      {/* Slide-over panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Help documentation"
        className={cn(
          "fixed top-0 right-0 z-50 h-full w-full max-w-lg",
          "flex flex-col",
          "bg-[#0a0f1a] border-l border-[rgba(136,180,255,0.1)]",
          "shadow-[-8px_0_32px_rgba(0,0,0,0.5)]",
          "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[rgba(136,180,255,0.08)] bg-[#080c14]">
          <div className="flex items-center gap-3 min-w-0">
            {showNav ? (
              <h2
                className="text-sm font-semibold tracking-wide text-foreground truncate"
                style={{ fontFamily: "var(--font-display)" }}
              >
                HELP DOCS
              </h2>
            ) : (
              <>
                <button
                  onClick={() => setShowNav(true)}
                  className="shrink-0 p-1 rounded hover:bg-[rgba(136,180,255,0.08)] text-muted-foreground hover:text-foreground transition-colors"
                  title="All help topics"
                >
                  <Menu size={16} />
                </button>
                <h2 className="text-sm font-semibold text-foreground truncate">
                  {title}
                </h2>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <a
              href={`/help/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded hover:bg-[rgba(136,180,255,0.08)] text-muted-foreground hover:text-foreground transition-colors"
              title="Open in new tab"
            >
              <ExternalLink size={14} />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-[rgba(136,180,255,0.08)] text-muted-foreground hover:text-foreground transition-colors"
              title="Close (Esc)"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {showNav ? (
            <nav className="p-4 space-y-1">
              {allDocs.map((doc) => (
                <button
                  key={doc.slug}
                  onClick={() => navigateTo(doc.slug)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors",
                    doc.slug === slug
                      ? "bg-cyan/10 text-cyan font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-[rgba(136,180,255,0.05)]"
                  )}
                >
                  {doc.title}
                </button>
              ))}
            </nav>
          ) : loading ? (
            <HelpSpinner />
          ) : (
            <div className="px-6 py-5">
              <HelpMarkdown content={content} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
