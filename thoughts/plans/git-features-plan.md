# Git Source Control Integration

## Context

Prototyper currently has no version control integration — users editing generated app code in the Runner panel have no way to see what changed, stage/commit, view history, or sync with a remote, all of which Cursor/VS Code provide as core workflow. This adds a VS Code/Cursor-style "Source Control" experience: a new **Git tab** in the left sidebar (alongside Project/Files/Chats) for staging, committing, diffing, history, and remote sync, plus **inline diff gutters** in the CodeMirror editor showing changed lines vs HEAD. New projects get `git init` automatically during scaffolding.

**Key simplification**: `git` is already in `ALLOWED_SHELL_COMMANDS` (`src-tauri/src/commands/process.rs:7`) and `run_shell_command_capture` (wrapped as `runShellCommandCapture(cwd, command)` in `src/lib/ipc.ts`) is already registered. **No new Rust commands, Cargo deps, or capability changes are needed** — everything is implemented by shelling out to `git` from the frontend, with `cwd = projects/${settings.project}`.

Approved scope:
- Sidebar "Git" tab (4th tab, icon `GitBranch`)
- Stage/unstage/discard + commit, diff viewer, commit history, fetch/pull/push + combined Sync button
- Inline editor diff gutters (added/modified/deleted markers vs HEAD)
- No branch create/switch/merge UI in v1 (just display current branch name + ahead/behind)
- New projects get `git init` + `.gitignore` + initial commit during scaffolding; existing projects without `.git` show an "Initialize Repository" prompt

---

## Phase 0 — Dependency

- `bun add diff` — promote the existing transitive dep (v8.0.4) to a direct dependency; used for `diffLines()` in the gutter extension.

---

## Phase 1 — Git data layer (`src/lib/git/`)

New directory, barrel-exported via `src/lib/git/index.ts`, mirroring `src/lib/markdown/`.

**`types.ts`**: `GitFileStatus { path, origPath?, indexStatus, worktreeStatus }`, `GitStatus { isRepo, branch, upstream, ahead, behind, staged[], unstaged[], untracked[] }`, `GitCommit { hash, shortHash, author, date, subject }`, `DiffHunkLine { type: "add"|"remove"|"context"|"meta", content, oldLineNo?, newLineNo? }`, `DiffFile { oldPath, newPath, hunks }`.

**`shellQuote.ts`**: `quotePath(path)` — POSIX single-quote escaping (`'` → `'\''`) so paths with spaces survive `shlex::split` in `run_shell_command_capture`.

**`repo.ts`**:
- `isGitRepo(cwd)` → `git rev-parse --is-inside-work-tree`, true if stdout contains `"true"`.
- `initRepo(cwd)` → `git init`, plus write a `.gitignore` (node_modules/, dist/, .DS_Store, etc.) if absent.

**`status.ts`**:
- `getStatus(cwd)` → `git status --porcelain=v2 --branch -z`, parse NUL-delimited output:
  - `# branch.head <name>`, `# branch.upstream <name>`, `# branch.ab +N -M`
  - `1 <XY> ... <path>` (ordinary), `2 <XY> ... <path>\0<origPath>` (rename/copy — consumes extra NUL field), `? <path>` (untracked), `!` (ignored, skip)
  - Bucket by X (staged) / Y (unstaged) status chars; a path can appear in both `staged` and `unstaged` if partially staged (matches VS Code).

