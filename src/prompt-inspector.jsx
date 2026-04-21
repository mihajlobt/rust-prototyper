// Prompt inspector + attachments composer.
// Exposed: window.AttachComposer, window.PromptInspector, window.MODELS, window.ModelPicker
const { useState: uS2, useEffect: uE2, useMemo: uM2, useRef: uR2 } = React;

// CodeMirror wrapper
function CodeMirrorEditor({ value, mode, readOnly = true, theme, style }) {
  const ref = uR2(null);
  const cmRef = uR2(null);
  uE2(() => {
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
  uE2(() => {
    if (cmRef.current && theme) cmRef.current.setOption('theme', theme);
  }, [theme]);
  return <div ref={ref} style={{ fontSize: 12, flex: 1, minHeight: 0, ...style }}/>;
}

// ─────────────────────────────────────────────────────────────
// Model catalog (mocked) — some support vision, some don't.
const MODELS = [
  { id: 'qwen2.5-coder:32b', family: 'qwen', ctx: 32768, vision: false, local: true,  size: '18.5 GB' },
  { id: 'llama3.2-vision:11b', family: 'llama', ctx: 128000, vision: true, local: true, size: '7.9 GB' },
  { id: 'llava:13b',          family: 'llava', ctx: 8192,  vision: true,  local: true,  size: '8.0 GB' },
  { id: 'deepseek-r1:14b',    family: 'ds',    ctx: 65536, vision: false, local: true,  size: '8.9 GB' },
  { id: 'claude-sonnet-4.5',  family: 'claude',ctx: 200000,vision: true,  local: false, size: 'api' },
  { id: 'gpt-4o',             family: 'oai',   ctx: 128000,vision: true,  local: false, size: 'api' },
];

function ModelPicker({ value, onChange }) {
  const [open, setOpen] = uS2(false);
  const m = MODELS.find(x => x.id === value) || MODELS[0];
  const rootRef = uR2(null);
  uE2(() => {
    if (!open) return;
    const h = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        className="pill mono"
        onClick={() => setOpen(o => !o)}
        style={{ cursor: 'pointer', border: open ? '1px solid var(--acc)' : undefined }}
      >
        <Icons.cube size={11} style={{ color: 'var(--fg-mute)', marginRight: 4 }}/>
        {m.id}
        {m.vision && <span className="vision-badge" title="Supports images">👁</span>}
        <Icons.chevD size={10} style={{ opacity: .6 }}/>
      </button>
      {open && (
        <div className="mp-pop">
          <div className="mp-head">
            <span className="caps" style={{ fontSize: 9 }}>Local (Ollama)</span>
            <span className="pill" style={{ marginLeft: 'auto', fontSize: 9 }}>{MODELS.filter(x=>x.local).length}</span>
          </div>
          {MODELS.filter(x => x.local).map(x => (
            <button key={x.id} className="mp-row" data-on={x.id === value} onClick={() => { onChange?.(x.id); setOpen(false); }}>
              <Icons.cpu size={12}/>
              <span className="mono" style={{ fontSize: 11 }}>{x.id}</span>
              {x.vision && <span className="vision-badge" title="Vision">👁</span>}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-mute)' }}>{x.size}</span>
            </button>
          ))}
          <div className="mp-head" style={{ marginTop: 4 }}>
            <span className="caps" style={{ fontSize: 9 }}>Remote</span>
          </div>
          {MODELS.filter(x => !x.local).map(x => (
            <button key={x.id} className="mp-row" data-on={x.id === value} onClick={() => { onChange?.(x.id); setOpen(false); }}>
              <Icons.send size={12}/>
              <span className="mono" style={{ fontSize: 11 }}>{x.id}</span>
              {x.vision && <span className="vision-badge" title="Vision">👁</span>}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-mute)' }}>{x.size}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Image attachments composer
// Props: attachments [{id, name, size, preview, w, h}], setAttachments, model (obj), disabled, onSend, onOpenPrompt, placeholder, value, setValue, showUpdate
function AttachComposer({
  value, setValue, attachments, setAttachments, model,
  onSend, onOpenPrompt, placeholder, showUpdate = true, sendLabel = 'Generate'
}) {
  const inputRef = uR2(null);
  const [drag, setDrag] = uS2(false);
  const canVision = !!model?.vision;

  const addFiles = (files) => {
    const now = Date.now();
    const arr = [...files].filter(f => f.type.startsWith('image/'));
    const items = arr.map((f, i) => ({
      id: `a${now}-${i}`,
      name: f.name || `pasted-${i+1}.png`,
      size: f.size,
      type: f.type,
      // fake a preview URL — for demo, use a known public placeholder pattern
      preview: null,
      // dimensions (filled after onload)
      w: null, h: null,
    }));
    // Try to build object URLs for real selected files
    arr.forEach((f, i) => {
      try {
        const url = URL.createObjectURL(f);
        items[i].preview = url;
        const img = new Image();
        img.onload = () => {
          items[i].w = img.naturalWidth;
          items[i].h = img.naturalHeight;
          setAttachments(a => a.map(x => x.id === items[i].id ? { ...x, w: img.naturalWidth, h: img.naturalHeight } : x));
        };
        img.src = url;
      } catch (e) {}
    });
    setAttachments(a => [...a, ...items]);
  };

  const onPaste = (e) => {
    const its = e.clipboardData?.items || [];
    const imgs = [...its].filter(it => it.type.startsWith('image/')).map(it => it.getAsFile()).filter(Boolean);
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  };

  const removeAtt = (id) => setAttachments(a => a.filter(x => x.id !== id));

  return (
    <div
      className={cx('attach-composer', drag && 'attach-composer--drag', !canVision && attachments.length > 0 && 'attach-composer--warn')}
      onDragOver={(e) => { if (canVision) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (canVision) addFiles(e.dataTransfer.files); }}
    >
      {/* Attachment chips row */}
      {attachments.length > 0 && (
        <div className="attach-row">
          {attachments.map(a => (
            <div key={a.id} className="attach-chip" title={`${a.name} · ${a.w||'?'}×${a.h||'?'}`}>
              {a.preview ? (
                <img src={a.preview} alt={a.name}/>
              ) : (
                <div className="attach-chip-ph"><Icons.image size={12}/></div>
              )}
              <div className="attach-chip-meta">
                <div className="attach-chip-name">{a.name}</div>
                <div className="attach-chip-sub mono">{a.w && a.h ? `${a.w}×${a.h}` : 'image'}</div>
              </div>
              <button className="attach-chip-x" onClick={() => removeAtt(a.id)} title="Remove"><Icons.x size={10}/></button>
            </div>
          ))}
          {!canVision && (
            <div className="attach-warn">
              <Icons.image size={11}/> Images ignored — <span style={{ textDecoration: 'underline' }}>{model?.id}</span> doesn't support vision
            </div>
          )}
        </div>
      )}

      <textarea
        className="textarea"
        placeholder={placeholder || 'Describe the screen or refine…'}
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPaste={onPaste}
      />

      <div className="row gap-2" style={{ marginTop: 6, alignItems: 'center' }}>
        <button
          className="icon-btn"
          title={canVision ? 'Attach image' : 'Current model has no vision — switch models'}
          onClick={() => canVision && inputRef.current?.click()}
          style={{ opacity: canVision ? 1 : .5 }}
        >
          <Icons.clip size={13}/>
        </button>
        <button className="icon-btn" title="Show full prompt" onClick={onOpenPrompt}>
          <Icons.eye size={13}/>
        </button>
        {showUpdate && (
          <label className="row gap-1" style={{ fontSize: 11, color: 'var(--fg-mute)' }}>
            <input type="checkbox" defaultChecked/> Update existing
          </label>
        )}
        <div style={{ flex: 1 }}/>
        <span className="mono" style={{ fontSize: 10, color: 'var(--fg-mute)' }}>
          {value.trim().split(/\s+/).filter(Boolean).length} words
        </span>
        <button className="btn btn--acc" style={{ padding: '6px 12px' }} onClick={onSend}>
          <Icons.zap size={12}/> {sendLabel}
          <span className="kbd" style={{ marginLeft: 4 }}>⌘↵</span>
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
      />
      {drag && <div className="attach-drop-overlay"><Icons.upload size={20}/><div>Drop images to attach</div></div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Prompt Inspector drawer
// Props: open, onClose, title, model, system, messages [{role, content}], user, attachments, tools
function PromptInspector({ open, onClose, title, model, system, messages, user, attachments = [], tools = [], cmTheme }) {
  const [tab, setTab] = uS2('assembled');
  const [raw, setRaw] = uS2(false);
  if (!open) return null;

  const m = MODELS.find(x => x.id === model) || MODELS[0];

  // Build the "assembled" prompt in a realistic way
  const blocks = [];
  blocks.push({ tag: 'system', label: 'System', body: system });
  tools.forEach((t, i) => blocks.push({ tag: 'tool', label: `Tool · ${t.name}`, body: t.body }));
  messages.forEach((msg, i) => blocks.push({ tag: msg.role, label: `${msg.role} · turn ${i+1}`, body: msg.content }));
  if (attachments.length && m.vision) {
    blocks.push({
      tag: 'images',
      label: `Attached images · ${attachments.length}`,
      body: attachments.map((a, i) => `[image_${i+1}] ${a.name} (${a.w||'?'}×${a.h||'?'}, ${formatBytes(a.size)}) — encoded as base64`).join('\n'),
    });
  }
  if (user) blocks.push({ tag: 'user', label: `user · new turn`, body: user });

  // Rough token estimate: 4 chars/token
  const totalChars = blocks.reduce((s, b) => s + (b.body?.length || 0), 0) + attachments.length * 900;
  const estTokens = Math.round(totalChars / 4);
  const ctxPct = Math.min(100, (estTokens / m.ctx) * 100);

  const copyAll = () => {
    const text = blocks.map(b => `<|${b.tag}|>\n${b.body}\n<|/${b.tag}|>`).join('\n\n');
    try { navigator.clipboard.writeText(text); } catch {}
  };

  return (
    <div className="pi-backdrop" onClick={onClose}>
      <div className="pi-drawer" onClick={e => e.stopPropagation()}>
        <div className="pi-head">
          <div className="col">
            <div className="pi-title">{title || 'Full prompt'}</div>
            <div className="pi-sub">Exactly what will be sent to the model</div>
          </div>
          <div style={{ flex: 1 }}/>
          <div className="seg">
            <button data-on={tab === 'assembled'} onClick={() => setTab('assembled')}>Assembled</button>
            <button data-on={tab === 'json'} onClick={() => setTab('json')}>JSON payload</button>
            <button data-on={tab === 'curl'} onClick={() => setTab('curl')}>cURL</button>
          </div>
          <button className="icon-btn" onClick={copyAll} title="Copy"><Icons.copy size={13}/></button>
          <button className="icon-btn" onClick={onClose} title="Close"><Icons.x size={13}/></button>
        </div>

        <div className="pi-meta">
          <div className="pi-meta-item"><span className="caps">Model</span><span className="mono">{m.id} {m.vision && '👁'}</span></div>
          <div className="pi-meta-item"><span className="caps">Endpoint</span><span className="mono">POST localhost:11434/api/chat</span></div>
          <div className="pi-meta-item"><span className="caps">Temp</span><span className="mono">0.7</span></div>
          <div className="pi-meta-item"><span className="caps">Blocks</span><span className="mono">{blocks.length}</span></div>
          <div className="pi-meta-item pi-meta-item--tokens">
            <span className="caps">Context</span>
            <div className="pi-bar">
              <div className="pi-bar-fill" style={{ width: `${ctxPct}%` }}/>
            </div>
            <span className="mono" style={{ fontSize: 10 }}>~{estTokens.toLocaleString()} / {m.ctx.toLocaleString()}</span>
          </div>
        </div>

        <div className="pi-body">
          {tab === 'assembled' && (
            <div className="pi-blocks">
              {blocks.map((b, i) => (
                <div key={i} className={`pi-block pi-block--${b.tag}`}>
                  <div className="pi-block-head">
                    <span className={`pi-block-tag pi-block-tag--${b.tag}`}>{b.tag}</span>
                    <span className="pi-block-label">{b.label}</span>
                    <span style={{ flex: 1 }}/>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--fg-mute)' }}>
                      ~{Math.round((b.body?.length||0) / 4)} tok
                    </span>
                  </div>
                  <div className="pi-block-body">
                    <CodeMirrorEditor mode="markdown" theme={cmTheme} value={b.body} style={{ minHeight: 40 }}/>
                  </div>
                  {b.tag === 'images' && (
                    <div className="pi-img-row">
                      {attachments.map((a, j) => (
                        <div key={a.id} className="pi-img-thumb">
                          {a.preview && <img src={a.preview} alt={a.name}/>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {tab === 'json' && (
            <CodeMirrorEditor mode="javascript" theme={cmTheme} value={JSON.stringify({
              model: m.id,
              messages: [
                { role: 'system', content: system },
                ...messages,
                ...(user ? [{
                  role: 'user',
                  content: attachments.length && m.vision
                    ? [{ type: 'text', text: user }, ...attachments.map((a, i) => ({ type: 'image_url', image_url: { url: `data:${a.type};base64,…` }, meta: { name: a.name, w: a.w, h: a.h } }))]
                    : user
                }] : []),
              ],
              tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.body?.slice(0, 60) } })),
              stream: true,
              temperature: 0.7,
            }, null, 2)}/>
          )}
          {tab === 'curl' && (
            <CodeMirrorEditor mode="shell" theme={cmTheme} value={`curl -X POST http://localhost:11434/api.chat \\
  -H "Content-Type: application/json" \\
  -d @- <<'JSON'
${JSON.stringify({
  model: m.id,
  messages: [
    { role: 'system', content: (system||'').slice(0, 140) + '…' },
    ...messages.slice(-2),
    ...(user ? [{ role: 'user', content: user }] : []),
  ],
  stream: true,
}, null, 2)}
JSON`}/>
          )}
        </div>

        <div className="pi-foot">
          <span className="mono" style={{ fontSize: 10, color: 'var(--fg-mute)' }}>
            Prompt is rebuilt on every send — edit templates in <a className="link-sub">Settings → Prompts</a>
          </span>
          <div style={{ flex: 1 }}/>
          <button className="btn" onClick={copyAll}><Icons.copy size={12}/> Copy</button>
          <button className="btn btn--acc" onClick={onClose}><Icons.check size={12}/> Looks good</button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(n) {
  if (!n) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/(1024*1024)).toFixed(1) + ' MB';
}

window.MODELS = MODELS;
window.ModelPicker = ModelPicker;
window.AttachComposer = AttachComposer;
window.PromptInspector = PromptInspector;
