import { create } from "zustand";
import { bunDev, killProcess, onTerminalOutput, type TerminalOutputEvent } from "@/lib/ipc";
import type { UnlistenFn } from "@tauri-apps/api/event";

// ─── Types ────────────────────────────────────────────────────────────────────

type DevServerStatus = "idle" | "starting" | "running" | "error";

export interface DevServerState {
  // Preview server state (component-preview/)
  previewStatus: DevServerStatus;
  previewUrl: string | null;
  previewError: string | null;

  // Runner server state (generated/)
  runnerStatus: DevServerStatus;
  runnerUrl: string | null;
  runnerError: string | null;

  // Actions
  startPreview: (componentPreviewDir: string, port?: number) => Promise<string>;
  startRunner: (generatedDir: string, port?: number) => Promise<string>;
  stopPreview: () => void;
  stopRunner: () => void;
}

// ─── Internal State ───────────────────────────────────────────────────────────

let previewPid: number | null = null;
let runnerPid: number | null = null;
let previewUnlisten: UnlistenFn | null = null;
let runnerUnlisten: UnlistenFn | null = null;

/** Resolve functions for URL capture promises */
let previewUrlResolve: ((url: string) => void) | null = null;
let runnerUrlResolve: ((url: string) => void) | null = null;
let previewUrlReject: ((error: Error) => void) | null = null;
let runnerUrlReject: ((error: Error) => void) | null = null;

/** Timeout handles so we can clear them */
let previewTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
let runnerTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

const URL_CAPTURE_TIMEOUT_MS = 30_000;
const DEFAULT_PREVIEW_PORT = 5173;
const DEFAULT_RUNNER_PORT = 5174;

// ─── URL Detection ────────────────────────────────────────────────────────────

/** Regex matching Vite's Local URL output line, e.g. "➜  Local:   http://localhost:5173/" */
const LOCAL_URL_PATTERN = /Local:\s*(https?:\/\/\S+)/i;

/** Fallback: match any localhost URL if the "Local:" pattern wasn't hit first. */
const LOOSE_LOCALHOST_PATTERN = /https?:\/\/localhost:\d+\S*/;

