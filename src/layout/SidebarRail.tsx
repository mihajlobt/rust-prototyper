import { Icons } from "@/icons";
import { LIB_SCREENS, LIB_COMPONENTS, LIB_THEMES, LIB_APIS } from "@/data";

export function SidebarRail({ activeView }: { activeView: string }) {
  const content: Record<string, { title: string; items: { id: string; label: string; sub?: string }[] } | null> = {
    screens:    { title: "Screens",    items: LIB_SCREENS.map((s) => ({ id: s.id, label: s.name, sub: s.updated })) },
    components: { title: "Components", items: LIB_COMPONENTS.map((c) => ({ id: c.id, label: c.name, sub: c.tag })) },
    library:    { title: "Assets",     items: [...LIB_COMPONENTS.slice(0, 3), ...LIB_THEMES.slice(0, 3)].map((x) => ({ id: x.id, label: x.name })) },
    themes:     { title: "Themes",     items: LIB_THEMES.map((t) => ({ id: t.id, label: t.name, sub: t.cat })) },
    workflows:  null,
    apis:       { title: "APIs",       items: LIB_APIS.map((a) => ({ id: a.id, label: a.name, sub: a.kind })) },
    runner:     { title: "Files",      items: [
      { id: "f1", label: "package.json" },
      { id: "f2", label: "src/App.tsx" },
      { id: "f3", label: "src/index.css" },
      { id: "f4", label: "src/components/LoginCard.tsx" },
      { id: "f5", label: "public/favicon.svg" },
    ]},
  };
  const c = content[activeView];
  if (!c) return null;
  return (
    <div className="panel" style={{ width: 220 }}>
      <div className="panel-head">
        <div className="panel-title">{c.title}</div>
        <span className="pill" style={{ marginLeft: "auto" }}>{c.items.length}</span>
        <button className="icon-btn"><Icons.plus size={13} /></button>
      </div>
      <div style={{ padding: 8, overflow: "auto", flex: 1 }}>
        {c.items.map((i) => (
          <div key={i.id} className="rail-item">
            <span style={{ fontSize: 12 }}>{i.label}</span>
            {i.sub && <span style={{ fontSize: 10, color: "var(--fg-mute)", marginLeft: "auto" }}>{i.sub}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
