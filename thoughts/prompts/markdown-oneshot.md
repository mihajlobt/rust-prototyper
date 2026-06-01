# Tauri Markdown Editor with Live Preview

Build a native markdown editor desktop application using Tauri 2.x with React TypeScript.

## Workflow
1. `/plan` — Plan component breakdown and architecture
2. `/tdd` — Write tests for each component before implementation
3. Implement each phase with tests
4. `/code-review` — Review Rust + React integration
5. `/verify` — Run tests and verify build produces .exe/.app/.AppImage

## Tech Stack

- **Backend**: Tauri 2.x (Rust) + tauri-plugin-dialog
- **Frontend**: React 18+ with TypeScript + Vite
- **UI Library**: shadcn/ui (built on Radix UI)
- **Layout**: Allotment (resizable split panes)
- **Editor**: @uiw/react-codemirror (CodeMirror 6 wrapper)
- **Markdown Parsing**: unified() with remark-parse + remark-gfm + remark-rehype + rehype-stringify
- **Syntax Highlighting**: rehype-highlight (highlight.js for preview code blocks)
- **State Management**: Zustand
- **Styling**: Tailwind CSS + @tailwindcss/typography
- **Toasts**: sonner

## Core Features Required

### 1. Split-Pane Layout
- Use Allotment to create a resizable, draggable divider between editor and preview
- Persist panel sizes in localStorage
- Minimum pane size: 300px
- Smooth resize animations

### 2. Editor Panel (Left)
- CodeMirror 6 as the core editor with markdown syntax highlighting
  - Use `@codemirror/lang-markdown` with `@codemirror/language-data` for nested code blocks
  - Automatic syntax highlighting for headings, bold, italic, code blocks, links
  - Language detection for code blocks (JavaScript, Python, JSON, HTML, CSS, etc.)
- Theme: `@uiw/codemirror-theme-one-dark` for dark mode, custom light theme matching GitHub
- Line numbers enabled by default
- Word wrap support
- Tab indentation: 4 spaces
- Real-time line/column position indicator