function extractLocalUrl(line: string): string | null {
  const localMatch = line.match(LOCAL_URL_PATTERN);
  if (localMatch) return localMatch[1];

  const looseMatch = line.match(LOOSE_LOCALHOST_PATTERN);
  if (looseMatch) return looseMatch[0];

  return null;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useDevServerStore = create<DevServerState>()((set, get) => ({
  previewStatus: "idle",
  previewUrl: null,
  previewError: null,

  runnerStatus: "idle",
  runnerUrl: null,
  runnerError: null,

  // ── startPreview ──────────────────────────────────────────────────────────

  startPreview: async (componentPreviewDir: string, port?: number): Promise<string> => {
    const state = get();

    // If already running, return URL immediately
    if (state.previewStatus === "running" && state.previewUrl) {
      return state.previewUrl;
    }

    // If starting, wait for the existing promise to resolve
    if (state.previewStatus === "starting") {
      return new Promise<string>((resolve, reject) => {
        previewUrlResolve = resolve;
        previewUrlReject = reject;
      });
    }

    // Reset state and begin starting
    set({ previewStatus: "starting", previewUrl: null, previewError: null });

    const targetPort = port ?? DEFAULT_PREVIEW_PORT;

    // Subscribe to terminal output to capture the URL
    let urlCaptured = false;
    previewUnlisten = await onTerminalOutput((event: TerminalOutputEvent) => {
      if (urlCaptured) return;

      const url = extractLocalUrl(event.line);
      if (url) {
        urlCaptured = true;
        set({ previewStatus: "running", previewUrl: url, previewError: null });
        if (previewUrlResolve) {
          previewUrlResolve(url);
          previewUrlResolve = null;
          previewUrlReject = null;
        }
        // Clear timeout — we got the URL
        if (previewTimeoutHandle) {
          clearTimeout(previewTimeoutHandle);
          previewTimeoutHandle = null;
        }
      }
    });

    // Start dev server
    try {
      const pid = await bunDev(componentPreviewDir, targetPort);
      previewPid = pid;

      // Set a timeout — if URL isn't captured within timeout, reject
      return new Promise<string>((resolve, reject) => {
        previewUrlResolve = resolve;
        previewUrlReject = reject;

        previewTimeoutHandle = setTimeout(() => {
          set({ previewStatus: "error", previewError: `Dev server started (PID ${pid}) but URL was not captured within ${URL_CAPTURE_TIMEOUT_MS / 1000}s` });
          if (previewUrlReject) {
            previewUrlReject(new Error(`Preview dev server URL capture timed out after ${URL_CAPTURE_TIMEOUT_MS / 1000}s`));
            previewUrlResolve = null;
            previewUrlReject = null;
          }
          previewTimeoutHandle = null;
        }, URL_CAPTURE_TIMEOUT_MS);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ previewStatus: "error", previewError: message });
      if (previewUnlisten) {
        previewUnlisten();
        previewUnlisten = null;
      }
      throw error;
    }
  },

  // ── startRunner ───────────────────────────────────────────────────────────

  startRunner: async (generatedDir: string, port?: number): Promise<string> => {
    const state = get();

    // If already running, return URL immediately
    if (state.runnerStatus === "running" && state.runnerUrl) {
      return state.runnerUrl;
    }

    // If starting, wait for the existing promise to resolve
    if (state.runnerStatus === "starting") {
      return new Promise<string>((resolve, reject) => {
        runnerUrlResolve = resolve;
        runnerUrlReject = reject;
      });
    }

    // Reset state and begin starting
    set({ runnerStatus: "starting", runnerUrl: null, runnerError: null });

    const targetPort = port ?? DEFAULT_RUNNER_PORT;

    // Subscribe to terminal output to capture the URL
    let urlCaptured = false;
    runnerUnlisten = await onTerminalOutput((event: TerminalOutputEvent) => {
      if (urlCaptured) return;

      const url = extractLocalUrl(event.line);
      if (url) {
        urlCaptured = true;
        set({ runnerStatus: "running", runnerUrl: url, runnerError: null });
        if (runnerUrlResolve) {
          runnerUrlResolve(url);
          runnerUrlResolve = null;
          runnerUrlReject = null;
        }
        // Clear timeout — we got the URL
        if (runnerTimeoutHandle) {
          clearTimeout(runnerTimeoutHandle);
          runnerTimeoutHandle = null;
        }
      }
    });

    // Start dev server
    try {
      const pid = await bunDev(generatedDir, targetPort);
      runnerPid = pid;

      // Set a timeout — if URL isn't captured within timeout, reject
      return new Promise<string>((resolve, reject) => {
        runnerUrlResolve = resolve;
        runnerUrlReject = reject;

        runnerTimeoutHandle = setTimeout(() => {
          set({ runnerStatus: "error", runnerError: `Dev server started (PID ${pid}) but URL was not captured within ${URL_CAPTURE_TIMEOUT_MS / 1000}s` });
          if (runnerUrlReject) {
            runnerUrlReject(new Error(`Runner dev server URL capture timed out after ${URL_CAPTURE_TIMEOUT_MS / 1000}s`));
            runnerUrlResolve = null;
            runnerUrlReject = null;
          }
          runnerTimeoutHandle = null;
        }, URL_CAPTURE_TIMEOUT_MS);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ runnerStatus: "error", runnerError: message });
      if (runnerUnlisten) {
        runnerUnlisten();
        runnerUnlisten = null;
      }
      throw error;
    }
  },

  // ── stopPreview ───────────────────────────────────────────────────────────

  stopPreview: () => {
    // Clear timeout
    if (previewTimeoutHandle) {
      clearTimeout(previewTimeoutHandle);
      previewTimeoutHandle = null;
    }

    // Unsubscribe from terminal output
    if (previewUnlisten) {
      previewUnlisten();
      previewUnlisten = null;
    }

    // Kill process
    if (previewPid !== null) {
      killProcess(previewPid).catch(() => { /* process may already be dead */ });
      previewPid = null;
    }

    // Reject any pending promise
    if (previewUrlReject) {
      previewUrlReject(new Error("Preview dev server was stopped before URL was captured"));
      previewUrlResolve = null;
      previewUrlReject = null;
    }

    set({ previewStatus: "idle", previewUrl: null, previewError: null });
  },

  // ── stopRunner ────────────────────────────────────────────────────────────

  stopRunner: () => {
    // Clear timeout
    if (runnerTimeoutHandle) {
      clearTimeout(runnerTimeoutHandle);
      runnerTimeoutHandle = null;
    }

    // Unsubscribe from terminal output
    if (runnerUnlisten) {
      runnerUnlisten();
      runnerUnlisten = null;
    }

    // Kill process
    if (runnerPid !== null) {
      killProcess(runnerPid).catch(() => { /* process may already be dead */ });
      runnerPid = null;
    }

    // Reject any pending promise
    if (runnerUrlReject) {
      runnerUrlReject(new Error("Runner dev server was stopped before URL was captured"));
      runnerUrlResolve = null;
      runnerUrlReject = null;
    }

    set({ runnerStatus: "idle", runnerUrl: null, runnerError: null });
  },
}));