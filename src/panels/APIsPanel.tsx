import { useState } from "react";
import { Icons } from "@/icons";
import { LIB_APIS, cx } from "@/data";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";

function EndpointsTab() {
  const eps = [
    { m: "GET", path: "/v1/customers", desc: "List customers", auth: "🔒" },
    { m: "POST", path: "/v1/customers", desc: "Create customer", auth: "🔒" },
    { m: "GET", path: "/v1/customers/{id}", desc: "Retrieve customer", auth: "🔒" },
    { m: "GET", path: "/v1/charges", desc: "List charges", auth: "🔒" },
    { m: "POST", path: "/v1/charges", desc: "Create charge", auth: "🔒" },
    { m: "GET", path: "/v1/subscriptions", desc: "List subscriptions", auth: "🔒" },
  ];
  return (
    <div style={{ overflow: "auto", flex: 1 }}>
      {eps.map((e, i) => (
        <div key={i} className="endpoint-row">
          <span className={cx("method-pill", `method-pill--${e.m.toLowerCase()}`)}>{e.m}</span>
          <span className="mono" style={{ fontSize: 12, flex: 1 }}>{e.path}</span>
          <span style={{ fontSize: 11, color: "var(--fg-mute)" }}>{e.desc}</span>
          <span style={{ fontSize: 11, color: "var(--fg-mute)" }}>{e.auth}</span>
          <Icons.chevR size={12} style={{ color: "var(--fg-mute)" }} />
        </div>
      ))}
    </div>
  );
}

function AuthTab() {
  return (
    <div className="pad-5" style={{ overflow: "auto", flex: 1 }}>
      <div className="caps">Scheme</div>
      <div className="seg" style={{ marginTop: 4 }}>
        <button data-on="true">Bearer</button><button>API key</button><button>Basic</button><button>OAuth 2</button><button>None</button>
      </div>
      <div className="caps" style={{ marginTop: 14 }}>Token</div>
      <input className="input mono" defaultValue="sk_test_51J***********************" />
      <div className="caps" style={{ marginTop: 14 }}>Header</div>
      <input className="input mono" defaultValue="Authorization: Bearer {{token}}" />
    </div>
  );
}

function SchemasTab({ cmTheme }: { cmTheme: string }) {
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
};`} />
  );
}

function TestTab({ cmTheme }: { cmTheme: string }) {
  return (
    <div className="col" style={{ flex: 1 }}>
      <div className="pad-4">
        <div className="row gap-2">
          <span className="method-pill method-pill--get">GET</span>
          <input className="input mono" defaultValue="/v1/customers?limit=3" />
          <button className="btn btn--acc"><Icons.play size={11} /> Send</button>
        </div>
      </div>
      <div className="hair" />
      <CodeMirrorEditor mode="javascript" theme={cmTheme} value={`{
  "object": "list",
  "data": [
    { "id": "cus_OaBcDe", "email": "liz@acme.io", "created": 1708031920 },
    { "id": "cus_OaXyZw", "email": "sam@acme.io", "created": 1708030011 },
    { "id": "cus_ObQrSt", "email": "dave@acme.io", "created": 1708021002 }
  ],
  "has_more": true
}`} />
    </div>
  );
}

export function APIsPanel({ cmTheme }: { cmTheme: string }) {
  const [active, setActive] = useState("a1");
  const [tab, setTab] = useState("endpoints");
  const api = LIB_APIS.find((a) => a.id === active) ?? LIB_APIS[0]!;
  return (
    <div className="view-body">
      <div className="view-head">
        <div>
          <div className="view-title">APIs & Integrations</div>
          <div className="view-sub">Define endpoints, attach them to nodes, and call them from generated apps.</div>
        </div>
        <div className="row gap-2">
          <button className="btn"><Icons.file size={12} /> Import OpenAPI</button>
          <button className="btn"><Icons.terminal size={12} /> Paste cURL</button>
          <button className="btn btn--acc"><Icons.plus size={12} /> New API</button>
        </div>
      </div>
      <div className="split">
        <div className="split-pane" style={{ maxWidth: 260 }}>
          <div className="panel-head"><div className="panel-title">Saved APIs</div><span className="pill" style={{ marginLeft: "auto" }}>{LIB_APIS.length}</span></div>
          <div style={{ overflow: "auto", flex: 1, padding: 8 }}>
            {LIB_APIS.map((a) => (
              <div key={a.id} className="rail-item" data-on={active === a.id} onClick={() => setActive(a.id)} style={{ flexDirection: "column", alignItems: "flex-start", padding: 10, gap: 2, borderRadius: 8, cursor: "pointer" }}>
                <div className="row gap-2" style={{ width: "100%" }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{a.name}</span>
                  <span className="pill mono" style={{ marginLeft: "auto", fontSize: 9 }}>{a.kind}</span>
                </div>
                <span style={{ fontSize: 10, color: "var(--fg-mute)" }}>{a.endpoints} endpoints · {a.auth}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="sash sash--v" />
        <div className="split-pane">
          <div className="panel-head">
            <div className="panel-title">{api.name}</div>
            <span className="pill pill--acc">{api.kind}</span>
            <div className="seg" style={{ marginLeft: 12 }}>
              {["endpoints", "auth", "schemas", "test"].map((t) => <button key={t} data-on={tab === t} onClick={() => setTab(t)}>{t}</button>)}
            </div>
            <div style={{ flex: 1 }} />
            <button className="btn"><Icons.link size={12} /> Attach to node</button>
          </div>
          {tab === "endpoints" && <EndpointsTab />}
          {tab === "auth" && <AuthTab />}
          {tab === "schemas" && <SchemasTab cmTheme={cmTheme} />}
          {tab === "test" && <TestTab cmTheme={cmTheme} />}
        </div>
      </div>
    </div>
  );
}
