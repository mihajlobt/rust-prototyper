// Header, Sidebar, and all generator/library panels.
const { useState: uS, useEffect: uE, useMemo: uM, useRef: uR } = React;

// Shared prompt-inspector state
function useInspector() {
  const [open, setOpen] = uS(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}

// ─────────────────────────────────────────────────────────────
const CODE_THEMES = [
  { id: 'monokai', label: 'Neon' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'nord', label: 'Nord' },
  { id: 'material', label: 'Material' },
  { id: 'ayu-dark', label: 'Ayu' },
  { id: 'vibrant-ink', label: 'Vibrant' },
  { id: 'moxer', label: 'Moxer' },
];

// CodeMirror wrapper
function CodeMirrorEditor({ value, mode, readOnly = true, theme, style }) {
  const ref = uR(null);
  const cmRef = uR(null);
  uE(() => {
    if (!ref.current || typeof CodeMirror === 'undefined') return;
    cmRef.current = CodeMirror(ref.current, {
      value: value || '',
      mode: mode || 'javascript',
      theme: theme || 'monokai',
      readOnly: readOnly,
      lineNumbers: true,
      lineWrapping: true,
      scrollbarStyle: 'null',
      viewportMargin: Infinity,
    });
    return () => { cmRef.current?.toTextArea?.(); };
  }, []);
  uE(() => {
    if (cmRef.current && theme) cmRef.current.setOption('theme', theme);
  }, [theme]);
  return <div ref={ref} style={{ fontSize: 12, flex: 1, minHeight: 0, ...style }}/>;
}

// ─────────────────────────────────────────────────────────────
// Style preset dropdown — short prompts injected into generation
function StylePresetPicker({ value, onChange }) {
  const [open, setOpen] = uS(false);
  const presets = [
    { id: 'auto', name: 'Auto', icon: 'cpu', prompt: '' },
    { id: 'glass', name: 'Glassmorphism', icon: 'sparkles', prompt: 'Use glassmorphism with translucent frosted-glass surfaces, subtle backdrop blur, and thin light borders.' },
    { id: 'minimal', name: 'Minimal', icon: 'grid', prompt: 'Use a minimal, clean aesthetic with ample whitespace, thin typography, and restrained color usage.' },
    { id: 'neon', name: 'Neon', icon: 'zap', prompt: 'Use a neon cyberpunk aesthetic with high-contrast dark backgrounds, vibrant glowing accents, and sharp edges.' },
    { id: 'paper', name: 'Paper', icon: 'file', prompt: 'Use a tactile paper/skeuomorphic aesthetic with soft shadows, realistic textures, and warm muted tones.' },
  ];
  const rootRef = uR(null);
  uE(() => {
    if (!open) return;
    const h = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button className="pill mono" onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', border: open ? '1px solid var(--acc)' : undefined }}>
        <Icons.layers size={11} style={{ color: 'var(--fg-mute)', marginRight: 4 }}/>
        {value || 'Auto'} <Icons.chevD size={10} style={{ opacity: .6 }}/>
      </button>
      {open && (
        <div className="mp-pop" style={{ minWidth: 180 }}>
          {presets.map(p => {
            const Ic = Icons[p.icon];
            return (
              <button key={p.id} className="mp-row" data-on={value === p.name} onClick={() => { onChange?.(p.name); setOpen(false); }}>
                <Ic size={12}/>
                <span style={{ fontSize: 11 }}>{p.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Host URL picker dropdown
function HostPicker() {
  const [open, setOpen] = uS(false);
  const [host, setHost] = uS('localhost:11434');
  const [input, setInput] = uS('');
  const rootRef = uR(null);
  uE(() => {
    if (!open) return;
    setInput(host);
    const h = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const save = () => { if (input.trim()) setHost(input.trim()); setOpen(false); };
  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button className="pill mono" onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', border: open ? '1px solid var(--acc)' : undefined }}>
        <span className="sdot sdot--ok"/> <Icons.cpu size={11}/> {host}
      </button>
      {open && (
        <div className="mp-pop" style={{ minWidth: 220, padding: 10 }}>
          <div className="caps" style={{ fontSize: 9, marginBottom: 6 }}>Ollama Host</div>
          <input
            className="input mono"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            autoFocus
            placeholder="host:port"
            style={{ width: '100%', fontSize: 11 }}
          />
          <div className="row gap-2" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
            <button className="btn" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--acc" style={{ padding: '4px 8px', fontSize: 11 }} onClick={save}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Prompt config modal
function PromptConfigModal({ open, onClose }) {
  const [tab, setTab] = uS('component');
  const prompts = {
    component: `You are Prototyper's component generator. Output a single React/TSX function component using Tailwind v4. Library: shadcn/ui, lucide, motion, radix.`,
    screen: `You are Prototyper's screen generator. Output a single React/TSX screen as a default export. Use Tailwind v4 class names. Do not import icons — use inline SVG.`,
    theme: `You are a design system expert. Generate a CSS theme using OKLCH color tokens. Output Tailwind v4 compatible CSS variables with a cohesive palette.`,
  };
  const [texts, setTexts] = uS(prompts);
  if (!open) return null;
  return (
    <div className="pi-backdrop" onClick={onClose}>
      <div className="pi-drawer" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div className="pi-head">
          <div className="col">
            <div className="pi-title">Prompt Templates</div>
            <div className="pi-sub">Edit the system prompts sent to the model for each generator</div>
          </div>
          <div style={{ flex: 1 }}/>
          <div className="seg">
            {['component','screen','theme'].map(t => <button key={t} data-on={tab === t} onClick={() => setTab(t)}>{t}</button>)}
          </div>
          <button className="icon-btn" onClick={onClose}><Icons.x size={13}/></button>
        </div>
        <div className="pad-4 col gap-3" style={{ flex: 1, overflow: 'auto' }}>
          <div className="caps">System prompt — {tab}</div>
          <textarea
            className="textarea mono"
            rows={10}
            value={texts[tab]}
            onChange={(e) => setTexts({ ...texts, [tab]: e.target.value })}
          />
          <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setTexts(prompts)}><Icons.zap size={11}/> Reset defaults</button>
            <button className="btn btn--acc" onClick={onClose}><Icons.check size={12}/> Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Export modal
function ExportModal({ open, onClose }) {
  const [format, setFormat] = uS('react-vite');
  const [routing, setRouting] = uS('react-router');
  const [include, setInclude] = uS({ apis: true, theme: true, components: true, tests: false });
  if (!open) return null;
  return (
    <div className="pi-backdrop" style={{ justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div className="card" style={{ width: 520, maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div className="pi-head" style={{ borderBottom: '1px solid var(--line-soft)', flexShrink: 0 }}>
          <div className="col">
            <div className="pi-title">Export Project</div>
            <div className="pi-sub">Bundle screens, links, APIs and theme into a runnable app</div>
          </div>
          <div style={{ flex: 1 }}/>
          <button className="icon-btn" onClick={onClose}><Icons.x size={13}/></button>
        </div>
        <div className="pad-4 col gap-4" style={{ overflow: 'auto', flex: 1 }}>
          <div>
            <div className="caps" style={{ marginBottom: 6 }}>Framework</div>
            <div className="seg" style={{ flexWrap: 'wrap' }}>
              {[
                { id: 'react-vite', label: 'React + Vite' },
                { id: 'next', label: 'Next.js' },
                { id: 'astro', label: 'Astro' },
                { id: 'tanstack', label: 'TanStack Start' },
              ].map(f => (
                <button key={f.id} data-on={format === f.id} onClick={() => setFormat(f.id)}>{f.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="caps" style={{ marginBottom: 6 }}>Routing</div>
            <div className="seg">
              {[
                { id: 'react-router', label: 'React Router' },
                { id: 'file-based', label: 'File-based' },
                { id: 'hash', label: 'Hash' },
              ].map(r => <button key={r.id} data-on={routing === r.id} onClick={() => setRouting(r.id)}>{r.label}</button>)}
            </div>
          </div>
          <div>
            <div className="caps" style={{ marginBottom: 6 }}>Include</div>
            <div className="col gap-2">
              {[
                { key: 'apis', label: 'API clients & hooks', desc: 'Fetch wrappers from saved APIs' },
                { key: 'theme', label: 'Theme tokens', desc: 'OKLCH CSS variables + Tailwind config' },
                { key: 'components', label: 'Shared components', desc: 'Reusable components from library' },
                { key: 'tests', label: 'Smoke tests', desc: 'Basic Playwright or Vitest scaffolding' },
              ].map(item => (
                <label key={item.key} className="row gap-2" style={{ alignItems: 'flex-start', padding: 8, borderRadius: 8, background: 'var(--n-1)', border: '1px solid var(--line-soft)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={include[item.key]} onChange={(e) => setInclude({ ...include, [item.key]: e.target.checked })}/>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{item.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--fg-mute)' }}>{item.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="hair"/>
          <div className="col gap-2">
            <div className="caps">Output preview</div>
            <pre className="code-pane mono" style={{ fontSize: 11, padding: 10, borderRadius: 8, background: 'var(--n-1)' }}>{`src/
  screens/
    Dashboard.tsx
    Orders.tsx
    OrderDetail.tsx
  components/
    LoginCard.tsx
    Sidebar.tsx
  api/
    useCustomers.ts
    useOrders.ts
  theme/
    tokens.css
  App.tsx
  main.tsx`}</pre>
          </div>
        </div>
        <div className="pad-4 row gap-2" style={{ borderTop: '1px solid var(--line-soft)', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--acc"><Icons.file size={12}/> Export {format}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Project manager modal
function ProjectManagerModal({ open, onClose, project, setProject }) {
  const [projects, setProjects] = uS(() => {
    try {
      const saved = localStorage.getItem('pt.projects');
      if (saved) return JSON.parse(saved);
      return [
        { id: 'default', name: 'Default Project', updated: 'Just now' },
        { id: 'p2', name: 'E-commerce App', updated: '2h ago' },
        { id: 'p3', name: 'Portfolio Site', updated: '1d ago' },
      ];
    } catch { return [{ id: 'default', name: 'Default Project', updated: 'Just now' }]; }
  });
  const [draft, setDraft] = uS(project);

  uE(() => { localStorage.setItem('pt.projects', JSON.stringify(projects)); }, [projects]);
  uE(() => { setDraft(project); }, [project, open]);

  const saveCurrent = () => {
    setProject(draft);
    setProjects(ps => {
      const exists = ps.find(p => p.name === project);
      if (exists) {
        return ps.map(p => p.name === project ? { ...p, name: draft, updated: 'Just now' } : p);
      }
      return [{ id: 'p' + Date.now(), name: draft, updated: 'Just now' }, ...ps];
    });
  };

  const loadProject = (name) => { setProject(name); onClose(); };

  const deleteProject = (id, name) => {
    setProjects(ps => ps.filter(p => p.id !== id));
    if (name === project) { setProject('Default Project'); }
  };

  const createNew = () => {
    const name = 'New Project';
    const id = 'p' + Date.now();
    setProjects(ps => [{ id, name, updated: 'Just now' }, ...ps]);
    setProject(name);
    setDraft(name);
  };

  if (!open) return null;
  return (
    <div className="pi-backdrop" style={{ justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div className="card" style={{ width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div className="pi-head" style={{ borderBottom: '1px solid var(--line-soft)', flexShrink: 0 }}>
          <div className="col">
            <div className="pi-title">Project Manager</div>
            <div className="pi-sub">Save, load and manage your prototypes</div>
          </div>
          <div style={{ flex: 1 }}/>
          <button className="icon-btn" onClick={onClose}><Icons.x size={13}/></button>
        </div>
        <div className="pad-4 col gap-3" style={{ overflow: 'auto', flex: 1 }}>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <div className="caps">Current</div>
            <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1 }}/>
            <button className="btn btn--acc" onClick={saveCurrent}><Icons.save size={12}/> Save</button>
          </div>
          <div className="hair"/>
          <div className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="caps">Projects</div>
            <button className="btn" onClick={createNew}><Icons.plus size={12}/> New</button>
          </div>
          <div className="col gap-1">
            {projects.map(p => (
              <div key={p.id} className="row gap-2" style={{ padding: '8px 10px', borderRadius: 8, background: p.name === project ? 'var(--acc-soft)' : 'var(--n-1)', alignItems: 'center', cursor: 'pointer', transition: 'background .12s' }} onClick={() => loadProject(p.name)}>
                <Icons.folder size={14} style={{ color: 'var(--fg-mute)', flexShrink: 0 }}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--fg-mute)' }}>{p.updated}</div>
                </div>
                {p.name === project ? (
                  <span className="pill pill--acc" style={{ fontSize: 9 }}>active</span>
                ) : (
                  <button className="icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteProject(p.id, p.name); }}><Icons.trash size={12}/></button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="pad-4 row gap-2" style={{ borderTop: '1px solid var(--line-soft)', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Header
function Header({ activeView, setActiveView, project, setProject, status, openSettings, modelId, setModelId, stylePreset, setStylePreset }) {
  const tabs = [
    { id: 'screens',    label: 'Screens',    icon: 'grid' },
    { id: 'components', label: 'Components', icon: 'cube' },
    { id: 'themes',     label: 'Themes',     icon: 'palette' },
    { id: 'workflows',  label: 'Workflows',  icon: 'flow' },
    { id: 'apis',       label: 'APIs',       icon: 'send' },
    { id: 'library',    label: 'Library',    icon: 'folder' },
    { id: 'runner',     label: 'Run',        icon: 'play' },
  ];
  const [showProjectManager, setShowProjectManager] = uS(false);
  return (
    <div className="hdr">
      <div className="row gap-3" style={{ paddingLeft: 12 }}>
        <div className="hdr-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M4 6 L12 2 L20 6 L20 18 L12 22 L4 18 Z" stroke="var(--acc)" strokeWidth="1.5"/>
            <path d="M4 6 L12 10 L20 6 M12 10 L12 22" stroke="var(--acc)" strokeWidth="1.5" opacity=".6"/>
          </svg>
        </div>
        <div className="hdr-wordmark">Prototyper</div>
      </div>
      <div className="hdr-tabs">
        {tabs.map(t => {
          const Ic = Icons[t.icon];
          return (
            <button key={t.id} className={cx('hdr-tab', activeView === t.id && 'hdr-tab--on')} onClick={() => setActiveView(t.id)}>
              <Ic size={12}/> {t.label}
            </button>
          );
        })}
      </div>
      <div className="row gap-3" style={{ marginLeft: 'auto', paddingRight: 10 }}>
        <div className="pill" style={{ cursor: 'pointer' }} onClick={() => setShowProjectManager(true)}><Icons.folder size={11}/> {project}</div>
        <HostPicker/>
        <ModelPicker value={modelId} onChange={setModelId}/>
        <StylePresetPicker value={stylePreset} onChange={setStylePreset}/>
        <button className="icon-btn" onClick={openSettings} title="Settings"><Icons.cog size={14}/></button>
      </div>
      <ProjectManagerModal open={showProjectManager} onClose={() => setShowProjectManager(false)} project={project} setProject={setProject}/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sidebar (left rail showing context list)
function SidebarRail({ activeView }) {
  const content = {
    screens:    { title: 'Screens',    items: LIB_SCREENS.map(s => ({ id: s.id, label: s.name, sub: s.updated })) },
    components: { title: 'Components', items: LIB_COMPONENTS.map(c => ({ id: c.id, label: c.name, sub: c.tag })) },
    library:    { title: 'Assets',     items: [...LIB_COMPONENTS.slice(0,3), ...LIB_THEMES.slice(0,3)].map(x => ({ id: x.id, label: x.name })) },
    themes:     { title: 'Themes',     items: LIB_THEMES.map(t => ({ id: t.id, label: t.name, sub: t.cat })) },
    workflows:  null, // workflows has its own panels
    apis:       { title: 'APIs',       items: LIB_APIS.map(a => ({ id: a.id, label: a.name, sub: a.kind })) },
    runner:     { title: 'Files',      items: [
      { id: 'f1', label: 'package.json' },
      { id: 'f2', label: 'src/App.tsx' },
      { id: 'f3', label: 'src/index.css' },
      { id: 'f4', label: 'src/components/LoginCard.tsx' },
      { id: 'f5', label: 'public/favicon.svg' },
    ]},
  };
  const c = content[activeView];
  if (!c) return null;
  return (
    <div className="panel" style={{ width: 220 }}>
      <div className="panel-head">
        <div className="panel-title">{c.title}</div>
        <span className="pill" style={{ marginLeft: 'auto' }}>{c.items.length}</span>
        <button className="icon-btn"><Icons.plus size={13}/></button>
      </div>
      <div style={{ padding: 8, overflow: 'auto', flex: 1 }}>
        {c.items.map(i => (
          <div key={i.id} className="rail-item">
            <span style={{ fontSize: 12 }}>{i.label}</span>
            {i.sub && <span style={{ fontSize: 10, color: 'var(--fg-mute)', marginLeft: 'auto' }}>{i.sub}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Themes panel
function ThemesPanel({ cmTheme }) {
  const [selected, setSelected] = uS('t4');
  const [prompt, setPrompt] = uS('A cool teal-on-ink cyberpunk theme using OKLCH, designed for a developer dashboard.');
  const [showCss, setShowCss] = uS(false);
  const theme = LIB_THEMES.find(t => t.id === selected) || LIB_THEMES[0];
  const isDark = theme.dark;
  const [showLibrary, setShowLibrary] = uS(true);
  return (
    <div className="view-body">
      <div className="split">
        <div className="split-pane">
          <div className="panel-head"><div className="panel-title">Prompt</div></div>
          <div className="pad-4 col gap-3" style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            <textarea className="textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}/>
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <button className="btn btn--acc"><Icons.sparkles size={12}/> Generate</button>
              <button className="btn"><Icons.save size={12}/> Save as preset</button>
              <div style={{ flex: 1 }}/>
              <div className="seg">
                <button data-on="true">shadcn</button>
                <button>daisy</button>
                <button>bootstrap</button>
                <button>generic</button>
              </div>
            </div>
            <div className="hair" style={{ margin: '2px 0' }}/>
            <button className="row gap-2" style={{ alignItems: 'center', padding: '4px 0', background: 'none', border: 'none', color: 'var(--fg-mute)', cursor: 'pointer', fontSize: 11 }} onClick={() => setShowLibrary(!showLibrary)}>
              <Icons.chevD size={10} style={{ transform: showLibrary ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .15s' }}/>
              <span className="caps">Library</span>
              <span className="pill" style={{ fontSize: 9 }}>{LIB_THEMES.length}</span>
            </button>
            {showLibrary && (
              <div className="grid-3">
                {LIB_THEMES.map(t => (
                  <div key={t.id} className={cx('card', 'theme-card')} data-selected={selected === t.id} onClick={() => setSelected(t.id)}>
                    <div className="theme-preview">
                      <div className="theme-preview-hero" style={{ background: t.dark ? '#0f0e0c' : '#faf8f2', color: t.dark ? '#fff' : '#111' }}>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                          <button className="theme-btn" style={{ background: t.button, color: t.dark ? '#fff' : '#000', fontSize: 9 }}>Primary</button>
                          <button className="theme-btn" style={{ background: 'transparent', color: t.dark ? '#fff' : '#111', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)', fontSize: 9 }}>Ghost</button>
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 600 }}>The quick brown fox</div>
                        <div style={{ fontSize: 9, opacity: .7 }}>jumps over the lazy dog</div>
                      </div>
                    </div>
                    <div className="row gap-2" style={{ padding: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 500 }}>{t.name}</span>
                      <div className="row gap-1" style={{ marginLeft: 'auto' }}>
                        {t.swatches.map((s, i) => <div key={i} className="sw" style={{ background: s }}/>)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="sash sash--v"/>
        <div className="split-pane" style={{ position: 'relative' }}>
          <div style={{ flex: 1, overflow: 'auto', padding: 24, background: isDark ? '#0c0c11' : '#fafafa', color: isDark ? '#fff' : '#111' }}>
            <div style={{ maxWidth: 420, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Common Components</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, border: 'none', cursor: 'default', background: theme.button, color: isDark ? '#fff' : '#000' }}>Primary</button>
                <button style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, border: 'none', cursor: 'default', background: 'transparent', color: isDark ? '#fff' : '#111', boxShadow: `inset 0 0 0 1px ${theme.accent}40` }}>Secondary</button>
                <button style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, border: 'none', cursor: 'default', background: 'transparent', color: theme.accent, opacity: 0.9 }}>Ghost</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, opacity: 0.7 }}>Email</label>
                <input defaultValue="hello@prototyper.dev" style={{
                  padding: '8px 10px', borderRadius: 8, fontSize: 12,
                  background: isDark ? 'rgba(255,255,255,0.06)' : '#fff',
                  border: `1px solid ${theme.accent}30`, color: 'inherit', outline: 'none'
                }}/>
              </div>
              <div style={{
                padding: 16, borderRadius: 10,
                background: isDark ? 'rgba(255,255,255,0.05)' : '#fff',
                border: `1px solid ${theme.accent}20`,
                boxShadow: isDark ? '0 10px 30px rgba(0,0,0,.3)' : '0 4px 12px rgba(0,0,0,.05)'
              }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Invite team members</div>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>Send an invite link to collaborate.</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                  <span className="pill mono" style={{ fontSize: 10 }}>https://proto.dev/invite</span>
                  <button style={{ padding: '4px 8px', borderRadius: 6, fontSize: 10, border: 'none', cursor: 'default', background: theme.button, color: isDark ? '#fff' : '#000' }}>Copy</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, opacity: 0.7 }}>Status</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.accent}30`, background: isDark ? 'rgba(255,255,255,0.06)' : '#fff', cursor: 'default' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: theme.accent }}/>
                  <span style={{ fontSize: 12, flex: 1 }}>Active</span>
                  <Icons.chevD size={10} style={{ opacity: 0.6 }}/>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['Design','Engineering','Marketing'].map((tag, i) => (
                  <span key={tag} style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 11,
                    background: i === 0 ? theme.accent + '20' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                    color: i === 0 ? theme.accent : 'inherit',
                    border: i === 0 ? `1px solid ${theme.accent}40` : `1px solid transparent`
                  }}>{tag}</span>
                ))}
              </div>
            </div>
          </div>

          {showCss && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%', display: 'flex', flexDirection: 'column', background: 'var(--n-0)', borderTop: '1px solid var(--line)', zIndex: 3 }}>
              <div className="panel-head" style={{ flexShrink: 0, borderBottom: '1px solid var(--line-soft)' }}>
                <div className="panel-title">CSS Output</div>
                <div style={{ flex: 1 }}/>
                <span className="pill mono" style={{ fontSize: 9 }}>oklch</span>
                <button className="icon-btn" onClick={() => setShowCss(false)}><Icons.x size={12}/></button>
              </div>
              <CodeMirrorEditor mode="css" theme={cmTheme} value={`:root {
  --background: oklch(0.18 0.025 200);
  --foreground: oklch(0.96 0.008 170);
  --card:       oklch(0.22 0.028 195);
  --border:     oklch(0.30 0.030 195);
  --primary:    oklch(0.82 0.14 180);
  --primary-foreground: oklch(0.18 0.04 200);
  --accent:     oklch(0.78 0.16 176);
  --muted:      oklch(0.28 0.018 200);
  --radius:     0.5rem;
}
.dark {
  --background: oklch(0.14 0.025 200);
}
@font-face { font-family: "Geist"; src: ... }`} style={{ flex: 1 }}/>
            </div>
          )}

          {!showCss && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 32, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8, background: 'var(--n-1)', borderTop: '1px solid var(--line-soft)', cursor: 'pointer', zIndex: 2 }} onClick={() => setShowCss(true)}>
              <Icons.terminal size={11}/>
              <span style={{ fontSize: 11, fontWeight: 500 }}>CSS Output</span>
              <div style={{ flex: 1 }}/>
              <span className="pill mono" style={{ fontSize: 9 }}>oklch</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Components panel
// ─────────────────────────────────────────────────────────────
// Component export modal
function ComponentExportModal({ open, onClose }) {
  const [format, setFormat] = uS('tsx');
  const [include, setInclude] = uS({ types: true, storybook: false, test: false, css: true });
  if (!open) return null;
  return (
    <div className="pi-backdrop" style={{ justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div className="card" style={{ width: 480, maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div className="pi-head" style={{ borderBottom: '1px solid var(--line-soft)', flexShrink: 0 }}>
          <div className="col">
            <div className="pi-title">Export Component</div>
            <div className="pi-sub">Package the generated component for use in your project</div>
          </div>
          <div style={{ flex: 1 }}/>
          <button className="icon-btn" onClick={onClose}><Icons.x size={13}/></button>
        </div>
        <div className="pad-4 col gap-4" style={{ overflow: 'auto', flex: 1 }}>
          <div>
            <div className="caps" style={{ marginBottom: 6 }}>Format</div>
            <div className="seg" style={{ flexWrap: 'wrap' }}>
              {[
                { id: 'tsx', label: 'React TSX' },
                { id: 'jsx', label: 'React JSX' },
                { id: 'vue', label: 'Vue SFC' },
                { id: 'svelte', label: 'Svelte' },
                { id: 'webc', label: 'Web Component' },
              ].map(f => (
                <button key={f.id} data-on={format === f.id} onClick={() => setFormat(f.id)}>{f.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="caps" style={{ marginBottom: 6 }}>Include</div>
            <div className="col gap-2">
              {[
                { key: 'types', label: 'Type definitions', desc: 'Props interface / type exports' },
                { key: 'css', label: 'Styles', desc: 'Tailwind classes or CSS module' },
                { key: 'storybook', label: 'Storybook story', desc: 'Default + variant stories' },
                { key: 'test', label: 'Unit test', desc: 'Vitest + React Testing Library scaffold' },
              ].map(item => (
                <label key={item.key} className="row gap-2" style={{ alignItems: 'flex-start', padding: 8, borderRadius: 8, background: 'var(--n-1)', border: '1px solid var(--line-soft)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={include[item.key]} onChange={(e) => setInclude({ ...include, [item.key]: e.target.checked })}/>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{item.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--fg-mute)' }}>{item.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="hair"/>
          <div className="col gap-2">
            <div className="caps">Output preview</div>
            <pre className="code-pane mono" style={{ fontSize: 11, padding: 10, borderRadius: 8, background: 'var(--n-1)' }}>{format === 'tsx'
? `export interface LoginCardProps {
  onSignIn: (user: string) => void;
}

export function LoginCard({ onSignIn }: LoginCardProps) {
  return (
    <div className="...">
      {/* generated */}
    </div>
  );
}`
: format === 'vue'
? `<script setup lang="ts">
interface Props { onSignIn: (user: string) => void }
defineProps<Props>();
</script>

<template>
  <div class="...">
    <!-- generated -->
  </div>
</template>`
: `// ${format} output`}</pre>
          </div>
        </div>
        <div className="pad-4 row gap-2" style={{ borderTop: '1px solid var(--line-soft)', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--acc"><Icons.file size={12}/> Export {format}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Save component modal
function SaveComponentModal({ open, onClose }) {
  const [name, setName] = uS('LoginCard');
  const [tag, setTag] = uS('auth');
  const [desc, setDesc] = uS('Glassmorphic login card with email, password and sign-in CTA.');
  const [scope, setScope] = uS('project');
  if (!open) return null;
  return (
    <div className="pi-backdrop" style={{ justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div className="card" style={{ width: 440, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div className="pi-head" style={{ borderBottom: '1px solid var(--line-soft)', flexShrink: 0 }}>
          <div className="col">
            <div className="pi-title">Save to Library</div>
            <div className="pi-sub">Tag and store this component for reuse across screens</div>
          </div>
          <div style={{ flex: 1 }}/>
          <button className="icon-btn" onClick={onClose}><Icons.x size={13}/></button>
        </div>
        <div className="pad-4 col gap-3" style={{ overflow: 'auto', flex: 1 }}>
          <div className="col gap-1">
            <span style={{ fontSize: 11 }}>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ fontSize: 12 }}/>
          </div>
          <div className="row gap-2">
            <div className="col gap-1" style={{ flex: 1 }}>
              <span style={{ fontSize: 11 }}>Tag</span>
              <div className="seg" style={{ flexWrap: 'wrap' }}>
                {['auth','form','data','marketing','ui','social','app'].map(t => (
                  <button key={t} data-on={tag === t} onClick={() => setTag(t)}>{t}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="col gap-1">
            <span style={{ fontSize: 11 }}>Description</span>
            <textarea className="textarea" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} style={{ fontSize: 12 }}/>
          </div>
          <div className="col gap-1">
            <span style={{ fontSize: 11 }}>Scope</span>
            <div className="row gap-2">
              {[
                { id: 'private', label: 'Private', desc: 'Only you' },
                { id: 'project', label: 'Project', desc: 'This workspace' },
                { id: 'library', label: 'Library', desc: 'Across projects' },
              ].map(s => (
                <button
                  key={s.id}
                  className="card"
                  onClick={() => setScope(s.id)}
                  style={{
                    flex: 1, padding: 10, cursor: 'pointer',
                    borderColor: scope === s.id ? 'var(--acc)' : undefined,
                    background: scope === s.id ? 'var(--acc-soft)' : undefined,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--fg-mute)', marginTop: 2 }}>{s.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="pad-4 row gap-2" style={{ borderTop: '1px solid var(--line-soft)', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--acc" onClick={onClose}><Icons.check size={12}/> Save</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Theme picker dropdown for component prompt
function ThemePickerDropdown({ value, onChange }) {
  const [open, setOpen] = uS(false);
  const rootRef = uR(null);
  uE(() => {
    if (!open) return;
    const h = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={rootRef} className="col gap-2" style={{ position: 'relative' }}>
      <div className="row gap-2" style={{ alignItems: 'center' }}>
        <span className="caps">Theme</span>
        {value && (
          <button className="pill pill--acc" style={{ fontSize: 9, cursor: 'pointer' }} onClick={() => onChange?.(null)}>
            <Icons.x size={9}/> {value.name}
          </button>
        )}
      </div>
      <button
        className="card"
        onClick={() => setOpen(o => !o)}
        style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', borderColor: open ? 'var(--acc)' : undefined }}
      >
        {value ? (
          <>
            <div className="sw" style={{ background: value.swatches[0], width: 14, height: 14, borderRadius: 3, flexShrink: 0 }}/>
            <span style={{ fontSize: 11, fontWeight: 500 }}>{value.name}</span>
          </>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--fg-mute)' }}>Select a theme…</span>
        )}
        <div style={{ flex: 1 }}/>
        <Icons.chevD size={10} style={{ opacity: .6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}/>
      </button>
      {open && (
        <div className="mp-pop" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300, marginTop: 4, maxHeight: 320, overflow: 'auto' }}>
          {LIB_THEMES.map(t => (
            <button
              key={t.id}
              className="mp-row"
              data-on={value?.id === t.id}
              onClick={() => { onChange?.(value?.id === t.id ? null : t); setOpen(false); }}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, padding: 10 }}
            >
              <div className="row gap-2" style={{ alignItems: 'center' }}>
                <div className="sw" style={{ background: t.swatches[0], width: 14, height: 14, borderRadius: 3, flexShrink: 0 }}/>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{t.name}</span>
                <span className="pill mono" style={{ marginLeft: 'auto', fontSize: 9 }}>{t.cat}</span>
              </div>
              <div className="theme-preview" style={{ height: 50, borderRadius: 6, overflow: 'hidden' }}>
                <div className="theme-preview-hero" style={{ background: t.dark ? '#0f0e0c' : '#faf8f2', color: t.dark ? '#fff' : '#111', padding: '6px 8px' }}>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                    <button className="theme-btn" style={{ background: t.button, color: t.dark ? '#fff' : '#000', fontSize: 8, padding: '2px 6px' }}>Primary</button>
                    <button className="theme-btn" style={{ background: 'transparent', color: t.dark ? '#fff' : '#111', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)', fontSize: 8, padding: '2px 6px' }}>Ghost</button>
                  </div>
                  <div style={{ fontSize: 9, opacity: .8 }}>The quick brown fox</div>
                </div>
              </div>
              <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                {t.swatches.map((s, i) => <div key={i} className="sw" style={{ background: s, width: 10, height: 10, borderRadius: 2 }}/>)}
              </div>
            </button>
          ))}
        </div>
      )}
      {value && (
        <div style={{ fontSize: 10, color: 'var(--fg-mute)', lineHeight: 1.4, padding: '4px 6px', borderRadius: 6, background: 'var(--n-1)', border: '1px solid var(--line-soft)' }}>
          Injected: "Apply the <strong>{value.name}</strong> theme with accent {value.swatches[0]} and surface {value.swatches[2]}."
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Add library modal
function AddLibraryModal({ open, onClose, onAdd }) {
  const [custom, setCustom] = uS('');
  const presets = ['framer-motion', '@radix-ui/react-dialog', 'clsx', 'class-variance-authority', 'tailwind-merge', 'date-fns', 'zod'];
  if (!open) return null;
  return (
    <div className="pi-backdrop" style={{ justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div className="card" style={{ width: 360, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div className="pi-head" style={{ borderBottom: '1px solid var(--line-soft)', flexShrink: 0 }}>
          <div className="col">
            <div className="pi-title">Add Library</div>
            <div className="pi-sub">Include an extra dependency in the generated component</div>
          </div>
          <div style={{ flex: 1 }}/>
          <button className="icon-btn" onClick={onClose}><Icons.x size={13}/></button>
        </div>
        <div className="pad-4 col gap-3" style={{ overflow: 'auto', flex: 1 }}>
          <div className="caps">Common</div>
          <div className="row gap-1" style={{ flexWrap: 'wrap' }}>
            {presets.map(p => (
              <button key={p} className="tag" style={{ cursor: 'pointer' }} onClick={() => { onAdd?.(p); onClose(); }}>{p}</button>
            ))}
          </div>
          <div className="hair" style={{ margin: '2px 0' }}/>
          <div className="caps">Custom</div>
          <div className="row gap-2">
            <input className="input mono" placeholder="npm-package-name" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && custom.trim() && (onAdd?.(custom.trim()), onClose())} style={{ flex: 1, fontSize: 12 }}/>
            <button className="btn btn--acc" style={{ padding: '5px 10px', fontSize: 11 }} onClick={() => { if (custom.trim()) { onAdd?.(custom.trim()); onClose(); } }}>Add</button>
          </div>
        </div>
        <div className="pad-4 row gap-2" style={{ borderTop: '1px solid var(--line-soft)', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ComponentsPanel({ modelId, cmTheme }) {
  const [prompt, setPrompt] = uS('A login card with email + password, glassmorphic surface, subtle glow on focus.');
  const [attachments, setAttachments] = uS([]);
  const [inspector, setInspector] = uS(false);
  const [showExport, setShowExport] = uS(false);
  const [showSave, setShowSave] = uS(false);
  const [showCode, setShowCode] = uS(false);
  const [showAddLib, setShowAddLib] = uS(false);
  const [libs, setLibs] = uS(['shadcn/ui','lucide','motion','radix','tailwind v4']);
  const [activeTheme, setActiveTheme] = uS(null);
  const model = MODELS.find(m => m.id === modelId) || MODELS[0];
  const system = `You are Prototyper's component generator. Output a single React/TSX function component using Tailwind v4. Library: shadcn/ui, lucide, motion, radix.`;
  return (
    <div className="view-body">
      <div className="split">
        <div className="split-pane" style={{ maxWidth: 380 }}>
          <div className="panel-head"><div className="panel-title">Prompt</div></div>
          <div className="pad-4 col gap-3" style={{ overflow: 'auto', flex: 1 }}>
            <AttachComposer
              value={prompt}
              setValue={setPrompt}
              attachments={attachments}
              setAttachments={setAttachments}
              model={model}
              onOpenPrompt={() => setInspector(true)}
              onSend={() => {}}
              showUpdate={false}
              placeholder="Describe the component…"
            />
            <div className="row gap-2">
              <button className="btn" onClick={() => setShowSave(true)}><Icons.save size={12}/> Save</button>
              <button className="btn" onClick={() => setShowExport(true)}><Icons.file size={12}/> Export</button>
              <div style={{ flex: 1 }}/>
            </div>
            <div className="hair" style={{ margin: '2px 0' }}/>
            {/* Libraries */}
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <span className="caps">Libraries</span>
              <span className="pill mono" style={{ fontSize: 9 }}>{libs.length}</span>
            </div>
            <div className="row gap-1" style={{ flexWrap: 'wrap' }}>
              {libs.map(l => (
                <span key={l} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {l}
                  <button className="icon-btn" style={{ width: 12, height: 12 }} onClick={() => setLibs(ls => ls.filter(x => x !== l))}><Icons.x size={9}/></button>
                </span>
              ))}
              <button className="tag" style={{ cursor: 'pointer' }} onClick={() => setShowAddLib(true)}>+ add</button>
            </div>
            {/* Theme injector */}
            <ThemePickerDropdown value={activeTheme} onChange={setActiveTheme}/>
          </div>
        </div>
        <div className="sash sash--v"/>
        <div className="split-pane" style={{ position: 'relative' }}>
          <div style={{ flex: 1, padding: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'repeating-linear-gradient(45deg, var(--n-0), var(--n-0) 12px, var(--n-1) 12px, var(--n-1) 24px)' }}>
            <LoginCardMock/>
          </div>

          {showCode && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%', display: 'flex', flexDirection: 'column', background: 'var(--n-0)', borderTop: '1px solid var(--line)', zIndex: 3 }}>
              <div className="panel-head" style={{ flexShrink: 0, borderBottom: '1px solid var(--line-soft)' }}>
                <div className="panel-title">Code</div>
                <div style={{ flex: 1 }}/>
                <div className="pill mono"><span className="sdot sdot--ok"/> built · 180ms</div>
                <button className="icon-btn" onClick={() => setShowCode(false)}><Icons.x size={12}/></button>
              </div>
              <CodeMirrorEditor mode="jsx" theme={cmTheme} value={`export function LoginCard({ onSignIn }: { onSignIn: (user: string) => void }) {
  return (
    <div className="w-[340px] p-7 rounded-2xl bg-[rgba(20,24,34,.6)] backdrop-blur-xl border border-white/[0.08] shadow-2xl">
      <div className="text-lg font-semibold mb-1">Welcome back</div>
      <div className="text-xs text-muted mb-5">Sign in to your workspace.</div>
      <label className="text-[9px] uppercase tracking-wider">Email</label>
      <input className="input mb-3" defaultValue="you@prototyper.dev" />
      <div className="flex gap-2">
        <label className="text-[9px] uppercase tracking-wider flex-1">Password</label>
        <a className="link-sub text-[10px]">Forgot?</a>
      </div>
      <input className="input mb-4" type="password" defaultValue="••••••••••" />
      <button className="btn btn--acc w-full justify-center py-2">Sign in</button>
      <div className="text-center text-[11px] text-muted mt-3">
        No account? <a className="link-sub">Request access</a>
      </div>
    </div>
  );
}`} style={{ flex: 1 }}/>
            </div>
          )}

          {!showCode && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 32, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8, background: 'var(--n-1)', borderTop: '1px solid var(--line-soft)', cursor: 'pointer', zIndex: 2 }} onClick={() => setShowCode(true)}>
              <Icons.terminal size={11}/>
              <span style={{ fontSize: 11, fontWeight: 500 }}>Code</span>
              <div style={{ flex: 1 }}/>
              <div className="pill mono" style={{ fontSize: 9 }}><span className="sdot sdot--ok"/> built · 180ms</div>
            </div>
          )}
        </div>
      </div>
      <PromptInspector
        open={inspector}
        onClose={() => setInspector(false)}
        title="Components → Generate"
        model={model.id}
        system={system}
        messages={[]}
        user={prompt}
        attachments={attachments}
        cmTheme={cmTheme}
      />
      <ComponentExportModal open={showExport} onClose={() => setShowExport(false)}/>
      <SaveComponentModal open={showSave} onClose={() => setShowSave(false)}/>
      <AddLibraryModal open={showAddLib} onClose={() => setShowAddLib(false)} onAdd={(lib) => setLibs(ls => [...ls, lib])}/>
    </div>
  );
}

function LoginCardMock() {
  return (
    <div style={{ width: 340, padding: 26, borderRadius: 16, background: 'rgba(20,24,34,.6)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,.08)', boxShadow: '0 30px 80px rgba(0,0,0,.55)' }}>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Welcome back</div>
      <div style={{ fontSize: 12, color: 'var(--fg-mute)', marginBottom: 18 }}>Sign in to your workspace.</div>
      <div className="caps" style={{ fontSize: 9 }}>Email</div>
      <input className="input" defaultValue="you@prototyper.dev" style={{ marginBottom: 10 }}/>
      <div className="row gap-2">
        <div className="caps" style={{ fontSize: 9, flex: 1 }}>Password</div>
        <a className="link-sub" style={{ fontSize: 10 }}>Forgot?</a>
      </div>
      <input className="input" type="password" defaultValue="••••••••••" style={{ marginBottom: 14 }}/>
      <button className="btn btn--acc" style={{ width: '100%', justifyContent: 'center', padding: '8px 10px' }}>Sign in</button>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--fg-mute)', marginTop: 12 }}>No account? <a className="link-sub">Request access</a></div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Screens panel
function ScreensPanel({ modelId, cmTheme }) {
  const [active, setActive] = uS('sc1');
  const [device, setDevice] = uS('desktop');
  const [composer, setComposer] = uS('Make the KPIs bigger, hide the sidebar on mobile. Match the visual style of the attached dribbble shot.');
  const [attachments, setAttachments] = uS([
    // Seed with one fake attachment so the pattern is visible on first load
    { id: 'seed1', name: 'dribbble-shot-2847.png', size: 284000, w: 1600, h: 1200, preview: 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%234ee2c9"/><stop offset="1" stop-color="%23a78bfa"/></linearGradient></defs><rect width="160" height="120" fill="url(%23g)"/><rect x="16" y="24" width="38" height="72" fill="rgba(255,255,255,.2)" rx="4"/><rect x="64" y="24" width="80" height="30" fill="rgba(255,255,255,.3)" rx="4"/><rect x="64" y="62" width="80" height="34" fill="rgba(255,255,255,.2)" rx="4"/></svg>`) },
  ]);
  const [inspector, setInspector] = uS(false);
  const model = MODELS.find(m => m.id === modelId) || MODELS[0];

  const messages = [
    { role: 'user', content: 'A dashboard with a sidebar, top stats, and a recent orders table.' },
    { role: 'assistant', content: 'Planned: sidebar (nav), 3 KPI cards, table w/ pagination. Generated dashboard v1 with 12 elements.' },
    { role: 'user', content: 'Make the KPIs bigger, hide the sidebar on mobile.' },
  ];
  const system = `You are Prototyper's screen generator.\nOutput a single React/TSX screen as a default export.\nUse Tailwind v4 class names. Do not import icons — use inline SVG.\nCurrent theme: Glassmorphism (teal accent, dark surfaces).\nCurrent design system: shadcn/ui\nCurrent device target: ${device}\nReply with XML tags: <plan/>, <code/>, <notes/>.`;
  const tools = [
    { name: 'save_screen', body: 'Persist the generated screen to the library.' },
    { name: 'link_screens', body: 'Create a navigation link between two screens.' },
  ];

  const [linkMode, setLinkMode] = uS(false);
  const [links, setLinks] = uS([
    { id: 'l1', from: 'sidebar-orders', to: 'sc2', label: 'Orders nav', type: 'navigate' },
    { id: 'l2', from: 'btn-new-order', to: 'sc3', label: 'New order', type: 'modal' },
  ]);
  const [selectedLinkEl, setSelectedLinkEl] = uS(null);
  const [showExport, setShowExport] = uS(false);

  const linkableElements = [
    { id: 'sidebar-home', label: 'Sidebar · Home', x: 8, y: 10 },
    { id: 'sidebar-orders', label: 'Sidebar · Orders', x: 8, y: 15 },
    { id: 'sidebar-customers', label: 'Sidebar · Customers', x: 8, y: 20 },
    { id: 'btn-new-order', label: 'Button · New order', x: 82, y: 12 },
    { id: 'row-order', label: 'Table row · Order', x: 50, y: 55 },
  ];

  return (
    <div className="view-body">
      <div className="split">
        <div className="split-pane" style={{ maxWidth: 380 }}>
          {linkMode ? (
            <>
              <div className="panel-head"><div className="panel-title">Links</div><span className="pill" style={{ marginLeft: 'auto' }}>{links.length}</span></div>
              <div style={{ overflow: 'auto', padding: 12, flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {links.map(l => (
                  <div key={l.id} className="card" style={{ padding: 10 }}>
                    <div className="row gap-2" style={{ alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 500 }}>{l.label}</span>
                      <span className="pill mono" style={{ marginLeft: 'auto', fontSize: 9 }}>{l.type}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--fg-mute)', marginTop: 4 }}>
                      {linkableElements.find(e => e.id === l.from)?.label || l.from} → {LIB_SCREENS.find(s => s.id === l.to)?.name || l.to}
                    </div>
                  </div>
                ))}
                <div className="hair" style={{ margin: '4px 0' }}/>
                <div className="caps">Click an element in preview to start a link</div>
              </div>
            </>
          ) : (
            <>
              <div className="panel-head"><div className="panel-title">Chat</div><span className="pill mono" style={{ marginLeft: 'auto' }}>3 turns</span></div>
              <div style={{ overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                <div className="chat-msg chat-msg--u"><div className="chat-msg-body">A dashboard with a sidebar, top stats, and a recent orders table.</div></div>
                <div className="chat-msg chat-msg--a"><div className="chat-msg-body"><span className="pill pill--acc" style={{ fontSize: 10, marginBottom: 6 }}>✧ thinking</span><div style={{ marginTop: 4 }}>Planned: sidebar (nav), 3 KPI cards, table w/ pagination. Generating…</div></div></div>
                <div className="chat-msg chat-msg--u"><div className="chat-msg-body">Make the KPIs bigger, hide the sidebar on mobile.</div></div>
              </div>
              <div style={{ padding: 10, borderTop: '1px solid var(--line-soft)' }}>
                <AttachComposer
                  value={composer}
                  setValue={setComposer}
                  attachments={attachments}
                  setAttachments={setAttachments}
                  model={model}
                  onOpenPrompt={() => setInspector(true)}
                  onSend={() => { /* demo */ }}
                  placeholder="Describe the screen or refine…"
                />
              </div>
            </>
          )}
        </div>
        <div className="sash sash--v"/>
        <div className="split-pane">
          <div className="panel-head">
            <div className="panel-title">{linkMode ? 'Select element to link' : 'Preview'}</div>
            <div className="seg" style={{ marginLeft: 10 }}>
              {['desktop','tablet','mobile'].map(d => <button key={d} data-on={device === d} onClick={() => setDevice(d)}>{d}</button>)}
            </div>
            <div style={{ flex: 1 }}/>
            <button className={cx('btn', linkMode && 'btn--acc')} style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setLinkMode(!linkMode)}>
              <Icons.link size={11}/> {linkMode ? 'Done' : 'Link'}
            </button>
            <button className="btn" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setShowExport(true)}><Icons.file size={11}/> Export</button>
            <div className="hair" style={{ margin: '0 6px', height: 18 }}/>
            <button className="icon-btn"><Icons.zoomOut size={12}/></button>
            <span className="mono" style={{ fontSize: 11, color: 'var(--fg-mute)' }}>100%</span>
            <button className="icon-btn"><Icons.zoomIn size={12}/></button>
          </div>
          <div style={{ flex: 1, padding: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', background: 'var(--n-0)', position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <DashboardMock/>
              {linkMode && linkableElements.map(el => {
                const hasLink = links.some(l => l.from === el.id);
                const isSelected = selectedLinkEl === el.id;
                return (
                  <div key={el.id} style={{ position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, zIndex: 10 }}>
                    <div
                      onClick={() => setSelectedLinkEl(isSelected ? null : el.id)}
                      style={{
                        width: 44, height: 26,
                        borderRadius: 4,
                        border: isSelected ? '2px solid var(--acc)' : hasLink ? '2px dashed var(--acc)' : '2px dashed var(--fg-mute)',
                        background: isSelected ? 'rgba(78,226,201,.2)' : hasLink ? 'rgba(78,226,201,.1)' : 'rgba(255,255,255,.06)',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      title={el.label}
                    >
                      {hasLink && <Icons.link size={10} style={{ color: 'var(--acc)' }}/>}
                    </div>
                    {isSelected && (
                      <div className="card" style={{ position: 'absolute', top: 30, left: 0, width: 180, padding: 8, zIndex: 20, boxShadow: 'var(--sh-pop)' }} onClick={e => e.stopPropagation()}>
                        <div className="caps" style={{ fontSize: 9, marginBottom: 4 }}>Link to screen</div>
                        <div className="col gap-1" style={{ marginBottom: 6 }}>
                          {LIB_SCREENS.filter(sc => sc.id !== active).map(sc => (
                            <button key={sc.id} className="rail-item" style={{ padding: '4px 6px', fontSize: 11 }} onClick={() => {
                              const existing = links.find(l => l.from === el.id);
                              if (existing) {
                                setLinks(ls => ls.map(l => l.id === existing.id ? { ...l, to: sc.id, label: `${el.label} → ${sc.name}` } : l));
                              } else {
                                setLinks(ls => [...ls, { id: 'l' + Date.now(), from: el.id, to: sc.id, label: `${el.label} → ${sc.name}`, type: 'navigate' }]);
                              }
                              setSelectedLinkEl(null);
                            }}>
                              {sc.name}
                            </button>
                          ))}
                        </div>
                        <div className="caps" style={{ fontSize: 9, marginBottom: 4 }}>Transition</div>
                        <div className="seg" style={{ flexWrap: 'wrap' }}>
                          {['navigate','modal','drawer','sheet'].map(t => (
                            <button key={t} style={{ fontSize: 9, padding: '3px 6px' }} onClick={() => {
                              const existing = links.find(l => l.from === el.id);
                              if (existing) setLinks(ls => ls.map(l => l.id === existing.id ? { ...l, type: t } : l));
                            }}>
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <PromptInspector
        open={inspector}
        onClose={() => setInspector(false)}
        title="Screens → Generate"
        model={model.id}
        system={system}
        messages={messages}
        user={composer}
        attachments={attachments}
        tools={tools}
        cmTheme={cmTheme}
      />
      <ExportModal open={showExport} onClose={() => setShowExport(false)}/>
    </div>
  );
}

// Attach the inspector as an overlay for Screens
function ScreensPanelWrapper(props) {
  return <ScreensPanel {...props}/>;
}

function DashboardMock() {
  return (
    <div style={{ width: 880, height: 540, background: '#0f0f14', borderRadius: 12, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.5)', display: 'grid', gridTemplateColumns: '160px 1fr' }}>
      <div style={{ background: '#0a0a0e', borderRight: '1px solid #1f1f2b', padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Acme Inc.</div>
        {['Home','Orders','Customers','Products','Reports'].map((x,i) => (
          <div key={x} style={{ padding: '5px 8px', fontSize: 11, color: i === 1 ? '#fff' : '#8c92a6', background: i === 1 ? '#1a1b28' : 'transparent', borderRadius: 5, marginBottom: 2 }}>{x}</div>
        ))}
      </div>
      <div style={{ padding: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Orders</div>
          <button style={{ padding: '5px 10px', fontSize: 11, background: '#4ee2c9', color: '#001814', border: 0, borderRadius: 6 }}>New order</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
          {[['Revenue','$184,239','+12%'],['Orders','1,284','+5%'],['Refunds','23','-18%']].map(([a,b,c]) => (
            <div key={a} style={{ background: '#141522', padding: 12, borderRadius: 8, border: '1px solid #1f1f2b' }}>
              <div style={{ fontSize: 10, color: '#8c92a6' }}>{a}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{b}</div>
              <div style={{ fontSize: 10, color: c.startsWith('+') ? '#5cd684' : '#ff6183' }}>{c}</div>
            </div>
          ))}
        </div>
        <div style={{ background: '#141522', border: '1px solid #1f1f2b', borderRadius: 8, overflow: 'hidden' }}>
          {['#01245','#01244','#01243','#01242','#01241'].map((id, i) => (
            <div key={id} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px 80px', padding: '8px 12px', fontSize: 11, color: '#cdd3e3', borderBottom: i < 4 ? '1px solid #1f1f2b' : 'none' }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: '#8c92a6' }}>{id}</span>
              <span>Customer {i + 1}</span>
              <span>$240</span>
              <span style={{ color: i % 2 ? '#5cd684' : '#f5b151' }}>{i % 2 ? 'Paid' : 'Pending'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// APIs panel
function APIsPanel({ cmTheme }) {
  const [active, setActive] = uS('a1');
  const [tab, setTab] = uS('endpoints');
  const api = LIB_APIS.find(a => a.id === active) || LIB_APIS[0];
  return (
    <div className="view-body">
      <div className="view-head">
        <div>
          <div className="view-title">APIs & Integrations</div>
          <div className="view-sub">Define endpoints, attach them to nodes, and call them from generated apps.</div>
        </div>
        <div className="row gap-2">
          <button className="btn"><Icons.file size={12}/> Import OpenAPI</button>
          <button className="btn"><Icons.terminal size={12}/> Paste cURL</button>
          <button className="btn btn--acc"><Icons.plus size={12}/> New API</button>
        </div>
      </div>
      <div className="split">
        <div className="split-pane" style={{ maxWidth: 260 }}>
          <div className="panel-head"><div className="panel-title">Saved APIs</div><span className="pill" style={{ marginLeft: 'auto' }}>{LIB_APIS.length}</span></div>
          <div style={{ overflow: 'auto', flex: 1, padding: 8 }}>
            {LIB_APIS.map(a => (
              <div key={a.id} className="rail-item" data-on={active === a.id} onClick={() => setActive(a.id)} style={{ flexDirection: 'column', alignItems: 'flex-start', padding: 10, gap: 2, borderRadius: 8, cursor: 'pointer' }}>
                <div className="row gap-2" style={{ width: '100%' }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{a.name}</span>
                  <span className="pill mono" style={{ marginLeft: 'auto', fontSize: 9 }}>{a.kind}</span>
                </div>
                <span style={{ fontSize: 10, color: 'var(--fg-mute)' }}>{a.endpoints} endpoints · {a.auth}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="sash sash--v"/>
        <div className="split-pane">
          <div className="panel-head">
            <div className="panel-title">{api.name}</div>
            <span className="pill pill--acc">{api.kind}</span>
            <div className="seg" style={{ marginLeft: 12 }}>
              {['endpoints','auth','schemas','test'].map(t => <button key={t} data-on={tab === t} onClick={() => setTab(t)}>{t}</button>)}
            </div>
            <div style={{ flex: 1 }}/>
            <button className="btn"><Icons.link size={12}/> Attach to node</button>
          </div>
          {tab === 'endpoints' && <EndpointsTab/>}
          {tab === 'auth' && <AuthTab/>}
          {tab === 'schemas' && <SchemasTab/>}
          {tab === 'test' && <TestTab/>}
        </div>
      </div>
    </div>
  );
}

function EndpointsTab() {
  const eps = [
    { m: 'GET', path: '/v1/customers', desc: 'List customers', auth: '🔒' },
    { m: 'POST', path: '/v1/customers', desc: 'Create customer', auth: '🔒' },
    { m: 'GET', path: '/v1/customers/{id}', desc: 'Retrieve customer', auth: '🔒' },
    { m: 'GET', path: '/v1/charges', desc: 'List charges', auth: '🔒' },
    { m: 'POST', path: '/v1/charges', desc: 'Create charge', auth: '🔒' },
    { m: 'GET', path: '/v1/subscriptions', desc: 'List subscriptions', auth: '🔒' },
  ];
  return (
    <div style={{ overflow: 'auto', flex: 1 }}>
      {eps.map((e, i) => (
        <div key={i} className="endpoint-row">
          <span className={cx('method-pill', `method-pill--${e.m.toLowerCase()}`)}>{e.m}</span>
          <span className="mono" style={{ fontSize: 12, flex: 1 }}>{e.path}</span>
          <span style={{ fontSize: 11, color: 'var(--fg-mute)' }}>{e.desc}</span>
          <span style={{ fontSize: 11, color: 'var(--fg-mute)' }}>{e.auth}</span>
          <Icons.chevR size={12} style={{ color: 'var(--fg-mute)' }}/>
        </div>
      ))}
    </div>
  );
}
function AuthTab() {
  return (
    <div className="pad-5" style={{ overflow: 'auto', flex: 1 }}>
      <div className="caps">Scheme</div>
      <div className="seg" style={{ marginTop: 4 }}>
        <button data-on="true">Bearer</button><button>API key</button><button>Basic</button><button>OAuth 2</button><button>None</button>
      </div>
      <div className="caps" style={{ marginTop: 14 }}>Token</div>
      <input className="input mono" defaultValue="sk_test_51J***********************"/>
      <div className="caps" style={{ marginTop: 14 }}>Header</div>
      <input className="input mono" defaultValue="Authorization: Bearer {{token}}"/>
    </div>
  );
}
function SchemasTab() {
  return (
    <CodeMirrorEditor mode="javascript" theme={cmTheme} value={`type Customer = {
  id: string;
  email: string;
  name?: string;
  created: number;
  metadata: Record<string, string>;
};

type Charge = {
  id: string;
  amount: number;
  currency: 'usd' | 'eur' | 'gbp';
  customer: Customer['id'];
  status: 'pending' | 'succeeded' | 'failed';
};`}/>
  );
}
function TestTab() {
  return (
    <div className="col" style={{ flex: 1 }}>
      <div className="pad-4">
        <div className="row gap-2">
          <span className="method-pill method-pill--get">GET</span>
          <input className="input mono" defaultValue="/v1/customers?limit=3"/>
          <button className="btn btn--acc"><Icons.play size={11}/> Send</button>
        </div>
      </div>
      <div className="hair"/>
      <CodeMirrorEditor mode="javascript" theme={cmTheme} value={`{
  "object": "list",
  "data": [
    { "id": "cus_OaBcDe", "email": "liz@acme.io", "created": 1708031920 },
    { "id": "cus_OaXyZw", "email": "sam@acme.io", "created": 1708030011 },
    { "id": "cus_ObQrSt", "email": "dave@acme.io", "created": 1708021002 }
  ],
  "has_more": true
}`}/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Runner panel (Tauri sandbox)
function RunnerPanel({ cmTheme }) {
  const [tab, setTab] = uS('terminal');
  return (
    <div className="view-body">
      <div className="view-head">
        <div>
          <div className="view-title">Run <span className="pill mono" style={{ marginLeft: 8 }}><span className="sdot sdot--run"/> bun dev · :5173</span></div>
          <div className="view-sub">Sandboxed bun process. File ops, bash commands, and live preview.</div>
        </div>
        <div className="row gap-2">
          <button className="btn"><Icons.stop size={11}/> Stop</button>
          <button className="btn"><Icons.terminal size={12}/> New shell</button>
          <button className="btn btn--acc"><Icons.play size={11}/> bun dev</button>
        </div>
      </div>
      <div className="split3">
        {/* Left: files */}
        <div className="split-pane" style={{ maxWidth: 230 }}>
          <div className="panel-head"><div className="panel-title">Files</div><span className="pill mono" style={{ marginLeft: 'auto' }}>./generated</span></div>
          <div style={{ overflow: 'auto', padding: 8, flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            <FileTree/>
          </div>
        </div>
        <div className="sash sash--v"/>
        {/* Middle: code editor */}
        <div className="split-pane">
          <div className="panel-head">
            <div className="panel-title mono">src/App.tsx</div>
            <div style={{ flex: 1 }}/>
            <div className="seg">
              <button data-on={tab === 'terminal'} onClick={() => setTab('terminal')}>Terminal</button>
              <button data-on={tab === 'logs'} onClick={() => setTab('logs')}>Logs</button>
              <button data-on={tab === 'net'} onClick={() => setTab('net')}>Network</button>
            </div>
          </div>
          <CodeMirrorEditor mode="jsx" theme={cmTheme} value={`import { useState } from 'react'
import { LoginCard } from './components/LoginCard'

export default function App() {
  const [user, setUser] = useState<string | null>(null)
  if (!user) return <LoginCard onSignIn={setUser} />
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Hi, {user}</h1>
    </main>
  )
}`}/>
          <div className="hair"/>
          <div className="terminal">
            <div className="terminal-line"><span className="tl-host">proto</span><span className="tl-sep">:</span><span className="tl-cwd">generated</span><span className="tl-sig">$</span> <span className="tl-cmd">bun install</span></div>
            <div className="terminal-line tl-out"> + react@19.0.0</div>
            <div className="terminal-line tl-out"> + react-dom@19.0.0</div>
            <div className="terminal-line tl-out"> + tailwindcss@4.0.0-alpha.30</div>
            <div className="terminal-line tl-out tl-ok"> installed 142 packages in 412ms</div>
            <div className="terminal-line"><span className="tl-host">proto</span><span className="tl-sep">:</span><span className="tl-cwd">generated</span><span className="tl-sig">$</span> <span className="tl-cmd">bun dev</span></div>
            <div className="terminal-line tl-out"> $ vite</div>
            <div className="terminal-line tl-out tl-ok"> → Local:   http://localhost:5173/</div>
            <div className="terminal-line tl-out">   ready in 218ms</div>
            <div className="terminal-line"><span className="tl-host">proto</span><span className="tl-sep">:</span><span className="tl-cwd">generated</span><span className="tl-sig">$</span> <span className="cursor-blink">▋</span></div>
          </div>
        </div>
        <div className="sash sash--v"/>
        {/* Right: live preview */}
        <div className="split-pane" style={{ maxWidth: 420 }}>
          <div className="panel-head">
            <div className="panel-title">Preview</div>
            <span className="pill mono" style={{ marginLeft: 8 }}>localhost:5173</span>
            <div style={{ flex: 1 }}/>
            <button className="icon-btn"><Icons.fit size={12}/></button>
          </div>
          <div style={{ flex: 1, padding: 20, background: 'var(--n-0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LoginCardMock/>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileTree() {
  const tree = [
    ['▾ 📁 src', 0, true, 'f'],
    ['  ▾ 📁 components', 0, true, 'f'],
    ['    📄 LoginCard.tsx', 1, false, 'c'],
    ['    📄 Button.tsx', 0, false, 'c'],
    ['  📄 App.tsx', 1, false, 'c'],
    ['  📄 main.tsx', 0, false, 'c'],
    ['  📄 index.css', 0, false, 's'],
    ['▾ 📁 public', 0, true, 'f'],
    ['  📄 favicon.svg', 0, false, 'i'],
    ['📄 package.json', 0, false, 'j'],
    ['📄 vite.config.ts', 0, false, 'c'],
    ['📄 tsconfig.json', 0, false, 'j'],
  ];
  return (
    <>{tree.map(([t, on, isf, k], i) => (
      <div key={i} style={{ padding: '2px 4px', color: on ? 'var(--fg)' : 'var(--fg-dim)', background: on ? 'var(--acc-soft)' : 'transparent', borderRadius: 3, cursor: 'pointer' }}>{t}</div>
    ))}</>
  );
}

// ─────────────────────────────────────────────────────────────
// Library panel
function LibraryPanel() {
  const [tab, setTab] = uS('components');
  const data = tab === 'components' ? LIB_COMPONENTS : tab === 'themes' ? LIB_THEMES : tab === 'screens' ? LIB_SCREENS : LIB_APIS;
  return (
    <div className="view-body">
      <div className="view-head">
        <div>
          <div className="view-title">Library</div>
          <div className="view-sub">Everything you've saved — components, themes, screens, APIs — reusable across projects.</div>
        </div>
        <div className="row gap-2">
          <div className="seg">
            {['components','themes','screens','apis'].map(t => <button key={t} data-on={tab === t} onClick={() => setTab(t)}>{t}</button>)}
          </div>
          <div style={{ position: 'relative' }}>
            <Icons.search size={12} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--fg-mute)' }}/>
            <input className="input" placeholder="Search…" style={{ paddingLeft: 26, width: 220 }}/>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <div className="grid-4">
          {data.map(x => (
            <div key={x.id} className="card lib-card">
              <div className="lib-thumb" style={{ background: tab === 'themes' ? `linear-gradient(135deg, ${x.swatches?.[0]}, ${x.swatches?.[1]})` : 'var(--n-2)' }}>
                {tab === 'components' && <Icons.cube size={24}/>}
                {tab === 'screens' && <Icons.grid size={24}/>}
                {tab === 'apis' && <Icons.send size={24}/>}
                {tab === 'themes' && <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{x.name}</span>}
              </div>
              <div style={{ padding: 10 }}>
                <div className="row gap-2">
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{x.name}</div>
                  <span className="pill mono" style={{ marginLeft: 'auto', fontSize: 9 }}>{x.tag || x.cat || x.kind || '—'}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--fg-mute)', marginTop: 2 }}>{x.updated ? `Updated ${x.updated}` : x.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.Header = Header;
window.SidebarRail = SidebarRail;
window.ThemesPanel = ThemesPanel;
window.ComponentsPanel = ComponentsPanel;
window.ScreensPanel = ScreensPanel;
window.APIsPanel = APIsPanel;
window.RunnerPanel = RunnerPanel;
window.LibraryPanel = LibraryPanel;
window.StylePresetPicker = StylePresetPicker;
window.ExportModal = ExportModal;
window.ComponentExportModal = ComponentExportModal;
window.SaveComponentModal = SaveComponentModal;
window.AddLibraryModal = AddLibraryModal;
window.ThemePickerDropdown = ThemePickerDropdown;