#### Editor Toolbar (above CodeMirror):
- **Bold** button (wraps selection with `**text**`)
- **Italic** button (wraps selection with `*text*`)
- **Code** button (wraps selection with backticks)
- **Heading** dropdown (H1-H6 with # prefix)
- **Unordered List** button (inserts `- ` prefix)
- **Ordered List** button (inserts `1. ` prefix)
- **Link** button (inserts `[text](url)`)
- **Image** button (inserts `![alt](url)`)
- **Blockquote** button (inserts `> ` prefix)
- **Code Block** button (wraps in triple backticks with language)
- **Undo/Redo** buttons

#### Keyboard Shortcuts:
| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd + S | Save file |
| Ctrl/Cmd + N | New file |
| Ctrl/Cmd + O | Open file |
| Ctrl/Cmd + B | Bold selection |
| Ctrl/Cmd + I | Italic selection |
| Ctrl/Cmd + K | Insert link |
| Ctrl/Cmd + / | Toggle comment |
| Ctrl/Cmd + H | Find & Replace |
| Ctrl/Cmd + Tab | Next tab |
| Ctrl/Cmd + Shift + Tab | Previous tab |

### 3. Preview Panel (Right)
- Real-time markdown rendering as user types
- Use unified() pipeline: remark-parse → remark-gfm → remark-rehype → rehype-highlight → rehype-stringify
- GFM (GitHub Flavored Markdown) support:
  - Tables
  - Strikethrough
  - Footnotes
  - Task lists
  - Autolinks
- Syntax highlighting for code blocks via highlight.js
- Responsive typography using Tailwind Typography (`prose` classes)
- Dark/light theme affects preview styles
- Debounce rendering: 300ms delay during typing

### 4. File Management

#### New:
- Create blank document in memory
- Clear editor content
- Reset file path to "[Untitled]"
- Show unsaved indicator

#### Open:
- Native file picker via `tauri-plugin-dialog`
- Filter: `.md`, `.markdown`, `.txt`
- Load content into new tab
- Update tab title with filename

#### Save:
- If file has path: write directly to disk
- If "[Untitled]": prompt "Save As" dialog
- Clear unsaved indicator on success
- Show toast notification

#### Save As:
- Open file picker in save mode
- Allow custom filename and location
- Update current file path

### 5. Auto-Save
- Save to app data directory every 30 seconds if document is unsaved
- Toggle in settings to enable/disable
- Recovery on app restart if crash detected
- Store in: `{app_data_dir}/autosave/`

### 6. Multi-Tab Support
- Tab bar above editor for multiple open files
- Each tab shows: filename + unsaved indicator (*)
- Close tab with X button or middle-click
- Prompt save confirmation on close if unsaved
- Persist open tabs in localStorage
- Ctrl+Tab / Ctrl+Shift+Tab to switch

### 7. UI Components (shadcn/ui)

#### Top Toolbar (Menu Bar):
- **File Menu**: New, Open, Save, Save As, Recent Files (submenu), Exit
- **Edit Menu**: Undo, Redo, Find & Replace, Cut, Copy, Paste
- **View Menu**: Toggle Theme (Light/Dark), Zoom In/Out, Reset Zoom, Word Count
- **Help Menu**: Keyboard Shortcuts (modal), About

#### Header Bar:
- Current file name (or "[Untitled]")
- Unsaved indicator (red dot or asterisk)
- File size display

#### Status Bar (Bottom):
- Current file path
- Line and column position
- Word/character count
- Encoding: UTF-8

#### Dialogs:
- Save Confirmation: "File has unsaved changes. Save before closing?"
- Keyboard Shortcuts: Modal showing all shortcuts
- Settings: Font size, tab size, auto-save toggle, theme

### 8. Settings Panel
- Font size adjustment (10-18px)
- Tab size selection (2 or 4 spaces)
- Theme preference (persistent)
- Auto-save toggle
- Word wrap toggle

## Dependencies

### Frontend (package.json)
```json
{
  "@tauri-apps/api": "^2.0.0",
  "@tauri-apps/plugin-dialog": "^2.0.0",
  "@tauri-apps/plugin-fs": "^2.0.0",
  "react": "^18.3.0",
  "react-dom": "^18.3.0",
  "typescript": "^5.4.0",
  
  "@uiw/react-codemirror": "^4.21.0",
  "@codemirror/lang-markdown": "^6.2.0",
  "@codemirror/language-data": "^6.4.0",
  "@codemirror/state": "^6.4.0",
  "@codemirror/view": "^6.24.0",
  "@codemirror/commands": "^6.3.0",
  "@codemirror/search": "^6.5.0",
  "@uiw/codemirror-theme-one-dark": "^4.21.0",
  
  "unified": "^11.0.0",
  "remark-parse": "^11.0.0",
  "remark-gfm": "^4.0.0",
  "remark-rehype": "^11.1.0",
  "rehype-stringify": "^10.0.0",
  "rehype-highlight": "^7.0.0",
  "rehype-sanitize": "^6.0.0",
  
  "allotment": "^1.20.0",
  "zustand": "^4.5.0",
  "sonner": "^1.4.0",
  "lucide-react": "^0.400.0",
  "clsx": "^2.1.0",
  "tailwind-merge": "^2.2.0"
}
```

### Backend (Cargo.toml)
```toml
[dependencies]
tauri = { version = "2.0", features = [] }
tauri-plugin-dialog = "2.0"
tauri-plugin-fs = "2.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1", features = ["full"] }
chrono = { version = "0.4", features = ["serde"] }
```

## Project Structure
```
src/
├── components/
│   ├── Editor.tsx              # CodeMirror wrapper
│   ├── Preview.tsx             # Markdown preview panel
│   ├── Toolbar.tsx             # Main file/edit/view menu toolbar
│   ├── EditorToolbar.tsx       # Inline markdown formatting buttons
│   ├── TabBar.tsx              # Multi-tab management
│   ├── Tab.tsx                 # Individual tab component
│   ├── StatusBar.tsx           # Line/col/word count info
│   ├── HeaderBar.tsx           # Current file info & unsaved indicator
│   ├── Settings.tsx            # Settings panel
│   ├── FindReplace.tsx          # Find & Replace modal
│   ├── KeyboardShortcuts.tsx   # Shortcuts reference modal
│   └── ui/                     # shadcn/ui components
│       ├── button.tsx
│       ├── dropdown-menu.tsx
│       ├── dialog.tsx
│       ├── separator.tsx
│       ├── tooltip.tsx
│       └── toaster.tsx
├── lib/
│   ├── markdown.ts             # unified() pipeline
│   ├── editor-commands.ts      # CodeMirror command definitions
│   └── tauri.ts                # IPC wrappers for Rust commands
├── hooks/
│   ├── useEditor.ts            # Editor state & content
│   ├── useFile.ts              # File operations
│   ├── useTheme.ts             # Theme persistence
│   ├── useTabs.ts              # Tab state management
│   ├── useAutoSave.ts          # Auto-save hook
│   └── useSettings.ts          # Settings state
├── stores/
│   └── editorStore.ts           # Zustand store
├── types/
│   └── index.ts                # TypeScript interfaces
├── styles/
│   └── globals.css             # Tailwind + custom styles
├── App.tsx                     # Main layout with Allotment
└── main.tsx                    # React entry point
```

## Key Implementation Notes

### 1. Tauri Dialog Plugin Setup
```rust
// Cargo.toml
tauri-plugin-dialog = "2.0"
tauri-plugin-fs = "2.0"

// lib.rs
use tauri_plugin_dialog::DialogExt;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(...)
}
```

### 2. CodeMirror in React
```tsx
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@uiw/codemirror-theme-one-dark';
import { EditorView } from '@codemirror/view';

<CodeMirror
  value={content}
  theme={oneDark}
  extensions={[
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    EditorView.lineWrapping,
  ]}
  onChange={(value) => handleChange(value)}
/>
```

### 3. Markdown Pipeline
```tsx
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';

const renderMarkdown = async (markdown: string): Promise<string> => {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeHighlight)
    .use(rehypeSanitize)  // Prevent XSS
    .use(rehypeStringify)
    .process(markdown);
  
  return String(result);
};
```

### 4. Allotment Layout
```tsx
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';

<Allotment>
  <Allotment.Pane minSize={300}>
    <Editor />
  </Allotment.Pane>
  <Allotment.Pane minSize={300}>
    <Preview />
  </Allotment.Pane>
</Allotment>
```

### 5. Zustand Store for Tabs
```tsx
import { create } from 'zustand';

interface Tab {
  id: string;
  filename: string;
  path: string | null;
  content: string;
  isDirty: boolean;
}

interface EditorState {
  tabs: Tab[];
  activeTabId: string;
  settings: {
    theme: 'light' | 'dark';
    fontSize: number;
    tabSize: number;
    autoSave: boolean;
    wordWrap: boolean;
  };
  // Actions
  addTab: (tab: Tab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabContent: (id: string, content: string) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tabs: [{ id: '1', filename: 'Untitled', path: null, content: '', isDirty: false }],
  activeTabId: '1',
  settings: { theme: 'dark', fontSize: 14, tabSize: 4, autoSave: true, wordWrap: true },
  addTab: (tab) => set((state) => ({ tabs: [...state.tabs, tab] })),
  closeTab: (id) => set((state) => ({ tabs: state.tabs.filter(t => t.id !== id) })),
  setActiveTab: (id) => set({ activeTabId: id }),
  updateTabContent: (id, content) => set((state) => ({
    tabs: state.tabs.map(t => t.id === id ? { ...t, content, isDirty: true } : t)
  })),
}));
```

## Acceptance Criteria

- [ ] App launches without errors on Windows/macOS/Linux
- [ ] Split pane resizes smoothly with minSize=300px constraint
- [ ] Panel sizes persist across sessions in localStorage
- [ ] Markdown syntax highlighting works in editor (headings, bold, italic, code, links)
- [ ] Code blocks in editor support nested syntax for JS, Python, HTML, CSS, JSON
- [ ] Live preview renders GFM correctly (tables, strikethrough, tasklists, footnotes)
- [ ] Code blocks in preview have syntax highlighting
- [ ] File open dialog filters .md/.txt/.markdown files
- [ ] File save writes UTF-8 without BOM
- [ ] Auto-save triggers every 30s when enabled and document is dirty
- [ ] Auto-save recovery works on app restart
- [ ] Multi-tab: can open multiple files in tabs
- [ ] Tab switching via clicks and Ctrl+Tab
- [ ] Close tab prompts save if unsaved
- [ ] Theme toggle switches both editor and preview themes
- [ ] Keyboard shortcuts all function correctly
- [ ] Status bar shows line, column, word count
- [ ] Settings panel persists to localStorage
- [ ] Build produces working .exe/.app/.AppImage
- [ ] No console errors or warnings on startup
- [ ] Files up to 10MB load without freezing

## Security Requirements

- Validate file paths to prevent path traversal attacks
- Only allow .md/.txt/.markdown extensions in dialog filters
- Sanitize markdown output with rehype-sanitize to prevent XSS
- Escape HTML in editor content display
- Do not execute arbitrary code from file content

## Performance Requirements

- Debounce markdown rendering: 300ms delay during typing
- Memoize Preview component with React.memo
- Lazy-load heavy dependencies (CodeMirror languages)
- Use useMemo for editor extensions
- Support files up to 10MB without UI freeze
- Auto-save runs in background without blocking UI

## Testing Requirements

- Unit tests for markdown.ts pipeline
- Integration tests for file operations (mock Tauri invoke)
- Verify all keyboard shortcuts trigger correct behavior
- Test with files up to 10MB for performance
- Test auto-save creates files in correct location
- Test tab close with unsaved changes shows confirmation
- Test theme toggle persists across restarts