import { create } from "zustand";
import type { HttpResponse } from "@/lib/ipc";

export interface ApiHistoryEntry {
  timestamp: number;
  method: string;
  url: string;
  status: number;
  duration?: number;
}

interface UIState {
  // Screens
  screensDevice: "desktop" | "tablet" | "mobile";
  screensShowInspector: boolean;
  screensLinkMode: boolean;
  screensZoom: number;

  // Components
  componentsDevice: "desktop" | "tablet" | "mobile";
  componentsDarkPreview: boolean;
  componentsShowInspector: boolean;
  componentsCodeOpen: boolean;

  // Themes
  themesDevice: "desktop" | "tablet" | "mobile";
  themesDarkPreview: boolean;
  themesShowInspector: boolean;
  themesCodeOpen: boolean;
  themesFramework: "shadcn" | "daisy" | "bootstrap" | "generic";
  themesDarkLightSupport: boolean;

  // APIs
  apisShowInspector: boolean;
  apisName: string;
  apisMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  apisUrl: string;
  apisHeadersText: string;
  apisBody: string;
  apisAuthType: "none" | "bearer" | "apikey" | "basic" | "oauth2";
  apisAuthToken: string;
  apisAuthHeaderName: string;
  apisAuthUsername: string;
  apisAuthPassword: string;
  apisAuthTokenUrl: string;
  apisAuthClientId: string;
  apisAuthClientSecret: string;
  apisResponse: HttpResponse | null;
  apisHistory: ApiHistoryEntry[];
  apisEnvVars: Record<string, string>;
  apisNewEnvKey: string;
  apisNewEnvValue: string;
  apisCurlPaste: string;
  apisOpenapiPaste: string;

  // Runner
  runnerDevice: "desktop" | "tablet" | "mobile";
  runnerZoom: number;
  runnerTerminalOpen: boolean;
  runnerActiveTab: "terminal" | "logs" | "network";
  runnerFileTreeNonce: number;

  // Workflows
  workflowsShowPanel: boolean;
}

export const useUIStore = create<UIState>()(() => ({
  // Screens
  screensDevice: "desktop",
  screensShowInspector: false,
  screensLinkMode: false,
  screensZoom: 1,

  // Components
  componentsDevice: "desktop",
  componentsDarkPreview: false,
  componentsShowInspector: false,
  componentsCodeOpen: false,

  // Themes
  themesDevice: "desktop",
  themesDarkPreview: false,
  themesShowInspector: false,
  themesCodeOpen: false,
  themesFramework: "generic",
  themesDarkLightSupport: true,

  // APIs
  apisShowInspector: false,
  apisName: "",
  apisMethod: "GET",
  apisUrl: "",
  apisHeadersText: "{}",
  apisBody: "",
  apisAuthType: "none",
  apisAuthToken: "",
  apisAuthHeaderName: "X-API-Key",
  apisAuthUsername: "",
  apisAuthPassword: "",
  apisAuthTokenUrl: "",
  apisAuthClientId: "",
  apisAuthClientSecret: "",
  apisResponse: null,
  apisHistory: [],
  apisEnvVars: {},
  apisNewEnvKey: "",
  apisNewEnvValue: "",
  apisCurlPaste: "",
  apisOpenapiPaste: "",

  // Runner
  runnerDevice: "desktop",
  runnerZoom: 1,
  runnerTerminalOpen: true,
  runnerActiveTab: "terminal",
  runnerFileTreeNonce: 0,

  // Workflows
  workflowsShowPanel: false,
}));