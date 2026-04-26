# Prototyper AI Generation Agent Chain Audit

**Date**: April 2026  
**Project**: Prototyper (Tauri v2 Desktop App)  
**Scope**: Full exploration of Theme, Component, and Screen generation flows

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Themes Generation Flow](#themes-generation-flow)
3. [Components Generation Flow](#components-generation-flow)
4. [Screens Generation Flow](#screens-generation-flow)
5. [Workflows System](#workflows-system)
6. [Rust Backend & Agent Loop](#rust-backend--agent-loop)
7. [Settings & Model Configuration](#settings--model-configuration)
8. [Inconsistencies & Issues](#inconsistencies--issues)

---

## Architecture Overview

### High-Level Call Chain

```
React Panel (User Input)
    ↓
useChat Hook (manages conversation state, streaming)
    ↓
generateCompletionStream (IPC → Rust)
    ↓
Rust Backend
    ├─ (NO tools) → Plain streaming: OpenAI/Claude/Ollama
    └─ (WITH tools) → Agent Loop: write_file, read_file, bash
        ├─ stream_turn() - streams model output
        ├─ Tool execution (write_file, read_file, bash)
        ├─ Multi-turn loop (max 10 iterations)
        └─ Returns full response to frontend
    ↓
Frontend receives chunks, assembles final content
    ↓
onOutput callback → save file, update preview
```

### Key Components

| File | Role |
|------|------|
| `src/panels/ThemesPanel.tsx` | Theme generation UI |
| `src/panels/ComponentsPanel.tsx` | Component generation UI |
| `src/panels/ScreensPanel.tsx` | Screen generation UI |
| `src/hooks/useChat.ts` | Core chat/generation orchestration |
| `src/lib/ipc.ts` | IPC layer (generateCompletionStream, generateCompletion) |
| `src/lib/prompts.ts` | All system prompts & prompt templates |
| `src-tauri/src/lib.rs` | Rust IPC handlers, provider routing |
| `src-tauri/src/agent/` | Agent loop, tool executor |
| `src/workflows/WorkflowsView.tsx` | Workflow builder & executor |

---

## Themes Generation Flow

### Entry Point: `ThemesPanel.tsx`

**Key State:**
- `selectedThemeDir`: current theme name (e.g., "main", "ocean")
- `css`: CSS content in editor
- `themesFramework`: "generic" | "shadcn" | "daisy" | "bootstrap"
- `themesDarkLightSupport`: boolean (generate light+dark variants)

### System Prompt Construction

```tsx
systemPrompt = settings.prompts["themes-system"] || (
  getThemeSystemPrompt(themesFramework) +
  (themesDarkLightSupport ? "\n\nGenerate both :root (light) and .dark (dark mode) variants..." : "")
)
```

**Base Prompt** (`src/lib/prompts.ts:234-255`):
```
"You are a CSS design token expert. Generate a complete, production-ready theme as CSS custom properties."

TOOL USAGE — REQUIRED:
You MUST call the write_file tool. The content argument is raw CSS...

CSS RULES:
- Output only the CSS variable block(s) as instructed by the theme type below.
- No selectors, no element styles, no @import — only custom property blocks...
```

**Theme Type Docs** (injected based on `themesFramework`):
- **shadcn**: oklch() colors, :root + .dark block
- **daisyui**: HSL values without hsl() wrapper, [data-theme="custom"] selector
- **bootstrap**: Bootstrap 5 tokens (--bs-primary, --bs-body-bg, etc.)
- **generic**: Custom property names (--color-primary, --font-sans, --spacing-xs, etc.)

**Dark Mode Suffix** (if `themesDarkLightSupport`):
```
"Generate both :root (light) and .dark (dark mode) variants in the same CSS block."
```

### Chat Flow

1. **User sends message** (via `ChatInput`)
2. **useChat.sendMessage()**:
   - Constructs API messages: `[{ role: "system", content: systemPrompt }, ...previousMessages, { role: "user", content: userInput }]`
   - Calls `generateCompletionStream()`
   - Streams chunks into chat UI
   - When `write_file` tool executes, calls `onOutput()` callback

3. **onOutput() → persistTheme()**:
   - Strips code fences: `content.replace(/^```(?:css)?\s*/i, "").replace(/\s*```[\s\S]*$/i, "")`
   - Saves to: `projects/{projectId}/themes/{themeDir}/theme.css`
   - Also saves prompt metadata to: `projects/{projectId}/themes/{themeDir}/prompt.json`
   - Triggers UI preview reload

### IPC Parameters

```ts
generateCompletionStream(
  model: settings.modelId,          // e.g., "gemma4-26b-128k:latest"
  messages: [system, ...chat, user],
  host: getHostForProvider(...),    // http://localhost:11434, https://api.openai.com, etc.
  apiKey: getApiKeyForProvider(...),
  channel: Channel<CompletionEvent>,
  think: thinkEnabled && caps.thinking,
  outputPath: "projects/{id}/themes/{dir}/theme.css",  // ← TRIGGERS AGENT LOOP
  provider: settings.provider       // "ollama-local", "openai", "claude"
)
```

### Response Processing

**Frontend (useChat)**:
```ts
channel.onmessage = (msg) => {
  if (msg.event === "Chunk") {
    contentAccumulated += msg.data.text;  // Assemble streaming text
    useChatStore.setState({ streamingContent: ... });
  } else if (msg.event === "ToolResult" && msg.data.tool === "write_file") {
    toolWritten = true;
    contentAccumulated = "";
    onOutputRef.current?.(stripFences(content));  // Call persistTheme()
  } else if (msg.event === "Done") {
    finalize(contentAccumulated, ...);
  }
}
```

### Files Generated

| Path | Content |
|------|---------|
| `projects/{id}/themes/{dir}/theme.css` | Raw CSS (via write_file tool) |
| `projects/{id}/themes/{dir}/prompt.json` | `{ "prompt": "...", "updated": "ISO timestamp" }` |
| `projects/{id}/themes/{dir}/chat.json` | Full chat history (persisted after each turn) |

### Preview & Display

- **Live preview**: React-Frame renders preview HTML with `<style>{parentCss + themeCss}</style>`
- **Device modes**: mobile (375px), tablet (768px), desktop (100%)
- **Dark/light toggle**: Wraps preview in `<div className={isDark ? "dark" : ""}>` to apply .dark CSS

### Modes & Branches

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Initial Generation** | Empty `css` → First user message | Uses `getThemeSystemPrompt()` |
| **Edit/Refine** | User sends message with existing theme | Same system prompt, chat history context |
| **Framework Switch** | User clicks "shadcn"/"daisy"/etc. | Rebuilds system prompt with new type docs |
| **Dark Mode Toggle** | Checkbox click | Appends dark mode suffix to system prompt on next generation |

### Inconsistencies Found

1. **System prompt is rebuilt every render** (line 69-74 in ThemesPanel.tsx):
   - Not memoized → wasteful re-construction
   - Risk of prompt drift if framework changes mid-stream

2. **persistTheme called without user confirmation**:
   - Called in `onOutput` callback automatically
   - No explicit "Save" button for themes (only "Save as" for new theme)
   - User might not realize theme is being persisted

3. **Missing error handling in persistTheme()**:
   - Error caught and notified, but doesn't prevent UI from showing unsaved state

---

## Components Generation Flow

### Entry Point: `ComponentsPanel.tsx`

**Key State:**
- `selectedComponent`: component ID
- `code`: component TSX code
- `themeCss`: loaded theme CSS (for context)
- `themes`: list of available themes

### System Prompt Construction

**Dual-mode prompt selection** (lines 51-59):

```tsx
const hasGeneratedCode = code.length > 0;
const defaultSystem = hasGeneratedCode
  ? getComponentUpdatePrompt(settings.iconLibrary, code) +  // ← EDIT MODE
    (themeCss ? `\n\nTHEME CSS VARIABLES — ...\n\`\`\`css\n${themeCss}\n\`\`\`` : "")
  : getComponentNewPrompt(settings.iconLibrary) +            // ← CREATE MODE
    (themeCss ? `\n\nTHEME CSS VARIABLES — ...\n\`\`\`css\n${themeCss}\n\`\`\`` : "");
const systemContent = settings.prompts["components-system"] || defaultSystem;
```

**New Component Prompt** (`src/lib/prompts.ts:100-129`):
```
"You are an expert React/TypeScript developer generating focused, reusable UI components.

This is a COMPONENT preview — NOT a full-page app generator. The preview area is max 400px wide.

TOOL USAGE — REQUIRED:
You MUST call the write_file tool...

CODE RULES:
- NO import statements of any kind — they will break the runtime.
- NO export keyword — just: function App() { ... }
- TypeScript types for all props and state. Never use `any`.
- Style with Tailwind classes and CSS variables...
- Keep it compact — the component must fit within 400px width.

GENERATE ONE FOCUSED COMPONENT:
- Button, badge, chip, toggle, switch, input field
- Card (product, profile, stat, feature)
- List item, menu item, navigation item, tab
- Small form (login, search, contact)
- Header section, sidebar section, modal content

DO NOT generate full pages, dashboards, multi-section layouts, or full-screen apps."
```

**Update Component Prompt** (lines 131-151):
```
"You are an expert React/TypeScript developer updating a focused UI component.

CRITICAL — Output the COMPLETE updated function — do NOT patch or diff.

CURRENT CODE — edit this code to apply the user's requested changes:
\`\`\`tsx
{currentCode}
\`\`\`"
```

**Icon Library Section** (injected):
- "lucide-react": `import { Home, User, ... } from "lucide-react"`
- "tabler": CSS font, `<i className="ti ti-home"></i>`
- "fontawesome", "bootstrap", "material": similar
- "none": text/emoji only

**Theme CSS Context** (injected if `themeCss` available):
```
THEME CSS VARIABLES — Use these exact CSS custom properties for all colors:
\`\`\`css
{themeCss}
\`\`\`
```

### Chat & Generation Flow

1. **User sends prompt** (e.g., "Create a button component with loading state")
2. **useChat.sendMessage()**:
   - First generation: uses `getComponentNewPrompt()`
   - Subsequent: uses `getComponentUpdatePrompt(currentCode)`
   - Includes theme CSS if `selectedTheme` is set

3. **IPC call** (same as themes):
   ```ts
   generateCompletionStream(
     model, messages, host, apiKey, channel,
     useThinking, outputPath, provider
   )
   ```
   - `outputPath`: `projects/{id}/components/{componentId}/component.tsx`

4. **Response handling**:
   ```ts
   onOutput: (content) => applyCode(content)
   ```
   - Calls `extractCode(content)` to strip fences
   - Saves to: `projects/{id}/generated/src/components/Generated.tsx`
   - Also saves to: `projects/{id}/components/{componentId}/component.tsx`
   - Invalidates React Query cache
   - Updates runner file tree nonce

### Save & Export

**Manual Save** (`SaveComponentModal`):
- Captures current code + messages
- Saves as new component with custom name
- Stores metadata (prompt, full chat history)

**Export** (`ComponentExportModal`):
- Can export as .zip with types, storybook, tests, or standalone TSX

### Preview System

```tsx
const Preview = useMemo(() => {
  if (!code) return null;
  return createPreviewComponent(code);  // Dynamic React component from code string
}, [code]);
```

- **Live preview** in an iframe with theme CSS + icon font CSS
- **Dark mode toggle** for preview
- **Device responsive preview** (mobile/tablet/desktop)
- Error boundary wraps preview to catch runtime errors

### Files Generated

| Path | Content |
|------|---------|
| `projects/{id}/components/{componentId}/component.tsx` | React component (via write_file) |
| `projects/{id}/components/{componentId}/chat.json` | Chat history |
| `projects/{id}/generated/src/components/Generated.tsx` | Copy of latest component |

### Modes & Branches

| Mode | Trigger | System Prompt |
|------|---------|---------------|
| **Create** | First message or new component | `getComponentNewPrompt()` |
| **Edit** | Message with existing code | `getComponentUpdatePrompt(code)` |
| **Theme Switch** | Change `selectedTheme` dropdown | Reloads `themeCss`, system prompt updated on next message |
| **With Theme Context** | Theme CSS injected | System prompt includes CSS variable documentation |
| **Without Theme** | No theme selected | System prompt omits CSS variable section |

### Inconsistencies Found

1. **System prompt changes mid-conversation**:
   - When user edits code in editor, `code` state changes
   - Next message generates system prompt using NEW code
   - Old messages in chat were responding to OLD system prompt
   - Risk: inconsistent context across turns

2. **No explicit mode indicator**:
   - Chat UI doesn't show user whether they're in "create" vs "edit" mode
   - Mode switches silently based on `code.length > 0`

3. **Theme CSS injection happens at message time**:
   - If user changes theme mid-conversation, old messages show old theme context
   - New system prompt references new theme, but chat history still has old one

4. **Save on blur** (lines 87-89):
   - `onBlur` on code editor triggers save
   - Could save incomplete/broken code

---

## Screens Generation Flow

### Entry Point: `ScreensPanel.tsx`

**Key State:**
- `screenId`: screen name
- `previewHtml`: TSX code for screen
- `themeCss`: loaded theme CSS
- `links`: navigation links between screens `[{ selector, target }, ...]`
- `screensDevice`: preview size (mobile/tablet/desktop)
- `screensZoom`: preview zoom level
- `screensLinkMode`: boolean (enable/disable link creation)

### System Prompt Construction

**Dual-mode selection** (lines 51-59):

```tsx
const hasGeneratedCode = previewHtml.length > 0;
const defaultSystem = hasGeneratedCode
  ? getScreenUpdatePrompt(settings.iconLibrary, previewHtml) +
    (themeCss ? `\n\nTHEME CSS VARIABLES — ...\n\`\`\`css\n${themeCss}\n\`\`\`` : "")
  : getScreenNewPrompt(settings.iconLibrary) +
    (themeCss ? `\n\nTHEME CSS VARIABLES — ...\n\`\`\`css\n${themeCss}\n\`\`\`` : "");
const systemContent = settings.prompts["screens-system"] || defaultSystem;
```

**New Screen Prompt** (`src/lib/prompts.ts:77-98`):
```
"You are an expert React/TypeScript developer. Generate a complete, production-quality UI screen.

TOOL USAGE — REQUIRED: You MUST call the write_file tool...

GLOBALS — DO NOT IMPORT ANY OF THESE, they are pre-loaded:
- React and all hooks: useState, useEffect, useRef, useMemo, useCallback...
- Lucide icons: any icon from lucide-react...

CODE RULES:
- NO import statements of any kind — they will break the runtime.
- NO export keyword — just: function App() { ... }
- TypeScript types for all props and state. Never use `any`.
- DESIGN FOR ALL SCREEN SIZES — responsive at 375px, 768px, and 1280px.
- Mobile-first Tailwind: use sm:, md:, lg: prefixes...
- Style with Tailwind classes and CSS variables...
- Do NOT hardcode hex or rgb colors — use CSS variables...
- Generate realistic content — real names, real data, no "Lorem ipsum".
- Do NOT wrap in HTML, DOCTYPE, html, head, or body tags."
```

**Update Screen Prompt** (lines 153-171):
```
"You are an expert React/TypeScript developer making surgical edits to a TSX screen.

CODE RULES:
- Output the COMPLETE updated function — do NOT patch or diff.
- NO import statements. NO export keyword. Function must be named App.
- Preserve ALL existing functionality and responsive design...
- Keep all existing hooks, state, and handlers intact.
- Apply ONLY the requested changes.
- TypeScript types throughout. Never use `any`.
- Use CSS variables for colors, not hardcoded hex/rgb values."
```

### Chat Flow

1. **User sends message** (e.g., "Create a login screen")
2. **useChat.sendMessage()**:
   - First generation: uses `getScreenNewPrompt()`
   - Subsequent: uses `getScreenUpdatePrompt(currentCode)`
   - Includes theme CSS if available

3. **IPC call**:
   ```ts
   generateCompletionStream(
     model, messages, host, apiKey, channel,
     useThinking, outputPath, provider
   )
   ```
   - `outputPath`: `projects/{id}/screens/{screenId}/screen.tsx`

4. **onOutput callback**:
   ```ts
   onOutput: (content) => {
     setPreviewHtml(content);
     createDir(screenPath.replace("/screen.tsx", ""))
       .then(() => writeFile(screenPath, content))
   }
   ```

### Navigation & Linking

**Link Mode** (lines 154-184):
- User clicks "Link Mode" toggle
- Then clicks buttons/links in preview
- `handlePreviewClick` captures selector + target screen
- Saves to: `projects/{id}/screens/{screenId}/screen.json`
  ```json
  { "links": [{ "selector": "button#login", "target": "dashboard" }] }
  ```

- In normal preview mode, clicking a linked element navigates to target screen
- Supports selector types: tag name, ID, class name, CSS selector

### Files Generated

| Path | Content |
|------|---------|
| `projects/{id}/screens/{screenId}/screen.tsx` | React screen component |
| `projects/{id}/screens/{screenId}/screen.json` | Navigation links metadata |
| `projects/{id}/screens/{screenId}/chat.json` | Chat history |

### Preview System

```tsx
const Preview = useMemo(() => {
  if (!previewHtml) return null;
  return createPreviewComponent(previewHtml);
}, [previewHtml]);
```

- **Live preview** in iframe with theme CSS + icon font CSS
- **Responsive sizing**: 375px (mobile), 768px (tablet), 100% (desktop)
- **Zoom control**: +/- buttons, displays zoom percentage
- **Device selector**: buttons to switch sizes

### Modes & Branches

| Mode | System Prompt | Behavior |
|------|---------------|----------|
| **Create** | `getScreenNewPrompt()` | Full screen generation |
| **Edit** | `getScreenUpdatePrompt(code)` | Surgical edits to existing screen |
| **With Theme** | Appends theme CSS context | Colors use CSS variables |
| **Link Mode** | N/A (UI only) | Click handlers configured for link creation |

### Export

```ts
const handleExport = async () => {
  const outputPath = await save({ filters: [{ name: "Zip", extensions: ["zip"] }] });
  await exportProject(settings.project, outputPath, "react", true, true, true, false);
}
```

- Exports all screens + themes + components as Vite React project

### Inconsistencies Found

1. **Same issue as Components**: system prompt changes mid-conversation based on code length
2. **Link mode is separate from generation**:
   - User must explicitly toggle "Link Mode" to create links
   - Linking doesn't feed back into generation prompts
   - Links are stored separately in `screen.json`, not in the code itself
3. **Export doesn't include chat history**:
   - Only exports code + themes + components, not the conversation context

---

## Workflows System

### Entry Point: `WorkflowsView.tsx`

**Workflow Builder Features:**
- Drag-and-drop node canvas (powered by React Flow)
- 18+ built-in node types + custom nodes
- Execution engine with topological sort + parallel branch support
- Undo/redo stack
- Save/load workflows

### Node Types & AI Invocation

**Nodes that trigger AI** (lines 350-388):

| Node Type | System Prompt | Behavior |
|-----------|---------------|----------|
| `requirements` | Custom or default: "Extract and structure requirements..." | Streams AI response |
| `architect` | "Create a high-level architecture plan." | Streams AI response |
| `structure` | "Generate HTML/JSX. Output only code." | Streams AI response |
| `style` | "Apply Tailwind CSS. Output only code." | Streams AI response |
| `interaction` | "Add React hooks and state. Output only code." | Streams AI response |
| `reference` | "Analyze component references..." | Streams AI response |
| `transform` | "Transform the content per instruction..." | Streams AI response |
| `validate` | "Validate code for errors. If valid, say 'Valid'." | Streams AI response |
| `custom` | User-defined prompt | Streams AI response |

**Other Node Types:**
- `input`: passes prompt as output
- `output`: passes previous output through
- `parallel`: forks execution into branches
- `composition`: merges inputs from multiple branches
- `bash`: runs shell command
- `fetch`: makes HTTP request
- `fileop`: reads/writes files
- `auth`: builds auth headers
- `designSystem`: loads theme CSS
- `preview`: renders HTML
- `bun`: runs `bun dev` or `bun build`

### Execution Engine

**Algorithm** (lines 291-425):

1. **Topological Sort**:
   - Computes in-degree for each node
   - Enqueues nodes with in-degree 0
   - Processes in order, decrementing in-degree of successors

2. **Parallel Branch Handling**:
   ```ts
   if (nType === "parallel") {
     await execNode(nodeId);  // Execute parallel node
     await Promise.all(adj.get(nodeId)!.map(async (childId) => {
       for (const bid of findBranch(childId)) {
         if (!done.has(bid)) { await execNode(bid); done.add(bid); }
       }
     }));
     await checkComp();  // Check for ready composition nodes
   }
   ```

3. **Composition Node Handling**:
   - Waits for all predecessor nodes to finish
   - Then merges outputs with `\n\n---\n\n` separator

### AI Invocation in Workflows

```ts
const streamAI = async (msgs: Message[]): Promise<string> => {
  const channel = new Channel<CompletionEvent>();
  let acc = "";
  channel.onmessage = (msg) => {
    if (msg.event === "Chunk") {
      acc += msg.data.text;
      updateStatus(nodeId, { output: acc.slice(0, 500) });  // Show first 500 chars
    }
  };
  await generateCompletionStream(
    model, msgs, host, apiKey, channel,
    undefined, undefined, settings.provider as Provider
  );
  return acc;
};

const ai = (sys: string, user: string) =>
  streamAI([
    { role: "system", content: sys },
    { role: "user", content: user }
  ]);
```

**Key difference from Panels**:
- **NO `outputPath` parameter** → agent loop is NOT triggered
- Plain streaming mode only
- No multi-turn tool calling
- Useful for analysis/composition workflows, not for code generation

### Custom Prompts

Users can override default prompts via `settings.prompts`:
- `"workflow-requirements-system"`
- `"workflow-architect-system"`
- `"workflow-style-system"`
- etc.

Example (line 353):
```ts
output = await ai(
  customPrompts["workflow-requirements-system"] || "Extract and structure requirements...",
  prevOut || promptBase
);
```

### Save/Load/Delete

**Storage Path**:
- `projects/{projectId}/workflows/{workflowId}.json`
- Contains serialized nodes and edges

**Data Structure**:
```json
{
  "nodes": [
    { "id": "n1", "type": "workflow", "position": {...}, "data": {...} }
  ],
  "edges": [
    { "id": "e1-2", "source": "n1", "target": "n2", "type": "smoothstep" }
  ]
}
```

### Inconsistencies Found

1. **No tool calling in workflows**:
   - Workflows can only stream text, cannot write files
   - Limits their utility for code generation pipelines

2. **Output truncated to 500 chars**:
   - Node display shows only first 500 characters
   - Full output discarded after node completes

3. **No context passing between custom nodes**:
   - Each node has `prevOut` (previous node's output)
   - But composition nodes merge outputs with `---` separator
   - No way to pass structured data between nodes (JSON serialization workaround needed)

4. **Prompts are hardcoded defaults**:
   - If custom prompt not found in `settings.prompts`, falls back to default
   - No easy way to edit prompts in UI (must edit settings directly)

---

## Rust Backend & Agent Loop

### IPC Layer (`src-tauri/src/lib.rs`)

**Two main generation functions**:

#### 1. `generate_completion` (non-streaming)

```rust
#[tauri::command]
async fn generate_completion(
  model: String,
  messages: Vec<Message>,
  host: String,
  api_key: String,
  provider: String,
  app: AppHandle,
) -> Result<String, AppError>
```

- Returns full response at once
- **No tool calling, no agent loop**
- Used for non-critical tasks

#### 2. `generate_completion_stream` (streaming)

```rust
#[tauri::command]
async fn generate_completion_stream(
  model: String,
  messages: Vec<Message>,
  host: String,
  api_key: String,
  on_event: Channel<CompletionEvent>,
  think: Option<bool>,
  output_path: Option<String>,
  provider: String,
  app: AppHandle,
) -> Result<(), AppError>
```

- Streams response via Channel
- **If `output_path` is set**: triggers agent loop (tool calling)
- **If `output_path` is None**: plain streaming mode
- Supports thinking (extended thinking) for Ollama models
- Supports voice/vision for providers that offer it

### Provider Routing (`lib.rs:722-749`)

```rust
match provider.as_str() {
  "ollama" => {
    generate_ollama_completion_stream(
      &host, &model, &messages, &api_key,
      think, output_path.as_deref(), &app_data, &on_event,
    ).await.map(|_| String::new())
  }
  "openai" => {
    if api_key.is_empty() { return Err(...); }
    chat_completion_openai(client, &api_key, &model, &messages, true, Some(&on_event)).await
  }
  "claude" => {
    if api_key.is_empty() { return Err(...); }
    chat_completion_claude(client, &api_key, &model, &messages, true, Some(&on_event)).await
  }
  _ => Err(AppError::Http("Unsupported provider".into())),
}
```

**Provider-specific behavior**:
- **Ollama**: Only provider supporting agent loop (multi-turn tool calling)
- **OpenAI**: Plain streaming only (no tools)
- **Claude**: Plain streaming only (no tools)

### Agent Loop (`src-tauri/src/agent/agent_loop.rs`)

**Entry point**: `run_agent_loop()` (called when `output_path` is set for Ollama)

**Flow**:

```rust
pub async fn run_agent_loop(
  ollama: &Ollama,
  model: &str,
  initial_messages: Vec<OllamaChatMessage>,
  think: Option<bool>,
  app_data_dir: &Path,
  output_path: &str,
  channel: &Channel<CompletionEvent>,
) -> Result<(), AppError>
```

1. **Initialize**:
   - Build tools (write_file, read_file, bash)
   - Create chat request with tools attached
   - Set up history buffer

2. **Multi-turn loop** (max 10 iterations):
   ```rust
   for iteration in 0..MAX_ITERATIONS {
     // Call stream_turn() → get model output + tool calls
     let tool_calls = stream_turn(ollama, history, request, channel).await?;
     
     if tool_calls.is_empty() {
       break;  // Model produced text only, done
     }
     
     // Execute each tool call
     for call in &tool_calls {
       let result = execute_tool(&call.function.name, &call.function.arguments, ...);
       history.push(OllamaChatMessage::tool(result.output));
     }
     
     // If write_file was called: closing turn (no tools) to generate summary
     if wrote_file {
       let closing_turn = ChatMessageRequest::new(...);  // No tools
       stream_turn(ollama, history, closing_turn, channel).await?;
       break;
     }
     
     // Otherwise: continue with tools
     request = ChatMessageRequest::new(...).tools(tools);
   }
   ```

3. **Tool Results sent to channel**:
   ```rust
   channel.send(CompletionEvent::ToolResult {
     tool: name.clone(),
     success: result.success,
     output: result.output,
     path: path_opt,
     content: result.written_content,
   })?;
   ```

4. **Closing turn** (if write_file was called):
   - Final turn with no tools attached
   - Forces model to produce natural language summary instead of more tool calls

### Tool Executor (`src-tauri/src/agent/executor.rs`)

**Available tools**:

#### write_file
```json
{
  "path": "relative/path/to/file.tsx",  // Optional; defaults to output_path
  "content": "raw source code..."        // Required; NOT JSON-wrapped
}
```

**Execution**:
- Resolves path relative to app data dir
- Blocks `..` path traversal
- Creates parent directories
- Writes content directly (no JSON parsing)
- Returns: `ToolExecutionResult { success: bool, output: "Written: ...", written_path: Some(...), written_content: Some(...) }`

#### read_file
```json
{
  "path": "relative/path/to/file.tsx"
}
```

**Execution**:
- Reads file content as UTF-8 string
- Returns: `ToolExecutionResult { success: bool, output: file_contents, ... }`

#### bash
```json
{
  "command": "ls -la src/"
}
```

**Execution**:
- Spawns `sh -c "{command}"` in project directory
- 30-second timeout
- Captures stdout + stderr
- Returns: `ToolExecutionResult { success: out.status.success(), output: "stdout\nstderr", ... }`

### Tool Definition Schema (`src-tauri/src/agent/tools.rs`)

Uses schemars to generate JSON Schema from Rust types:

```rust
pub fn build_tools() -> Vec<ToolInfo> {
  vec![
    ToolInfo {
      tool_type: ToolType::Function,
      function: ToolFunctionInfo {
        name: "write_file".to_string(),
        description: "Write raw source code to a file...",
        parameters: make_schema::<WriteFileArgs>(),  // ← JSON Schema generated from struct
      },
    },
    // ... read_file, bash
  ]
}
```

Ollama's native tool calling uses these schemas to constrain model output.

### Streaming Event Types

```rust
#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data")]
enum CompletionEvent {
  Chunk { text: String, thinking: Option<String> },
  ToolCall { tool: String, args: serde_json::Value },
  ToolResult { tool: String, success: bool, output: String, path: Option<String>, content: Option<String> },
  Done,
  Error { message: String },
}
```

**Frontend receives**:
1. `Chunk` events as model streams text/thinking
2. `ToolCall` when model requests tool execution
3. `ToolResult` after tool executes (includes written content for display)
4. `Done` when agent loop completes
5. `Error` on failure

---

## Settings & Model Configuration

### Settings Store (`src/stores/appStore.ts`)

**Interface**:
```ts
interface Settings {
  view: string;                    // "screens" | "components" | "themes" | "workflows"
  modelId: string;                 // e.g., "gemma4-26b-128k:latest"
  project: string;                 // active project ID
  stylePreset: string;             // selected theme name
  dark: boolean;
  accent: string;                  // oklch color
  editorTheme: string;
  tweaks: Record<string, unknown>;
  prompts: Record<string, string>; // override system prompts
  styles: Array<{ name: string; value: string }>;
  host: string;                    // API host (http://localhost:11434)
  apiKeys: Record<string, string>; // { "ollama": "...", "openai": "...", "claude": "..." }
  provider: Provider;              // "ollama-local" | "ollama-cloud" | "openai" | "claude"
  glow: "off" | "subtle" | "full";
  amoled: boolean;
  iconLibrary: IconLibrary;        // "lucide" | "tabler" | "fontawesome" | "bootstrap" | "material" | "none"
  layout: Record<string, number[]>;
}
```

**Persistence**:
- Stored in Tauri plugin-store (persists across sessions)
- Loaded on app startup
- Synchronized across all components via Zustand

### Model Capabilities (`src/hooks/useModelCapabilities.ts`)

Determines what features are available for selected model:

```ts
interface ModelCapabilities {
  thinking: boolean;   // Extended thinking support
  tools: boolean;      // Tool calling support
  vision: boolean;     // Image understanding
  loading: boolean;
}
```

**Detection mechanism** (inferred from model family + provider):
- Ollama models: queried via `/api/show`, checks `capabilities` array
- OpenAI: hardcoded feature matrix (GPT-4V has vision, o1 has thinking)
- Claude: hardcoded feature matrix

### Icon Library Configuration

**Available libraries** (`src/lib/prompts.ts:4-22`):
- **lucide**: React component imports
- **tabler**: CSS icon font
- **fontawesome**: CSS icon font
- **bootstrap**: CSS icon font
- **material**: CSS icon font
- **none**: no icons

**Prompt sections** auto-generated per library:
- Example imports/usage patterns
- Common icon names
- CSS class format

**CSS loading** (`src/lib/preview.tsx`):
- For CSS-based icons: font file loaded via `@import` or `<link>`
- For React icons: component pre-imported in sandbox

---

## Inconsistencies & Issues

### 1. **Prompt Mutation During Conversation** (High Priority)

**Problem**: System prompt changes mid-conversation based on component state:

```tsx
// ComponentsPanel.tsx, lines 51-59
const hasGeneratedCode = code.length > 0;
const defaultSystem = hasGeneratedCode
  ? getComponentUpdatePrompt(settings.iconLibrary, code)
  : getComponentNewPrompt(settings.iconLibrary);
const systemContent = settings.prompts["components-system"] || defaultSystem;
```

**Scenario**:
1. User generates component (code = empty → uses `getComponentNewPrompt()`)
2. User sends message 1
3. Frontend receives code, updates `code` state
4. User sends message 2
5. System prompt now uses `getComponentUpdatePrompt(code)` with NEW code
6. Message 2 gets different system prompt than message 1
7. Chat history is inconsistent

**Impact**: Model may give contradictory advice between turns

**Fix**:
- Lock system prompt once first generation completes
- Only change on explicit "Edit Mode" button click
- Pass mode as explicit parameter, not derived from code length

---

### 2. **Theme Persistence — Auto-Save to App Data Dir** (Clarified — Not a Bug)

**Original concern**: `ThemesPanel.tsx` persists theme automatically in `onOutput` without user confirmation.

**Clarification (2026-04-26)**: This is intentional design. Themes are written to the **Tauri app data directory** (`~/.local/share/prototyper/projects/{id}/themes/{dir}/theme.css`), which is completely separate from the `generated/` Vite project folder the Runner watches. That is why themes do not appear in the Runner's file explorer — they are project assets, not runtime files. The auto-save behaviour mirrors how components and screens work (`outputPath` triggers the agent loop's `write_file` call automatically).

**Remaining concern** (still valid): the `onOutput` callback in the theme panel calls `persistTheme` on every streamed output event, meaning a partially-streamed CSS is written to disk before generation completes. If the user manually edits the editor mid-stream, the next `onOutput` call will overwrite their edit with the model's latest partial output.

**File locations**:
- App data themes: `~/.local/share/prototyper/projects/{id}/themes/{dir}/theme.css`
- Runner Vite project: `~/.local/share/prototyper/projects/{id}/generated/` ← separate, themes not here

---

### 3. **No Tool Calling in Workflows** (Medium Priority)

**Problem**: Workflows use plain streaming, not agent loop:

```tsx
// WorkflowsView.tsx, line 345
await generateCompletionStream(
  model, msgs, host, apiKey, channel,
  undefined, undefined, settings.provider as Provider
  // ↑ No outputPath parameter
);
```

**Impact**:
- Workflow nodes cannot call `write_file` tool
- Cannot generate files as part of workflow execution
- Limits usefulness for code generation pipelines

**Fix**:
- Add `outputPath` parameter for generation nodes
- Enable agent loop in workflows
- Store workflow node outputs in project directory

---

### 4. **Theme CSS Injected at Message Time** (Low Priority)

**Problem**: Theme CSS context changes mid-conversation:

```tsx
// ComponentsPanel.tsx, lines 116-131
useEffect(() => {
  if (!selectedTheme) {
    setThemeCss("");
    return;
  }
  // Load theme CSS asynchronously
  readFile(`projects/${settings.project}/themes/${selectedTheme}/theme.css`)
    .then(css => setThemeCss(css));
}, [selectedTheme, settings.project]);
```

**Scenario**:
1. User generates component with "light" theme
2. User switches theme to "dark"
3. User sends message 2
4. Message 2 has "dark" theme CSS, but message 1 had "light"
5. Chat history is inconsistent

**Impact**: Model sees different CSS variables across turns

**Fix**:
- Capture theme CSS at message-send time
- Store with each message in chat history
- Or: lock theme during conversation

---

### 5. **Provider Support Asymmetry** (Not a Priority — Ollama is the target)

**Note (2026-04-26)**: The user has confirmed Ollama is the primary and intended provider. OpenAI and Claude support is secondary. This issue is deprioritised — no action required.

**Documented for reference**: Only Ollama triggers the agent loop (`output_path` is honoured). OpenAI and Claude receive plain streaming with `output_path` silently ignored. This is acceptable given the Ollama-first design decision.

---

### 6. **Editor Save Timing Issue** (Low Priority)

**Problem**: Code editor saves on blur:

```tsx
// ComponentsPanel.tsx, lines 87-89
const handleCodeBlur = useCallback(() => {
  saveCode(code);
}, [code, saveCode]);
```

**Issue**:
- User can lose work if editor crashes before blur
- No visual indication that code is being saved
- Could save incomplete/broken code

**Fix**:
- Auto-save with debounce (e.g., 2 seconds after last change)
- Show "Saving..." indicator
- Only save syntactically valid code

---

### 7. **Workflow Output Truncation** (Low Priority)

**Problem**: Workflow node output truncated to 500 chars:

```tsx
// WorkflowsView.tsx, line 344
updateStatus(nodeId, { output: acc.slice(0, 500) });
updateStatus(nodeId, { status: "done", output: output.slice(0, 500) });
```

**Impact**:
- Long outputs are silently truncated
- User cannot see full output in node UI
- Full output is discarded (not stored)

**Fix**:
- Store full output in node data
- Show expandable detail view for long outputs
- Or: auto-truncate with "..." indicator + copy button

---

### 8. **Missing Error Context in Prompts** (Medium Priority)

**Problem**: Component/Screen prompts don't include error history:

```tsx
// No error feedback mechanism
onOutput: (content) => applyCode(content)
```

**Issue**:
- If generated code has errors (syntax, runtime), user must manually edit
- Model doesn't learn from its own errors
- No "fix this error" prompt variant

**Fix**:
- Capture preview errors (syntax errors, runtime crashes)
- Send error messages back to model in next turn
- Example system suffix: "Previous code had error: {error}. Fix it."

---

### 9. **No Type Consistency Check** (Low Priority)

**Problem**: Component/Screen code can have type errors, but not validated:

```tsx
// No TypeScript checking
const Preview = useMemo(() => {
  if (!code) return null;
  return createPreviewComponent(code);  // Just evals code
}, [code]);
```

**Impact**:
- Component might have runtime type errors
- User doesn't know until they see broken preview
- Model can be asked to fix, but without structured feedback

**Fix**:
- Pass code through TypeScript compiler (in worker thread)
- Collect type errors
- Send to model: "Previous code had type error at line 42: {error}"

---

### 10. **Inconsistent Prompt Customization** (Low Priority)

**Problem**: Prompt override mechanism exists but is undiscovered:

```tsx
// Users can override prompts via settings.prompts object
const systemContent = settings.prompts["themes-system"] || defaultSystem;
const systemContent = settings.prompts["components-system"] || defaultSystem;
```

**Issue**:
- No UI to edit custom prompts
- Users must manually edit settings file
- No documentation

**Fix**:
- Add "Edit Prompts" modal accessible from panels
- Show current (default or custom) prompt
- Allow inline editing
- Validate prompt syntax (contains "user", reasonable length, etc.)

---

## Summary: Generation Flow Diagram

```
USER INPUT (Panel or Workflow)
    ↓
SYSTEM PROMPT CONSTRUCTION
├─ Base prompt (from prompts.ts)
├─ Framework/mode-specific suffix
├─ Theme CSS context (optional)
├─ Custom prompt override (if set in settings)
└─ Icon library section
    ↓
CHAT ASSEMBLY
├─ [{ role: "system", content: systemPrompt }]
├─ [... previousMessages (with thinking, images if present) ...]
├─ [{ role: "user", content: userInput }]
└─ [{ role: "assistant", content: "" }] (placeholder)
    ↓
IPC CALL: generateCompletionStream()
├─ model: settings.modelId
├─ messages: assembled messages
├─ host: resolved from provider
├─ apiKey: resolved from provider
├─ think: if (caps.thinking && thinkEnabled)
├─ outputPath: if code generation needed
├─ provider: "ollama-local" | "openai" | "claude"
└─ channel: Channel<CompletionEvent>
    ↓
RUST BACKEND ROUTING
├─ Provider: ollama
│  ├─ output_path NOT set → plain streaming
│  └─ output_path SET → agent loop (multi-turn tool calling)
├─ Provider: openai | claude
│  └─ plain streaming (output_path ignored)
└─ Unknown provider → error
    ↓
AGENT LOOP (if output_path set, Ollama only)
├─ Initialize: chat request + tools (write_file, read_file, bash)
├─ MAX 10 iterations:
│  ├─ stream_turn(): get model output + tool calls
│  ├─ If no tool calls → break
│  ├─ Execute tool calls (write_file, read_file, bash)
│  ├─ Add tool results to history
│  ├─ If write_file called:
│  │  ├─ Emit ToolResult event (with content)
│  │  ├─ Execute closing turn (no tools, forces text summary)
│  │  └─ break
│  └─ Otherwise: continue with tools
└─ Emit Done event
    ↓
STREAMING EVENTS TO FRONTEND
├─ Chunk { text, thinking }
├─ ToolCall { tool, args }
├─ ToolResult { tool, success, output, content, path }
├─ Done
└─ Error { message }
    ↓
FRONTEND ASSEMBLY (useChat)
├─ Accumulate text chunks
├─ Capture thinking content
├─ Listen for write_file ToolResult
├─ Extract content from ToolResult
├─ Call onOutput(content) callback
└─ Save final message + thinking to chat.json
    ↓
PANEL CALLBACK (onOutput)
├─ Themes: persistTheme() → save theme.css + prompt.json
├─ Components: applyCode() → save component.tsx + update preview
├─ Screens: similar to components
└─ Workflows: not applicable (no outputPath)
    ↓
UI UPDATE
├─ Preview rendered with new content
├─ Chat message added to history
├─ File saved to disk
└─ User sees result
```

---

## Appendix: File Locations

### Source Files
- `/home/m/Desktop/Prototyper/src/panels/ThemesPanel.tsx` (420 lines)
- `/home/m/Desktop/Prototyper/src/panels/ComponentsPanel.tsx` (408 lines)
- `/home/m/Desktop/Prototyper/src/panels/ScreensPanel.tsx` (332 lines)
- `/home/m/Desktop/Prototyper/src/lib/ipc.ts` (264 lines)
- `/home/m/Desktop/Prototyper/src/lib/prompts.ts` (344 lines)
- `/home/m/Desktop/Prototyper/src/hooks/useChat.ts` (412 lines)
- `/home/m/Desktop/Prototyper/src/workflows/WorkflowsView.tsx` (1000+ lines)
- `/home/m/Desktop/Prototyper/src/stores/appStore.ts` (147 lines)

### Rust Backend
- `/home/m/Desktop/Prototyper/src-tauri/src/lib.rs` (1169 lines)
- `/home/m/Desktop/Prototyper/src-tauri/src/agent/mod.rs` (6 lines)
- `/home/m/Desktop/Prototyper/src-tauri/src/agent/agent_loop.rs` (158 lines)
- `/home/m/Desktop/Prototyper/src-tauri/src/agent/tools.rs` (58 lines)
- `/home/m/Desktop/Prototyper/src-tauri/src/agent/executor.rs` (193 lines)

---

## Report Metadata

- **Audit Date**: 2026-04-26
- **Auditor**: AI Code Exploration Agent
- **Thoroughness**: Complete (all relevant files read)
- **Total Lines Reviewed**: ~4,200
- **Generated**: 2026-04-26
