/**
 * Returns the main.tsx template for the generated/ app.
 *
 * Lives in its own file (not templates.ts) because the iframe-bridge code
 * (hotspot position tracking, link-mode, element-select) makes it the
 * second-largest template in the package.
 *
 * See ./scaffold-shadcn.ts for the barrel re-export.
 */

/**
 * Returns the main.tsx for the generated/ app.
 * Wraps App with QueryClientProvider (TanStack Query) and BrowserRouter.
 */
export function getGeneratedMainTsx(): string {
  return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient()

// Hotspot position tracking
let __hotspots: { id: string; portId?: string; selector: string }[] = [];
let __linkModeCleanup: (() => void) | null = null;
let __retryHandle = 0;

function sendHotspotPositions() {
  if (!__hotspots.length) return;
  const positions: Record<string, { x: number; y: number; w: number; h: number }> = {};
  let found = 0;
  for (const h of __hotspots) {
    try {
      const el = document.querySelector(h.selector);
      if (el) {
        const r = el.getBoundingClientRect();
        // key by id (new) — portId is kept for backward compat with older parents
        positions[h.id] = { x: r.left, y: r.top, w: r.width, h: r.height };
        found++;
      }
    } catch (_) { /* ignore invalid selectors */ }
  }
  window.parent.postMessage({ type: '__hotspot-positions', positions }, '*');
  // React renders async after onLoad — retry until elements appear (up to ~1s)
  if (found < __hotspots.length && __retryHandle < 60) {
    __retryHandle++;
    requestAnimationFrame(sendHotspotPositions);
  } else {
    __retryHandle = 0;
  }
}

document.addEventListener('scroll', sendHotspotPositions, { capture: true, passive: true });
window.addEventListener('resize', sendHotspotPositions, { passive: true });

// Global message listener
window.addEventListener('message', (event) => {
  if (event.data?.type === '__set-hotspots') {
    __hotspots = (event.data.hotspots as { id: string; portId?: string; selector: string }[]) || [];
    __retryHandle = 0;
    sendHotspotPositions();
    return;
  }
  if (event.data?.type === 'disable-link-mode') {
    __linkModeCleanup?.();
    __linkModeCleanup = null;
    return;
  }
  if (event.data?.type === 'enable-element-select') {
    if (!document.body) return;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:50;cursor:crosshair;background:rgba(0,120,255,0.1);pointer-events:all;';
    const info = document.createElement('div');
    info.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);background:#0078ff;color:white;padding:6px 12px;border-radius:4px;font-size:12px;font-family:system-ui,sans-serif;z-index:51;';
    info.textContent = 'Click an element to select it (Esc to cancel)';
    overlay.appendChild(info);
    document.body.appendChild(overlay);

    const cleanup = () => {
      overlay.remove();
      document.removeEventListener('click', handler, true);
      document.removeEventListener('keydown', keyHandler);
    };

    const handler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement;
      window.parent.postMessage({
        type: 'element-selected',
        elementTag: target.tagName.toLowerCase(),
        elementText: (target.innerText || '').trim().slice(0, 50),
        elementId: target.id || '',
      }, '*');
      cleanup();
    };

    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup(); };

    document.addEventListener('click', handler, true);
    document.addEventListener('keydown', keyHandler);
    return;
  }

  // find-element-at: parent asks iframe to find element at coords and report selector+rect
  if (event.data?.type === 'find-element-at') {
    const { x, y, portId } = event.data;
    if (!document.body) return;
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    console.log('[find-element-at] checking point', x, y, '→ element:', el);
    if (!el || el === document.body || el === document.documentElement) {
      console.log('[find-element-at] no valid element at', x, y);
      return;
    }
    const rect = el.getBoundingClientRect();
    console.log('[find-element-at] found:', el.tagName, el.className, el.id, el);
    window.parent.postMessage({
      type: 'hotspot-created',
      portId,
      selector: getSelector(el),
      elementTag: el.tagName.toLowerCase(),
      elementText: (el.innerText || '').trim().slice(0, 50),
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      loc: el.closest('[data-source-loc]')?.getAttribute('data-source-loc') ?? undefined,
    }, '*');
    return;
  }

  // Link mode: hover highlights, click creates hotspot and fires element-selected
  if (event.data?.type === 'enable-link-mode') {
    if (!document.body) return;

    const info = document.createElement('div');
    info.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);background:#06b6d4;color:white;padding:6px 12px;border-radius:4px;font-size:12px;font-family:system-ui,sans-serif;z-index:51;pointer-events:none;';
    info.textContent = 'Click an element to select it (Esc to cancel)';
    document.body.appendChild(info);

    const style = document.createElement('style');
    style.textContent = '*{cursor:crosshair !important;} [data-link-hover]{outline:2px solid #06b6d4!important;outline-offset:-2px!important;background:rgba(6,182,212,0.15)!important;}';
    document.head.appendChild(style);

    let hoveredEl: HTMLElement | null = null;

    const hoverHandler = (e: MouseEvent) => {
      if (hoveredEl) hoveredEl.removeAttribute('data-link-hover');
      hoveredEl = e.target as HTMLElement;
      hoveredEl.setAttribute('data-link-hover', '');
    };

    const clickHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement;
      console.log('[link-mode] clicked element:', target, target.tagName, target.className, target.id, target.innerText?.slice(0, 30));
      const rect = target.getBoundingClientRect();
      const selector = getSelector(target);
      window.parent.postMessage({
        type: 'element-selected',
        elementTag: target.tagName.toLowerCase(),
        elementText: (target.innerText || '').trim().slice(0, 50),
        elementId: target.id || '',
        selector,
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      }, '*');
      cleanup();
    };

    const cleanup = () => {
      info.remove();
      style.remove();
      if (hoveredEl) hoveredEl.removeAttribute('data-link-hover');
      document.removeEventListener('mouseover', hoverHandler, true);
      document.removeEventListener('click', clickHandler, true);
      document.removeEventListener('keydown', keyHandler);
      __linkModeCleanup = null;
    };

    __linkModeCleanup = cleanup;
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup(); };

    document.addEventListener('mouseover', hoverHandler, true);
    document.addEventListener('click', clickHandler, true);
    document.addEventListener('keydown', keyHandler);
  }
});

function getSelector(el: Element): string {
  if (el.id) return '#' + el.id;
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    const parentEl: HTMLElement | null = current.parentElement;
    if (!parentEl) break;
    const tag = current.tagName.toLowerCase();
    const siblings = Array.from(parentEl.children).filter((c: Element) => c.tagName === current!.tagName);
    const idx = siblings.indexOf(current) + 1;
    parts.unshift(siblings.length > 1 ? tag + ':nth-of-type(' + idx + ')' : tag);
    current = parentEl;
  }
  return parts.join(' > ');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
`;
}
