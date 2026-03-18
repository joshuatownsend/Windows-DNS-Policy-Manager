"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";

interface EditableFieldProps {
  label: string;
  value: unknown;
  type: "boolean" | "number" | "string" | "readonly";
  onSave?: (newValue: unknown) => Promise<boolean>;
}

export function EditableField({ label, value, type, onSave }: EditableFieldProps) {
  const [saving, setSaving] = useState(false);
  const [localValue, setLocalValue] = useState(String(value ?? ""));

  const save = async (newVal: unknown) => {
    if (!onSave) return;
    setSaving(true);
    await onSave(newVal);
    setSaving(false);
  };

  if (type === "readonly" || !onSave) {
    return (
      <div className="flex items-center justify-between p-2 rounded bg-secondary/30">
        <span className="text-xs text-muted-foreground truncate mr-2">{label}</span>
        <Badge variant="secondary" className="text-xs shrink-0">{String(value ?? "")}</Badge>
      </div>
    );
  }

  if (type === "boolean") {
    return (
      <div className="flex items-center justify-between p-2 rounded bg-secondary/30">
        <span className="text-xs text-muted-foreground truncate mr-2">{label}</span>
        {saving ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <Switch
            checked={Boolean(value)}
            onCheckedChange={(checked) => save(checked)}
          />
        )}
      </div>
    );
  }

  // number or string
  return (
    <div className="flex items-center justify-between gap-2 p-2 rounded bg-secondary/30">
      <span className="text-xs text-muted-foreground truncate shrink-0">{label}</span>
      {saving ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : (
        <Input
          type={type === "number" ? "number" : "text"}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={() => {
            const newVal = type === "number" ? parseInt(localValue) || 0 : localValue;
            if (String(newVal) !== String(value)) save(newVal);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const newVal = type === "number" ? parseInt(localValue) || 0 : localValue;
              save(newVal);
            }
          }}
          className="h-7 w-28 text-xs text-right font-mono"
        />
      )}
    </div>
  );
}
