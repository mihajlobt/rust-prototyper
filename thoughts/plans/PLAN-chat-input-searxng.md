# Plan: Chat Input Allotment Refinements + SearXNG Config Scaffold

## Context

The uncommitted diff refactors 5 chat panels to use vertical `Allotment` panes
for the message list / input split, swaps the chat textarea for a shadcn
`Textarea`, and expands the SearXNG setup instructions. The 11 findings from
the code review were discussed in chat; the user accepted/rejected each one,
resulting in the decisions below.

- **#1 field-sizing**: drop the `field-sizing-normal` override — let
  shadcn's `field-sizing-content` work, the Allotment pane caps the max.
- **#2 SearXNG scaffold**: yes, button-driven config writer, no copy-paste
  of `echo` commands. Released-app path = app data dir.
- **#3 min chat height**: bump `preferredSize` 120 → 180, `maxSize` 300 → 400.
  No layout rewrite (Send button is not visually clipped per user).
- **#4 use class**: use `.chat-input-pane` in Wizard/Planner for consistency.
- **#6 useAllotmentLayout contract**: skip.
- **#7 zero-size guard**: pre-existing, skip.
- **#8 font size**: lock to 14px on the chat textarea.
- **#9 EOF newline**: done in the original diff.
- **#10 .gitignore + released-app path**: add `.searxng/` to `.gitignore`.
  Released-app config lives in `<appDataDir>/.searxng/`.
- **#11 thoughts doc**: leave untracked.

- **#1 field-sizing**: drop the `field-sizing-normal` override — let
  shadcn's `field-sizing-content` work, the Allotment pane caps the max.
- **#2 SearXNG scaffold**: yes, button-driven config writer, no copy-paste
  of `echo` commands. Released-app path = app data dir.
- **#3 min chat height**: bump `preferredSize` 120 → 180, `maxSize` 300 → 400.
  No layout rewrite (Send button is not visually clipped per user).
- **#4 use class**: use `.chat-input-pane` in Wizard/Planner for consistency.
- **#6 useAllotmentLayout contract**: skip.
- **#7 zero-size guard**: pre-existing, skip.
- **#8 font size**: lock to 14px on the chat textarea.
- **#9 EOF newline**: done in the original diff.
- **#10 .gitignore + released-app path**: add `.searxng/` to `.gitignore`.
  Released-app config lives in `<appDataDir>/.searxng/`.
- **#11 thoughts doc**: leave untracked.

## Files Changed

### 1. `src/components/chat/ChatInput.tsx` (line 170)

Remove `field-sizing-normal` (no-op), add `text-sm` to lock to 14px:

```tsx
className="flex-1 min-h-0 resize-none border-0 focus-visible:ring-0"
```

### 2. `src/panels/wizard/WizardChatPanel.tsx` (line 119)

Replace inline classes with the shared class:

```tsx
<div className="chat-input-pane">
```

### 3. `src/panels/plans/PlannerChat.tsx` (line 123)

Same as above.

### 4. `src/panels/{Theme,Components,Screens,Planner,Wizard}ChatPanel.tsx`

Five files, each one `Allotment.Pane` line:

```diff
- <Allotment.Pane minSize={80} maxSize={300} preferredSize={120}>
+ <Allotment.Pane minSize={120} maxSize={400} preferredSize={180}>
```

- Theme: `src/panels/ThemeChatPanel.tsx:129`
- Components: `src/panels/components/ChatPanel.tsx:187`
- Screens: `src/panels/screens/ScreensChatPanel.tsx:141`
- Wizard: `src/panels/wizard/WizardChatPanel.tsx:118`
- Planner: `src/panels/plans/PlannerChat.tsx:122`

### 5. `src-tauri/src/commands/http.rs` — new command

Add after `test_searxng_connection` (line 97):

```rust
/// Write a minimal SearXNG settings.yml under `<app_data_dir>/.searxng/`
/// with `search.formats: [html, json]` enabled. Returns the absolute path
/// to the file so the UI can interpolate it into the docker run command.
#[tauri::command]
pub async fn setup_searxng_config(app: AppHandle) -> Result<String, String> {
    let base = crate::app_data_dir(&app).map_err(|e| e.to_string())?;
    let dir = base.join(".searxng");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let path = dir.join("settings.yml");
    let content = "use_default_settings: true\n\
                   \n\
                   search:\n  \
                   formats:\n    \
                   - html\n    \
                   - json\n";
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().to_string())
}
```

The `app_data_dir` helper already exists in `src-tauri/src/lib.rs:38` (used
by `src-tauri/src/commands/ai_ollama.rs:8` and `src-tauri/src/commands/fs.rs:2`).
It's not currently `pub` from `lib.rs` to the `commands` module — check
visibility in step 1 of execution.

### 6. `src-tauri/src/lib.rs` (line 175) — register the command

```diff
             commands::http::test_searxng_connection,
+            commands::http::setup_searxng_config,
```

### 7. `src/lib/ipc.ts` — add the wrapper

After the existing `testSearxng` (search for `test_searxng_connection`):

```ts
/** Writes a minimal SearXNG settings.yml under appDataDir/.searxng/ with
 *  JSON format enabled. Returns the absolute path to the file. */
export async function setupSearxngConfig(): Promise<string> {
  return invoke<string>("setup_searxng_config");
}
```

### 8. `src/modals/settings/AITab.tsx` — UI

Replace the manual `echo` recipe (lines 105-117) with:

- A `Create default config` button next to the URL field.
- After clicking, the absolute path is shown in a copy-to-clipboard block.
- The `docker run` command is shown with that path interpolated, also
  copy-to-clipboard.
- Drop the prose-style "JSON format must be enabled" paragraph (replaced
  by the button + auto-generated config).

Layout sketch:

```tsx
<Button size="sm" variant="outline" onClick={handleSetup}>
  Create default config
</Button>
{searxngConfigPath && (
  <div className="text-[11px] text-muted-foreground font-mono bg-muted rounded px-2 py-1 select-all whitespace-pre">
    {`Mount this path in your docker run command:\n${searxngConfigPath}`}
  </div>
  <p className="text-[11px] text-muted-foreground">docker run:</p>
  <p className="text-[11px] text-muted-foreground font-mono bg-muted rounded px-2 py-1 select-all whitespace-pre">
    {`docker run -d -p 8080:8080 -e BASE_URL=/ \\\n  -v ${searxngConfigPath}:/etc/searxng:rw \\\n  --name searxng --restart=unless-stopped \\\n  searxng/searxng`}
  </p>
)}
```

The `whitespace-pre` class preserves the newlines, and the entire block
is `select-all` so the user can copy in one go.

### 9. `.gitignore` — exclude the dev test config

```
# Local SearXNG test config (matches the AITab "Create default config" workflow)
.searxng/
```

## Verification

1. `bunx tsc --noEmit` → exit 0.
2. `bun run tauri:dev` (or `bun tauri dev`) — manual check:
   - All 5 chat panels render with the chat input draggable between 120
     and 400 px, defaulting to 180.
   - Send button is visible at the default 180px height.
   - Textarea is 14px text (matches old `text-sm`).
3. In Settings → AI → Web Search, click "Create default config". Verify:
   - File is written to `<appDataDir>/.searxng/settings.yml` (check via
     terminal: `ls -la "$(tauri path)"` or by reading the path back).
   - The `docker run` command shown in the UI has the exact same path
     interpolated (copy it, paste it into a terminal, the volume mount
     resolves to the file the button just created).
   - Click "Test" after starting the container — should pass.
4. `git status` — `.searxng/` should not appear.
