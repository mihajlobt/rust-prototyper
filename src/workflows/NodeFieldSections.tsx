// Per-node configuration field sections rendered inside NodePropertiesPanel.

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import type { WorkflowNodeData } from "@/workflows/nodeTypes";

interface FieldProps {
  data: WorkflowNodeData;
  set: (patch: Partial<WorkflowNodeData>) => void;
}

// ─── Shared field primitives ───────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs text-muted-foreground">{children}</label>;
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

// ─── IO nodes ─────────────────────────────────────────────────────────────

export function InputNodeFields({ data, set }: FieldProps) {
  return (
    <FieldRow label="Prompt">
      <Textarea value={data.prompt || ""} onChange={(e) => set({ prompt: e.target.value })} className="text-xs min-h-[80px] resize-none" placeholder="Enter workflow starting prompt…" />
    </FieldRow>
  );
}

export function WriteFileFields({ data, set }: FieldProps) {
  return (
    <>
      <FieldRow label="Path (relative to generated/)">
        <Input value={data.path || ""} onChange={(e) => set({ path: e.target.value })} className="h-7 text-xs" placeholder="src/App.tsx" />
      </FieldRow>
      <FieldRow label="Mode">
        <Select value={String(data.mode ?? "overwrite")} onValueChange={(v) => set({ mode: v })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" side="bottom">
            <SelectItem value="overwrite" className="text-xs">Overwrite</SelectItem>
            <SelectItem value="append" className="text-xs">Append</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>
    </>
  );
}

// ─── Utility nodes ────────────────────────────────────────────────────────

export function BashFields({ data, set }: FieldProps) {
  return (
    <FieldRow label="Command">
      <Input value={data.command || ""} onChange={(e) => set({ command: e.target.value })} className="h-7 text-xs" placeholder="echo hello" />
    </FieldRow>
  );
}

export function FetchFields({ data, set }: FieldProps) {
  return (
    <>
      <FieldRow label="URL">
        <Input value={data.url || ""} onChange={(e) => set({ url: e.target.value })} className="h-7 text-xs" placeholder="https://api.example.com" />
      </FieldRow>
      <FieldRow label="Method">
        <Input value={data.method || "GET"} onChange={(e) => set({ method: e.target.value })} className="h-7 text-xs" />
      </FieldRow>
      <FieldRow label="Headers (JSON)">
        <Textarea value={data.headers || "{}"} onChange={(e) => set({ headers: e.target.value })} className="text-xs min-h-[60px] resize-none font-mono" />
      </FieldRow>
      <FieldRow label="Body">
        <Textarea value={data.body || ""} onChange={(e) => set({ body: e.target.value })} className="text-xs min-h-[60px] resize-none" />
      </FieldRow>
    </>
  );
}

export function FileOpFields({ data, set }: FieldProps) {
  return (
    <>
      <FieldRow label="Operation">
        <Select value={data.operation || "read"} onValueChange={(v) => set({ operation: v })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" side="bottom">
            <SelectItem value="read" className="text-xs">Read</SelectItem>
            <SelectItem value="write" className="text-xs">Write</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="Path">
        <Input value={data.path || ""} onChange={(e) => set({ path: e.target.value })} className="h-7 text-xs" placeholder="./file.txt" />
      </FieldRow>
      {data.operation === "write" && (
        <FieldRow label="Content">
          <Textarea value={data.content || ""} onChange={(e) => set({ content: e.target.value })} className="text-xs min-h-[60px] resize-none" />
        </FieldRow>
      )}
    </>
  );
}

export function AuthFields({ data, set }: FieldProps) {
  return (
    <>
      <FieldRow label="Scheme">
        <Select value={data.authScheme || "bearer"} onValueChange={(v) => set({ authScheme: v })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" side="bottom">
            <SelectItem value="bearer" className="text-xs">Bearer</SelectItem>
            <SelectItem value="apikey" className="text-xs">API Key</SelectItem>
            <SelectItem value="basic" className="text-xs">Basic</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="Token / Key">
        <Input value={data.authToken || ""} onChange={(e) => set({ authToken: e.target.value })} className="h-7 text-xs" />
      </FieldRow>
      {data.authScheme === "apikey" && (
        <FieldRow label="Header Name">
          <Input value={data.authHeaderName || "X-API-Key"} onChange={(e) => set({ authHeaderName: e.target.value })} className="h-7 text-xs" />
        </FieldRow>
      )}
    </>
  );
}

export function TransformFields({ data, set }: FieldProps) {
  return (
    <FieldRow label="Transform Instruction">
      <Textarea value={data.prompt || ""} onChange={(e) => set({ prompt: e.target.value })} className="text-xs min-h-[60px] resize-none" placeholder="Convert to TypeScript…" />
    </FieldRow>
  );
}

export function DesignSystemFields({ data, set }: FieldProps) {
  return (
    <FieldRow label="Theme Name">
      <Input value={data.prompt || ""} onChange={(e) => set({ prompt: e.target.value })} className="h-7 text-xs" placeholder="default, dark, light…" />
    </FieldRow>
  );
}

export function BunFields({ data, set }: FieldProps) {
  return (
    <FieldRow label="Bun Command">
      <Input value={data.command || "dev"} onChange={(e) => set({ command: e.target.value })} className="h-7 text-xs" placeholder="dev, build, install" />
    </FieldRow>
  );
}

export function RunnerFields({ data, set }: FieldProps) {
  return (
    <FieldRow label="Port">
      <Input value={String(data.port ?? "5173")} onChange={(e) => set({ port: e.target.value })} className="h-7 text-xs" placeholder="5173" />
    </FieldRow>
  );
}

export function ContextOverrideFields({ data, set }: FieldProps) {
  return (
    <FieldRow label="Context Override">
      <Textarea value={data.prompt || ""} onChange={(e) => set({ prompt: e.target.value })} className="text-xs min-h-[60px] resize-none" placeholder="Override input from previous node…" />
    </FieldRow>
  );
}

export function PreviewFields({ data }: FieldProps) {
  if (!data.output) return null;
  return (
    <FieldRow label="Code Preview">
      <div className="border border-border rounded overflow-hidden" style={{ height: 200 }}>
        <CodeMirrorEditor
          value={data.output}
          mode="tsx"
          readOnly
          minimal
          height="200px"
        />
      </div>
    </FieldRow>
  );
}

// ─── New nodes ─────────────────────────────────────────────────────────────

export function ConditionFields({ data, set }: FieldProps) {
  const mode = data.conditionMode ?? "expression";
  return (
    <>
      <FieldRow label="Mode">
        <Select value={mode} onValueChange={(v) => set({ conditionMode: v as "expression" | "ai" })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" side="bottom">
            <SelectItem value="expression" className="text-xs">JS Expression</SelectItem>
            <SelectItem value="ai" className="text-xs">AI Judge</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>
      {mode === "expression" ? (
        <FieldRow label="Expression (input = previous output)">
          <Input value={data.expression || ""} onChange={(e) => set({ expression: e.target.value })} className="h-7 text-xs font-mono" placeholder="input.includes('error')" />
        </FieldRow>
      ) : (
        <FieldRow label="Judge Prompt">
          <Textarea value={data.judgePrompt || ""} onChange={(e) => set({ judgePrompt: e.target.value })} className="text-xs min-h-[60px] resize-none" placeholder="Does the input contain valid TypeScript code?" />
        </FieldRow>
      )}
    </>
  );
}

export function LoopUntilFields({ data, set }: FieldProps) {
  return (
    <>
      <FieldRow label="Validation Command">
        <Input value={data.validationCommand || "bun tsc --noEmit"} onChange={(e) => set({ validationCommand: e.target.value })} className="h-7 text-xs font-mono" placeholder="bun tsc --noEmit" />
      </FieldRow>
      <FieldRow label="Max Iterations">
        <Input type="number" value={String(data.maxIterations ?? 3)} onChange={(e) => set({ maxIterations: Number(e.target.value) })} className="h-7 text-xs" min={1} max={10} />
      </FieldRow>
      <FieldRow label="Fix Prompt (AI instruction)">
        <Textarea value={data.fixPrompt || ""} onChange={(e) => set({ fixPrompt: e.target.value })} className="text-xs min-h-[60px] resize-none" placeholder="Fix all TypeScript and lint errors…" />
      </FieldRow>
    </>
  );
}

export function SummarizeFields({ data, set }: FieldProps) {
  return (
    <FieldRow label="Focus / Hint (optional)">
      <Input value={data.prompt || ""} onChange={(e) => set({ prompt: e.target.value })} className="h-7 text-xs" placeholder="Focus on component interfaces and state…" />
    </FieldRow>
  );
}

export function DiffFields({ data, set }: FieldProps) {
  return (
    <FieldRow label="Base Content (before)">
      <Textarea value={data.baseContent || ""} onChange={(e) => set({ baseContent: e.target.value })} className="text-xs min-h-[80px] resize-none font-mono" placeholder="Paste original content here — previous node output is 'after'" />
    </FieldRow>
  );
}

export function JsonExtractFields({ data, set }: FieldProps) {
  return (
    <FieldRow label="JSON Path (dot-notation)">
      <Input value={data.jsonPath || ""} onChange={(e) => set({ jsonPath: e.target.value })} className="h-7 text-xs font-mono" placeholder="data.items.0.name" />
    </FieldRow>
  );
}

export function LinterFields({ data, set }: FieldProps) {
  return (
    <FieldRow label="Lint Target">
      <Select value={data.lintTarget ?? "both"} onValueChange={(v) => set({ lintTarget: v as "tsc" | "eslint" | "both" })}>
        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent position="popper" side="bottom">
          <SelectItem value="tsc" className="text-xs">TypeScript (tsc)</SelectItem>
          <SelectItem value="eslint" className="text-xs">ESLint</SelectItem>
          <SelectItem value="both" className="text-xs">Both</SelectItem>
        </SelectContent>
      </Select>
    </FieldRow>
  );
}

export function GitOpFields({ data, set }: FieldProps) {
  return (
    <>
      <FieldRow label="Git Command">
        <Select value={data.gitCommand || "status"} onValueChange={(v) => set({ gitCommand: v })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" side="bottom">
            <SelectItem value="status" className="text-xs">git status</SelectItem>
            <SelectItem value="add" className="text-xs">git add .</SelectItem>
            <SelectItem value="commit" className="text-xs">git commit</SelectItem>
            <SelectItem value="add-commit" className="text-xs">git add + commit</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>
      {(data.gitCommand === "commit" || data.gitCommand === "add-commit") && (
        <FieldRow label="Commit Message (empty = use previous output)">
          <Input value={data.commitMessage || ""} onChange={(e) => set({ commitMessage: e.target.value })} className="h-7 text-xs" placeholder="Leave empty to use previous node output" />
        </FieldRow>
      )}
    </>
  );
}

export function MemoryKeyField({ data, set }: FieldProps) {
  return (
    <FieldRow label="Memory Key">
      <Input value={data.memoryKey || ""} onChange={(e) => set({ memoryKey: e.target.value })} className="h-7 text-xs font-mono" placeholder="result-key" />
    </FieldRow>
  );
}