**`diff.ts`**:
- `getUnstagedDiff(cwd, path)` → `git diff -- ` + `quotePath(path)`
- `getStagedDiff(cwd, path)` → `git diff --cached -- ` + quoted path
- `getUntrackedDiff(cwd, path)` → synthesize an all-added pseudo-diff by reading the file via `readFile` (git doesn't diff untracked files by default)
- `getCommitDiff(cwd, hash)` → `git show <hash>`
- `getFileAtHead(cwd, relPath)` → `git show HEAD:<relPath>`; if output contains `fatal:`/`does not exist`/`exists on disk, but not in`, return `""` (new file)
- `parseUnifiedDiff(diffText)` → `DiffFile[]`, handling `diff --git`, `@@ -a,b +c,d @@` hunk headers, `+`/`-`/` ` line prefixes with line-number tracking, and `\ No newline at end of file` as a meta line. Binary diffs (`Binary files ... differ`) → flagged so the viewer shows a placeholder instead of parsing.

**`staging.ts`**:
- `stageFile(cwd, path)` → `git add -- <quoted>`; `stageAll(cwd)` → `git add -A`
- `unstageFile(cwd, path)` → `git restore --staged -- <quoted>`; `unstageAll(cwd)` → `git restore --staged .`
- `discardFile(cwd, path, isUntracked)` → tracked: `git checkout -- <quoted>`; untracked: `deleteFile(`${cwd}/${path}`)`
  - Note: coding-standards.md's "never `git checkout`/discard" rule governs Claude's own workflow on *this* repo, not a user-facing discard feature for the *target project* repo — no conflict.

**`commit.ts`**:
- `commit(cwd, message)`: write message to `${cwd}/.prototyper-commit-msg.tmp` via `writeFile`, run `git commit -F .prototyper-commit-msg.tmp`, delete the temp file in a `finally`. Inspect output for failure patterns (`"nothing to commit"`, `"fatal:"`) and throw `Error(output)` so `useMutation`'s `onError` fires.

**`log.ts`**:
- `getLog(cwd, limit=50)` → `git log -n <limit> --pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e`, split records on `\x1e` / fields on `\x1f`
- `formatRelativeDate(iso)` — small local helper ("2 hours ago"), no new date lib

**`remote.ts`**:
- `fetch/pull/push(cwd)` → `git fetch`/`git pull`/`git push`
- `sync(cwd)` → fetch, then pull, then push (VS Code "Sync Changes" semantics)
- `detectGitError(output)` → scans for `fatal:`, `error:`, `CONFLICT`, `Authentication failed`, `Permission denied`, `rejected`, returns a human message or `null` (since `capture_command_output` never throws on non-zero exit)

---

## Phase 2 — React Query integration

**`src/lib/queryKeys.ts`** — add:
```ts
export const gitKeys = {
  isRepo:    (p: string) => ["git", p, "isRepo"] as const,
  status:    (p: string) => ["git", p, "status"] as const,
  log:       (p: string) => ["git", p, "log"] as const,
  diff:      (p: string, path: string, staged: boolean) => ["git", p, "diff", path, staged] as const,
  commitDiff:(p: string, hash: string) => ["git", p, "commit", hash] as const,
  fileAtHead:(p: string, path: string) => ["git", p, "head", path] as const,
};
```

**`src/hooks/useGitStatus.ts`**: `useGitStatus(project)`, `useGitLog(project, enabled)`, `useGitDiff(project, path, staged)`, `useFileAtHead(project, relPath)` — standard `useQuery` wrappers, short `staleTime` (~5s), no polling.

**`src/hooks/useGitMutations.ts`**: `useStageFile/useUnstageFile/useStageAll/useUnstageAll/useDiscardFile/useCommit/useFetch/usePull/usePush/useSync/useInitRepo`. Each invalidates `gitKeys.status(project)` on success via `notify.success`/`notify.error` (from `@/hooks/useToast`, using `getErrorMessage`). `useCommit` also invalidates `gitKeys.log`. `usePull`/`useSync` also invalidate all `gitKeys.fileAtHead` entries via a predicate (HEAD content changed → gutters must refresh).

Invalidate `gitKeys.status(project)`:
- When the Git tab becomes active (`useEffect` on `activeTab === "git"`)
- After every mutation above
- After file save in the Runner editor (hook into existing `handleSaveFile`)

---

## Phase 3 — SidebarGitTab UI

New directory `src/components/sidebar/git/`:

- **`SidebarGitTab.tsx`** (container, ~150-200 lines): `cwd = projects/${settings.project}`. Queries `isGitRepo`; if false → `<GitEmptyState onInit={useInitRepo}/>`. If true → `useGitStatus` + internal "Changes"/"History" view toggle (two-button strip, simplest given no branch UI), renders `GitStatusHeader`, `GitChangesSection` (staged), `GitChangesSection` (unstaged+untracked), `GitCommitBox`, and manages `diffTarget` state for `GitDiffDialog`.
- **`GitEmptyState.tsx`**: "Initialize Repository" prompt + button (per user: should be rare since scaffolding now runs `git init`, but covers existing/imported projects).
- **`GitStatusHeader.tsx`**: branch name, ahead/behind badges, and per user's choice: a combined **Sync** button plus separate **Fetch/Pull/Push** icon buttons (all via `useFetch/usePull/usePush/useSync`), each with a loading spinner state.
- **`GitChangesSection.tsx`**: shared list renderer for staged vs. unstaged+untracked, with header-level "Stage all"/"Unstage all" actions.
- **`GitFileRow.tsx`**: status badge (M/A/D/R/U, VS Code color convention), filename, stage/unstage/discard buttons, click → opens diff dialog.
- **`GitCommitBox.tsx`**: textarea + Commit button, disabled when `staged.length === 0` or message is empty; uses `useCommit`.
- **`src/lib/git/statusLabels.ts`**: status-code → label/color mapping (M=amber "Modified", A=green "Added", D=red "Deleted", R=purple "Renamed", U=red "Conflict", `?`=green "U").

**`SidebarRail.tsx`** changes:
- `type SidebarTab = "project" | "files" | "chats" | "git"`
- Add `{ id: "git", icon: GitBranch, color: "text-orange-500", title: "Git" }` to `TABS` (import `GitBranch` from `lucide-react`)
- Add `{activeTab === "git" && <div className="flex-1 overflow-hidden"><SidebarGitTab /></div>}`

---

## Phase 4 — Diff viewer (`GitDiffDialog.tsx`)

- Props: `{ open, onOpenChange, cwd, path, staged, isUntracked? }`. Fetches diff via `useGitDiff` or `getUntrackedDiff`.
- `Dialog`/`DialogContent` (`max-w-3xl`, `max-h-[80vh]`), title = file path.
- Extract a shared **`DiffHunkView.tsx`** that renders `DiffFile[]` from `parseUnifiedDiff` — `+` lines green-tinted, `-` lines red-tinted, context muted, hunk headers (`@@...@@`) as small separators, binary files show a placeholder. Reused by Phase 5.

---

## Phase 5 — Commit history (`GitHistoryView.tsx`)

- `useGitLog(project, isRepo)`, list rows (short hash, subject, author + relative date), "Load more" bumps `limit`.
- Click a commit → diff dialog using `getCommitDiff(cwd, hash)` + `DiffHunkView` (multi-file diffs render per-file sections).

---

## Phase 6 — Inline editor diff gutters

**`src/lib/git/gutter.ts`**: stable, single-instance CodeMirror extension using a `StateField<DecorationSet>` + `StateEffect` pair:
- `gitGutterEffect: StateEffect<{from:number,to:number,type:"add"|"modify"|"remove"}[]>`
- `gitGutterField: StateField<DecorationSet>` — empty initially, updated by the effect
- `gitGutterExtension = [gitGutterField, gutter({ class: "cm-git-gutter", markers: (view) => view.state.field(gitGutterField) })]` — exported as a **module-level constant** so it's a stable reference for `CodeMirrorEditor`'s `extraExtensions` `useMemo` dep array (avoids extension churn on every keystroke).
- `GutterMarker` subclasses: added (green bar), modified (blue/amber bar), removed (red notch on adjacent line, since CM gutters can't render between lines).

**Wiring in `RunnerPanel`/`RunnerEditor`**:
- `useFileAtHead(settings.project, relPath)` where `relPath = activeTabPath.replace(`projects/${settings.project}/`, "")`
- Add a `viewRef` (CodeMirrorEditor already supports this prop) and pass `extraExtensions={[gitGutterExtension]}`
- `useEffect` on `[headContent.data, tabContents[activeTabPath]]`: compute `diffLines(headContent, currentContent)` from the `diff` package, map to gutter ranges, dispatch via `view.dispatch({ effects: gitGutterEffect.of(ranges) })`
- If not a git repo, `getFileAtHead` calls will fail gracefully (caught/treated as no-op) and gutters simply show nothing — consistent with "always git-init on scaffold" plus the empty-state prompt for the rare exception.

**CSS**: add `.cm-git-gutter` rules to `src/styles/globals.css` (or a small co-located stylesheet) for the added/modified/removed markers.

---

## Phase 7 — Project scaffolding: auto `git init`

**`src/modals/ProjectManagerModal.tsx`** (`createProject`, ~lines 109-145) and/or `src/lib/scaffold.ts`:
- After all initial files are written and `scaffoldGenerated()` completes (so `generated/node_modules` exists), run:
  1. `runShellCommandCapture(projectPath, "git init")`
  2. Write a `.gitignore` (via `writeFile`) covering `generated/node_modules/`, `generated/dist/`, `.DS_Store`, etc. — must exist **before** `git add -A` to avoid committing `node_modules`
  3. `runShellCommandCapture(projectPath, "git add -A")`
  4. `commit(projectPath, "Initial project scaffold")` (reuse Phase 1's `commit()`)
- Failures here should not block project creation — wrap in try/catch and `notify.error` only (project is still usable without git).

---

## Verification

1. `bun run tsc --noEmit` clean after each phase.
2. `bun run tauri:dev`:
   - Create a new project → confirm `.git`, `.gitignore`, and an initial commit exist; Git tab shows clean status with correct branch name.
   - Edit + save a file in Runner → gutter shows "modified" marker; Git tab "Changes" shows it as Modified after invalidation.
   - Add a new file → untracked badge; gutter shows all-green.
   - Stage/unstage individual files and "all"; discard a modified file (reverts content) and an untracked file (deletes it).
   - Commit with a message containing quotes/newlines (tests the temp-file approach) → appears in History with correct relative time.
   - Click a History entry → commit diff renders (multi-file if applicable).
   - With a configured remote: Fetch/Pull/Push/Sync update ahead/behind badges; pull updates gutters via `fileAtHead` invalidation.
   - Without a remote: push/pull/sync surface a friendly error toast via `detectGitError`, no crash.
   - On a pre-existing project without `.git`: Git tab shows "Initialize Repository"; clicking it creates `.git` and the tab populates.
3. Check new file sizes (`wc -l`) stay under coding-standards.md limits; split further if needed.
