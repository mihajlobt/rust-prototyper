// Main app shell + Tweaks panel + workflow view composition.
const { useState: aS, useEffect: aE, useRef: aR, useMemo: aM } = React;

// Settings modal
function SettingsModal({ open, onClose, tw, setTw }) {
  const [section, setSection] = aS('appearance');
  const set = (k, v) => setTw({ ...tw, [k]: v });

  const codeThemes = [
    { id: 'monokai', label: 'Neon' },
    { id: 'dracula', label: 'Dracula' },
    { id: 'nord', label: 'Nord' },
    { id: 'material', label: 'Material' },
  ];

  const defaultPrompts = {
    component: `You are Prototyper's component generator. Output a single React/TSX function component using Tailwind v4. Library: shadcn/ui, lucide, motion, radix.`,
    screen: `You are Prototyper's screen generator. Output a single React/TSX screen as a default export. Use Tailwind v4 class names. Do not import icons — use inline SVG.`,
    theme: `You are a design system expert. Generate a CSS theme using OKLCH color tokens. Output Tailwind v4 compatible CSS variables with a cohesive palette.`,
  };
  const [prompts, setPrompts] = aS(defaultPrompts);
  const [promptTab, setPromptTab] = aS('component');

  const defaultStyles = [
    { id: 'auto', name: 'Auto', prompt: '' },
    { id: 'glass', name: 'Glassmorphism', prompt: 'Use glassmorphism with translucent frosted-glass surfaces, subtle backdrop blur, and thin light borders.' },
    { id: 'minimal', name: 'Minimal', prompt: 'Use a minimal, clean aesthetic with ample whitespace, thin typography, and restrained color usage.' },
    { id: 'neon', name: 'Neon', prompt: 'Use a neon cyberpunk aesthetic with high-contrast dark backgrounds, vibrant glowing accents, and sharp edges.' },
    { id: 'paper', name: 'Paper', prompt: 'Use a tactile paper/skeuomorphic aesthetic with soft shadows, realistic textures, and warm muted tones.' },
  ];
  const [styles, setStyles] = aS(defaultStyles);
  const [editingStyle, setEditingStyle] = aS(null);
  const [styleDraft, setStyleDraft] = aS({ name: '', prompt: '' });

  if (!open) return null;
  return (
    <div className="pi-backdrop" style={{ justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div className="card" style={{ width: 640, maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div className="pi-head" style={{ borderBottom: '1px solid var(--line-soft)', flexShrink: 0 }}>
          <div className="col">
            <div className="pi-title">Settings</div>
            <div className="pi-sub">Appearance, style presets and generator prompt configuration</div>
          </div>
          <div style={{ flex: 1 }}/>
          <button className="icon-btn" onClick={onClose}><Icons.x size={13}/></button>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Sidebar */}
          <div style={{ width: 160, borderRight: '1px solid var(--line-soft)', padding: 8, display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
            {[
              { id: 'appearance', label: 'Appearance', icon: 'sparkles' },
              { id: 'styles', label: 'Styles', icon: 'palette' },
              { id: 'prompts', label: 'Prompts', icon: 'terminal' },
            ].map(s => {
              const Ic = Icons[s.icon];
              return (
                <button key={s.id} className="rail-item" data-on={section === s.id} onClick={() => setSection(s.id)} style={{ justifyContent: 'flex-start', gap: 8, padding: '7px 10px' }}>
                  <Ic size={13}/>
                  <span style={{ fontSize: 12 }}>{s.label}</span>
                </button>
              );
            })}
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {section === 'appearance' && (
              <>
                <div className="tweaks-row">
                  <div className="caps">Accent</div>
                  <div className="row gap-1" style={{ flexWrap: 'wrap' }}>
                    {['teal','violet','amber','emerald','rose','cyan'].map(a => (
                      <button key={a} className="accent-sw" data-on={tw.accent === a} onClick={() => set('accent', a)}>
                        <span style={{ background: `var(--acc)`, ['--acc']: ({teal:'#4ee2c9',violet:'#a78bfa',amber:'#f5b151',emerald:'#5cd684',rose:'#ff7aa2',cyan:'#5dd8ff'})[a] }}/>
                        <span style={{ fontSize: 10 }}>{a}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="tweaks-row">
                  <div className="caps">Glow</div>
                  <div className="seg">
                    {['off','subtle','full'].map(g => <button key={g} data-on={tw.glow === g} onClick={() => set('glow', g)}>{g}</button>)}
                  </div>
                </div>
                <div className="tweaks-row">
                  <div className="caps">Density</div>
                  <div className="seg">
                    {['compact','comfortable','spacious'].map(d => <button key={d} data-on={tw.density === d} onClick={() => set('density', d)}>{d}</button>)}
                  </div>
                </div>
                <div className="tweaks-row">
                  <div className="caps">Node style</div>
                  <div className="seg">
                    {['pill','card','terminal'].map(x => <button key={x} data-on={tw.nodeStyle === x} onClick={() => set('nodeStyle', x)}>{x}</button>)}
                  </div>
                </div>
                <div className="tweaks-row">
                  <div className="caps">Edge style</div>
                  <div className="seg">
                    {['bezier','dashed'].map(x => <button key={x} data-on={tw.edgeStyle === x} onClick={() => set('edgeStyle', x)}>{x}</button>)}
                  </div>
                </div>
                <div className="tweaks-row">
                  <div className="caps">Grid</div>
                  <div className="seg">
                    {['dots','lines','none'].map(x => <button key={x} data-on={tw.grid === x} onClick={() => set('grid', x)}>{x}</button>)}
                  </div>
                </div>
                <div className="tweaks-row">
                  <div className="caps">Run metaphor</div>
                  <div className="seg">
                    {['pulse','ring','stream'].map(x => <button key={x} data-on={tw.runFx === x} onClick={() => set('runFx', x)}>{x}</button>)}
                  </div>
                </div>
                <div className="tweaks-row">
                  <div className="caps">CodeMirror theme</div>
                  <div className="seg">
                    {codeThemes.map(t => <button key={t.id} data-on={tw.cmTheme === t.id} onClick={() => set('cmTheme', t.id)}>{t.label}</button>)}
                  </div>
                </div>
              </>
            )}

            {section === 'styles' && (
              <>
                <div className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="caps">Style Presets</div>
                  <button className="btn btn--acc" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => { setEditingStyle('new'); setStyleDraft({ name: '', prompt: '' }); }}>
                    <Icons.plus size={11}/> Add style
                  </button>
                </div>
                <div className="col gap-2">
                  {editingStyle === 'new' && (
                    <div className="card" style={{ padding: 10, borderColor: 'var(--acc)', background: 'var(--acc-soft)' }}>
                      <div className="row gap-2" style={{ alignItems: 'center', marginBottom: 8 }}>
                        <input className="input" value={styleDraft.name} onChange={(e) => setStyleDraft({ ...styleDraft, name: e.target.value })} placeholder="Name…" style={{ flex: 1, fontSize: 12 }}/>
                        <button className="icon-btn" onClick={() => setEditingStyle(null)}><Icons.x size={12}/></button>
                      </div>
                      <textarea className="textarea mono" rows={3} value={styleDraft.prompt} onChange={(e) => setStyleDraft({ ...styleDraft, prompt: e.target.value })} placeholder="Style prompt injection…" style={{ fontSize: 11, marginBottom: 8 }}/>
                      <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setEditingStyle(null)}>Cancel</button>
                        <button className="btn btn--acc" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => { setStyles(ss => [...ss, { id: 'st' + Date.now(), ...styleDraft }]); setEditingStyle(null); }}>Save</button>
                      </div>
                    </div>
                  )}
                  {styles.map(s => (
                    <div key={s.id} className="card" style={{ padding: 10, transition: 'border-color .12s' }}>
                      {editingStyle === s.id ? (
                        <>
                          <div className="row gap-2" style={{ alignItems: 'center', marginBottom: 8 }}>
                            <input className="input" value={styleDraft.name} onChange={(e) => setStyleDraft({ ...styleDraft, name: e.target.value })} style={{ flex: 1, fontSize: 12 }}/>
                            <button className="icon-btn" onClick={() => setEditingStyle(null)}><Icons.x size={12}/></button>
                          </div>
                          <textarea className="textarea mono" rows={3} value={styleDraft.prompt} onChange={(e) => setStyleDraft({ ...styleDraft, prompt: e.target.value })} style={{ fontSize: 11, marginBottom: 8 }}/>
                          <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setEditingStyle(null)}>Cancel</button>
                            <button className="btn btn--acc" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => { setStyles(ss => ss.map(x => x.id === s.id ? { ...x, ...styleDraft } : x)); setEditingStyle(null); }}>Save</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="row gap-2" style={{ alignItems: 'center' }}>
                            <span style={{ fontSize: 12, fontWeight: 500 }}>{s.name}</span>
                            <div className="row gap-1" style={{ marginLeft: 'auto' }}>
                              {s.id === 'auto' ? (
                                <span className="pill mono" style={{ fontSize: 9 }}>no injection</span>
                              ) : (
                                <>
                                  <button className="icon-btn" title="Edit" onClick={(e) => { e.stopPropagation(); setEditingStyle(s.id); setStyleDraft({ name: s.name, prompt: s.prompt }); }}>
                                    <Icons.cog size={12}/>
                                  </button>
                                  <button className="icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); setStyles(ss => ss.filter(x => x.id !== s.id)); }}>
                                    <Icons.trash size={12}/>
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          {s.prompt && <div style={{ fontSize: 11, color: 'var(--fg-mute)', marginTop: 4, lineHeight: 1.4 }}>{s.prompt}</div>}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {section === 'prompts' && (
              <>
                <div className="seg" style={{ alignSelf: 'flex-start' }}>
                  {['component','screen','theme'].map(t => <button key={t} data-on={promptTab === t} onClick={() => setPromptTab(t)}>{t}</button>)}
                </div>
                <div className="caps">System prompt — {promptTab}</div>
                <textarea
                  className="textarea mono"
                  rows={10}
                  value={prompts[promptTab]}
                  onChange={(e) => setPrompts({ ...prompts, [promptTab]: e.target.value })}
                />
                <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn" style={{ padding: '5px 10px', fontSize: 11 }} onClick={() => setPrompts(defaultPrompts)}><Icons.zap size={11}/> Reset defaults</button>
                  <button className="btn btn--acc" style={{ padding: '5px 10px', fontSize: 11 }}><Icons.check size={12}/> Save</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Workflows view
function WorkflowsView({ tw }) {
  const [nodes, setNodes] = aS(STARTER_NODES);
  const [edges] = aS(STARTER_EDGES);
  const [selectedId, setSelectedId] = aS('n3');
  const [tab, setTab] = aS('canvas');
  const [query, setQuery] = aS('');
  const [running, setRunning] = aS(false);
  const [runState, setRunState] = aS({ active: [], done: [] });

  aE(() => {
    if (!running) return;
    const order = ['n1','n2','n3','n4','n5','n6','n7','n8'];
    let i = 0;
    const done = [];
    const tick = () => {
      if (i >= order.length) { setRunning(false); setRunState({ active: [], done: order }); return; }
      setRunState({ active: [order[i]], done: [...done] });
      done.push(order[i]); i++;
      setTimeout(tick, 900);
    };
    tick();
  }, [running]);

  const onDragStart = (e, type) => e.dataTransfer.setData('node/type', type);
  const onDrop = (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('node/type');
    if (!type) return;
    const r = e.currentTarget.getBoundingClientRect();
    const def = NODE_LOOKUP[type];
    const id = 'n' + (nodes.length + 1);
    setNodes(ns => [...ns, { id, type, x: e.clientX - r.left, y: e.clientY - r.top, label: def.label, subtitle: def.desc }]);
  };

  const sel = nodes.find(n => n.id === selectedId);
  const patch = (p) => setNodes(ns => ns.map(n => n.id === selectedId ? { ...n, ...p } : n));

  return (
    <div className="wf-view">
      <NodePalette onDragStart={onDragStart} query={query} setQuery={setQuery}/>
      <WorkflowsBrowser activeTab={tab} setActiveTab={setTab}/>
      <div className="split-pane" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="wf-toolbar">
          <div className="pill mono">Simple Component</div>
          <div style={{ flex: 1 }}/>
          <button className="btn"><Icons.save size={12}/> Save</button>
          <button className={cx('btn', running ? '' : 'btn--acc')} onClick={() => setRunning(!running)}>
            {running ? <><Icons.stop size={11}/> Stop</> : <><Icons.play size={11}/> Run</>}
          </button>
        </div>
        <WorkflowCanvas
          nodes={nodes} setNodes={setNodes} edges={edges}
          selectedId={selectedId} setSelectedId={setSelectedId}
          running={running} runState={runState}
          edgeStyle={tw.edgeStyle}
        />
      </div>
      <PropertiesPanel node={sel} onPatch={patch}/>
    </div>
  );
}

// Main app
function App() {
  const [view, setView] = aS(() => localStorage.getItem('pt.view') || 'workflows');
  const [showTweaks, setShowTweaks] = aS(false);
  const [modelId, setModelId] = aS(() => localStorage.getItem('pt.model') || 'qwen2.5-coder:32b');
  const [project, setProject] = aS(() => localStorage.getItem('pt.project') || 'Default Project');
  const [stylePreset, setStylePreset] = aS(() => localStorage.getItem('pt.style') || 'Auto');
  aE(() => { localStorage.setItem('pt.project', project); }, [project]);
  aE(() => { localStorage.setItem('pt.style', stylePreset); }, [stylePreset]);
  aE(() => { localStorage.setItem('pt.model', modelId); window.__model = modelId; }, [modelId]);
  aE(() => {
    const h = (e) => setModelId(e.detail);
    window.addEventListener('__modelchange', h);
    return () => window.removeEventListener('__modelchange', h);
  }, []);
  const defaults = /*EDITMODE-BEGIN*/{
    "accent": "teal",
    "glow": "subtle",
    "density": "comfortable",
    "nodeStyle": "card",
    "edgeStyle": "bezier",
    "grid": "dots",
    "runFx": "pulse",
    "cmTheme": "monokai"
  }/*EDITMODE-END*/;
  const [tw, setTw] = aS(defaults);

  aE(() => { localStorage.setItem('pt.view', view); }, [view]);

  // Persist via host
  aE(() => {
    const t = setTimeout(() => {
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: tw }, '*');
    }, 250);
    return () => clearTimeout(t);
  }, [tw]);

  // Tweaks activation protocol
  aE(() => {
    const onMsg = (e) => {
      if (e.data?.type === '__activate_edit_mode') setShowTweaks(true);
      if (e.data?.type === '__deactivate_edit_mode') setShowTweaks(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Apply global classes
  const rootCls = cx(
    tw.glow === 'subtle' && 'glow-on',
    tw.glow === 'full'   && 'glow-full',
    tw.grid === 'lines'  && 'grid-lines',
    tw.grid === 'none'   && 'grid-none',
  );

  return (
    <div className={cx('app', rootCls)} data-accent={tw.accent} data-density={tw.density} data-nodestyle={tw.nodeStyle} data-screen-label={view === 'workflows' ? '05 Workflows' : view}>
      <Header activeView={view} setActiveView={setView} project={project} setProject={setProject} openSettings={() => setShowTweaks(!showTweaks)} modelId={modelId} setModelId={setModelId} stylePreset={stylePreset} setStylePreset={setStylePreset}/>
      <div className="app-body">
        {(view === 'screens' || view === 'components') && <SidebarRail activeView={view}/>}
        {view === 'workflows' && <WorkflowsView tw={tw}/>}
        {view === 'screens'    && <ScreensPanel modelId={modelId} cmTheme={tw.cmTheme}/>}
        {view === 'components' && <ComponentsPanel modelId={modelId} cmTheme={tw.cmTheme}/>}
        {view === 'themes'     && <ThemesPanel cmTheme={tw.cmTheme}/>}
        {view === 'apis'       && <APIsPanel cmTheme={tw.cmTheme}/>}
        {view === 'runner'     && <RunnerPanel cmTheme={tw.cmTheme}/>}
        {view === 'library'    && <LibraryPanel/>}
      </div>
      <SettingsModal open={showTweaks} onClose={() => setShowTweaks(false)} tw={tw} setTw={setTw}/>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
