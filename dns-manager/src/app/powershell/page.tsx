"use client";

import { useCallback } from "react";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Trash2, Terminal } from "lucide-react";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PowerShellPage() {
  const psOutput = useStore((s) => s.psOutput);
  const clearPsOutput = useStore((s) => s.clearPsOutput);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  }, []);

  function handleCopyAll() {
    if (psOutput.length === 0) return;
    const allText = psOutput.join("\n");
    copyToClipboard(allText);
  }

  function handleClear() {
    clearPsOutput();
    toast.success("Output cleared");
  }

  // Extract just the command portion (after the timestamp bracket)
  function extractCommand(entry: string): string {
    const match = entry.match(/^\[.*?\]\s*(.*)$/);
    return match ? match[1] : entry;
  }

  // Extract just the timestamp portion
  function extractTimestamp(entry: string): string {
    const match = entry.match(/^\[(.*?)\]/);
    return match ? match[1] : "";
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            PowerShell Commands
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Generated and executed PowerShell commands for DNS policy management.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyAll}
            disabled={psOutput.length === 0}
            className="border-zinc-700"
          >
            <Copy className="h-3.5 w-3.5 mr-2" />
            Copy All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            disabled={psOutput.length === 0}
            className="border-zinc-700 hover:border-red-700 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            Clear Output
          </Button>
        </div>
      </div>

      <Card className="border-zinc-800 bg-zinc-950">
        <CardContent className="p-0">
          {psOutput.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
              <Terminal className="h-12 w-12 mb-4 text-zinc-600" />
              <p className="text-sm text-center max-w-md">
                No commands generated yet. Use the Create Policy or Wizards tab
                to generate commands.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-260px)]">
              <div className="divide-y divide-zinc-800/50">
                {psOutput.map((entry, index) => {
                  const timestamp = extractTimestamp(entry);
                  const command = extractCommand(entry);

                  return (
                    <div
                      key={index}
                      className="group flex items-start gap-3 px-4 py-3 hover:bg-zinc-900/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        {timestamp && (
                          <span className="text-xs text-zinc-600 block mb-1">
                            {timestamp}
                          </span>
                        )}
                        <pre className="font-mono text-sm text-zinc-300 whitespace-pre-wrap break-all">
                          {command}
                        </pre>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-cyan-400 transition-opacity shrink-0 mt-1"
                        onClick={() => copyToClipboard(command)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
