// ─── Key Vault sub-component (sidebar "keys" tab) ─────────────────────────────

import { Key, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ApiKey } from "./types";

export interface ApiKeysSectionProps {
  apiKeys: ApiKey[];
  proxyMappings: Record<string, string>;
  newKeyName: string;
  newKeyValue: string;
  newKeyDesc: string;
  setNewKeyName: (value: string) => void;
  setNewKeyValue: (value: string) => void;
  setNewKeyDesc: (value: string) => void;
  onAddKey: () => void;
  onUpdateKey: (id: string, field: keyof ApiKey, value: string) => void;
  onDeleteKey: (id: string) => void;
}

export function ApiKeysSection({
  apiKeys,
  proxyMappings,
  newKeyName,
  newKeyValue,
  newKeyDesc,
  setNewKeyName,
  setNewKeyValue,
  setNewKeyDesc,
  onAddKey,
  onUpdateKey,
  onDeleteKey,
}: ApiKeysSectionProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="p-3 space-y-3">
          {apiKeys.length === 0 && (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-muted-foreground text-center">
              <Key size={20} className="opacity-30" />
              <p className="text-xs font-medium">No API keys yet</p>
              <p className="text-[10px] opacity-60 leading-relaxed">Add keys here to sync them as VITE_* env vars to your generated project</p>
            </div>
          )}
          {apiKeys.map((k) => (
            <div key={k.id} className="space-y-1">
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">VITE_</span>
                <Input
                  value={k.name}
                  onChange={(e) => onUpdateKey(k.id, "name", e.target.value.toUpperCase().replace(/\W+/g, "_"))}
                  className="h-6 text-xs font-mono flex-1 uppercase"
                  placeholder="KEY_NAME"
                />
                <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => onDeleteKey(k.id)}>
                  <X size={10} className="text-red-500" />
                </Button>
              </div>
              <Input
                type="password"
                value={k.value}
                onChange={(e) => onUpdateKey(k.id, "value", e.target.value)}
                className="h-6 text-xs"
                placeholder="Key value"
              />
              {k.description && (
                <p className="text-[10px] text-muted-foreground">{k.description}</p>
              )}
            </div>
          ))}

          {/* Add new key */}
          <div className="border-t border-border pt-3 space-y-1.5">
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono text-muted-foreground">VITE_</span>
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value.toUpperCase().replace(/\W+/g, "_"))}
                className="h-6 text-xs font-mono flex-1 uppercase"
                placeholder="KEY_NAME"
                onKeyDown={(e) => { if (e.key === "Enter") onAddKey(); }}
              />
            </div>
            <Input
              type="password"
              value={newKeyValue}
              onChange={(e) => setNewKeyValue(e.target.value)}
              className="h-6 text-xs"
              placeholder="Key value"
              onKeyDown={(e) => { if (e.key === "Enter") onAddKey(); }}
            />
            <Input
              value={newKeyDesc}
              onChange={(e) => setNewKeyDesc(e.target.value)}
              className="h-6 text-xs text-muted-foreground"
              placeholder="Description (optional)"
            />
            <Button size="sm" className="h-7 w-full text-xs gap-1" onClick={onAddKey} disabled={!newKeyName.trim()}>
              <Plus size={12} />
              Add Key
            </Button>
          </div>

          {/* Proxy mappings preview */}
          {Object.keys(proxyMappings).length > 0 && (
            <div className="border-t border-border pt-3 space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Proxy Mappings</p>
              {Object.entries(proxyMappings).map(([prefix, target]) => (
                <div key={prefix} className="text-[10px] font-mono text-muted-foreground">
                  <span className="text-foreground">{prefix}</span>
                  <span className="mx-1">→</span>
                  <span className="truncate">{target}</span>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">Derived from APIs with Proxy Path set. Click Sync to write to vite.config.ts</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
