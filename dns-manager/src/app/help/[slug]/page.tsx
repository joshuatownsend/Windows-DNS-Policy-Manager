"use client";

import { useParams } from "next/navigation";
import { getAllDocs } from "@/lib/help-mapping";
import { useHelpDoc } from "@/lib/use-help-doc";
import { HelpSpinner, HelpMarkdown } from "@/components/help-content";
import { cn } from "@/lib/utils";
import Link from "next/link";

export default function HelpPage() {
  const params = useParams();
  const slug = (params.slug as string) || "getting-started";
  const { content, loading } = useHelpDoc(slug);
  const allDocs = getAllDocs();

  return (
    <div className="flex min-h-[calc(100vh-160px)] gap-6">
      {/* Sidebar */}
      <nav className="w-48 shrink-0 space-y-0.5 pt-1">
        <div
          className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground mb-3 px-2 font-display"
        >
          HELP DOCS
        </div>
        {allDocs.map((doc) => (
          <Link
            key={doc.slug}
            href={`/help/${doc.slug}`}
            className={cn(
              "block px-2.5 py-1.5 rounded text-[13px] transition-colors",
              doc.slug === slug
                ? "bg-cyan/10 text-cyan font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-[rgba(136,180,255,0.05)]"
            )}
          >
            {doc.title}
          </Link>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {loading ? (
          <HelpSpinner />
        ) : (
          <div className="max-w-2xl">
            <HelpMarkdown content={content} />
          </div>
        )}
      </div>
    </div>
  );
}
