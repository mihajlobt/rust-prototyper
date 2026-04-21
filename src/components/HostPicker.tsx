import { useState, useEffect, useRef } from "react";
import { Icons } from "@/icons";

export function HostPicker() {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState("localhost:11434");
  const [input, setInput] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setInput(host);
    const h = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const save = () => { if (input.trim()) setHost(input.trim()); setOpen(false); };

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button className="pill mono" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer", border: open ? "1px solid var(--acc)" : undefined }}>
        <span className="sdot sdot--ok" /> <Icons.cpu size={11} /> {host}
      </button>
      {open && (
        <div className="mp-pop" style={{ minWidth: 220, padding: 10 }}>
          <div className="caps" style={{ fontSize: 9, marginBottom: 6 }}>Ollama Host</div>
          <input
            className="input mono"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            autoFocus
            placeholder="host:port"
            style={{ width: "100%", fontSize: 11 }}
          />
          <div className="row gap-2" style={{ marginTop: 8, justifyContent: "flex-end" }}>
            <button className="btn" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--acc" style={{ padding: "4px 8px", fontSize: 11 }} onClick={save}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
