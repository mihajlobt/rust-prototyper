// ─── Types shared across the APIs panel sub-modules ──────────────────────────

import type { ApiHistoryEntry } from "@/stores/uiStore";

export interface SavedApi {
  id: string;
  name: string;
  method: string;
  url: string;
  headersText: string;
  body: string;
  authType: "none" | "bearer" | "apikey" | "basic" | "oauth2";
  authToken: string;
  authHeaderName: string;
  authUsername: string;
  authPassword: string;
  authTokenUrl: string;
  authClientId: string;
  authClientSecret: string;
  proxyPath: string;
  history: ApiHistoryEntry[];
}

export interface ApiKey {
  id: string;
  name: string;
  value: string;
  description: string;
}
