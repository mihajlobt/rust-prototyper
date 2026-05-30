import { useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettings } from "@/hooks/useSettings";
import { DESIGN_BRIEF_TEMPLATES } from "@/lib/prompts";

export function StylesEditor() {
  const { settings, setSettings } = useSettings();
  const [expandedIndex, setExpandedIndex] = useState<number | "new" | null>(null);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  // Local draft so typing doesn't write to disk on every keystroke
  const [draftName, setDraftName] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const openStyle = (i: number) => {
    setDraftName(settings.styles[i].name);
    setDraftValue(settings.styles[i].value);
    setExpandedIndex(i);
  };

  const saveStyle = async (i: number) => {
    const next = settings.styles.map((s, idx) =>
      idx === i ? { name: draftName || s.name, value: draftValue } : s
    );
    await setSettings({ styles: next });
  };

  const deleteStyle = async (index: number) => {
    await setSettings({ styles: settings.styles.filter((_, i) => i !== index) });
    if (expandedIndex === index) setExpandedIndex(null);
    else if (typeof expandedIndex === "number" && expandedIndex > index) setExpandedIndex(expandedIndex - 1);
  };

  const addStyle = async () => {
    if (!newName.trim() || !newContent.trim()) return;
    await setSettings({ styles: [...settings.styles, { name: newName.trim(), value: newContent.trim() }] });
    setNewName("");
    setNewContent("");
    setExpandedIndex(null);
  };

  return (
    <ScrollArea className="flex-1 overflow-hidden">
      <div className="space-y-6 pr-1">

        {/* Custom styles */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Custom Styles</p>
              {settings.styles.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                  {settings.styles.length}
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[11px] gap-1"
              onClick={() => setExpandedIndex(expandedIndex === "new" ? null : "new")}
            >
              <Plus size={10} />
              New style
            </Button>
          </div>

          {/* New style form */}
          {expandedIndex === "new" && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
              <Input
                autoFocus
                placeholder="Style name (e.g. Corporate Dark)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-7 text-xs"
              />
              <Textarea
                placeholder={"Write a design brief in markdown.\n\nDescribe colors, typography, spacing, component style, mood, and anti-patterns.\nThe AI will follow these instructions when generating screens and components."}
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="font-mono text-xs min-h-[160px] resize-y"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setExpandedIndex(null); setNewName(""); setNewContent(""); }}>Cancel</Button>
                <Button size="sm" className="h-6 text-xs" onClick={addStyle} disabled={!newName.trim() || !newContent.trim()}>Add style</Button>
              </div>
            </div>
          )}

          {/* Existing custom styles */}
          {settings.styles.length === 0 && expandedIndex !== "new" && (
            <p className="text-xs text-muted-foreground py-2">
              No custom styles yet. Add one above to use it as a brief in Screens and Components generation.
            </p>
          )}

          <div className="space-y-1">
            {settings.styles.map((style, i) => {
              const isOpen = expandedIndex === i;
              return (
                <div key={i} className="rounded-lg border border-border overflow-hidden">
                  {/* Row header */}
                  <div
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => isOpen ? setExpandedIndex(null) : openStyle(i)}
                  >
                    <span className="text-muted-foreground/50 shrink-0">
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                    <FileText size={12} className="text-primary shrink-0" />
                    <span className="flex-1 text-sm font-medium truncate">{style.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {style.value.split("\n").length} lines
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteStyle(i); }}
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>

                  {/* Edit area */}
                  {isOpen && (
                    <div className="px-3 pb-3 space-y-2 border-t border-border bg-muted/20">
                      <Input
                        className="mt-2 h-7 text-sm font-medium"
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={() => saveStyle(i)}
                        placeholder="Style name"
                      />
                      <Textarea
                        className="font-mono text-xs min-h-[200px] resize-y"
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
                        onBlur={() => saveStyle(i)}
                        placeholder="Design brief content (markdown)…"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Changes are saved when you click outside a field. This style appears in the Brief dropdown in Screens and Components.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Built-in reference */}
        <section className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Built-in Briefs</p>
          <p className="text-xs text-muted-foreground">These are always available in the Brief dropdown. For reference only.</p>
          <div className="space-y-1">
            {DESIGN_BRIEF_TEMPLATES.map((brief) => (
              <div key={brief.name} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-muted/20">
                <div className="flex gap-0.5 shrink-0">
                  {brief.palette.map((c) => (
                    <span key={c} className="w-3 h-3 rounded-sm border border-border/30" style={{ background: c }} />
                  ))}
                </div>
                <span className="text-sm font-medium">{brief.name}</span>
                <span className="text-xs text-muted-foreground ml-1">{brief.description}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
