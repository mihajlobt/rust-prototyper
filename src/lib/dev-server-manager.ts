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

type UrlWaiter = { resolve: (url: string) => void; reject: (e: Error) => void };

let previewPid: number | null = null;
let runnerPid: number | null = null;
let previewUnlisten: UnlistenFn | null = null;
let runnerUnlisten: UnlistenFn | null = null;

/** All callers waiting for the URL while status is "starting" */
let previewUrlWaiters: UrlWaiter[] = [];
let runnerUrlWaiters: UrlWaiter[] = [];

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

    // If starting, queue as a waiter — the primary starter will settle us
    if (state.previewStatus === "starting") {
      return new Promise<string>((resolve, reject) => {
        previewUrlWaiters.push({ resolve, reject });
      });
    }

    // Reset state and begin starting
    set({ previewStatus: "starting", previewUrl: null, previewError: null });

    const targetPort = port ?? DEFAULT_PREVIEW_PORT;

    const settlePreviewWaiters = (url: string) => {
      for (const w of previewUrlWaiters) w.resolve(url);
      previewUrlWaiters = [];
    };
    const rejectPreviewWaiters = (e: Error) => {
      for (const w of previewUrlWaiters) w.reject(e);
      previewUrlWaiters = [];
    };

    // Start dev server first so we have the PID before subscribing
    let pid: number;
    try {
      pid = await bunDev(componentPreviewDir, targetPort);
      previewPid = pid;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ previewStatus: "error", previewError: message });
      rejectPreviewWaiters(new Error(message));
      throw error;
    }

    // Subscribe filtered to this server's PID so runner output is ignored
    let urlCaptured = false;
    previewUnlisten = await onTerminalOutput((event: TerminalOutputEvent) => {
      if (event.pid !== previewPid || urlCaptured) return;

      const url = extractLocalUrl(event.line);
      if (url) {
        urlCaptured = true;
        set({ previewStatus: "running", previewUrl: url, previewError: null });
        settlePreviewWaiters(url);
        if (previewTimeoutHandle) {
          clearTimeout(previewTimeoutHandle);
          previewTimeoutHandle = null;
        }
      }
    });

    return new Promise<string>((resolve, reject) => {
      previewUrlWaiters.push({ resolve, reject });

      previewTimeoutHandle = setTimeout(() => {
        const err = new Error(`Preview dev server URL capture timed out after ${URL_CAPTURE_TIMEOUT_MS / 1000}s`);
        set({ previewStatus: "error", previewError: `Dev server started (PID ${pid}) but URL was not captured within ${URL_CAPTURE_TIMEOUT_MS / 1000}s` });
        rejectPreviewWaiters(err);
        previewTimeoutHandle = null;
      }, URL_CAPTURE_TIMEOUT_MS);
    });
  },

  // ── startRunner ───────────────────────────────────────────────────────────

  startRunner: async (generatedDir: string, port?: number): Promise<string> => {
    const state = get();

    // If already running, return URL immediately
    if (state.runnerStatus === "running" && state.runnerUrl) {
      return state.runnerUrl;
    }

    // If starting, queue as a waiter — the primary starter will settle us
    if (state.runnerStatus === "starting") {
      return new Promise<string>((resolve, reject) => {
        runnerUrlWaiters.push({ resolve, reject });
      });
    }

    // Reset state and begin starting
    set({ runnerStatus: "starting", runnerUrl: null, runnerError: null });

    const targetPort = port ?? DEFAULT_RUNNER_PORT;

    const settleRunnerWaiters = (url: string) => {
      for (const w of runnerUrlWaiters) w.resolve(url);
      runnerUrlWaiters = [];
    };
    const rejectRunnerWaiters = (e: Error) => {
      for (const w of runnerUrlWaiters) w.reject(e);
      runnerUrlWaiters = [];
    };

    // Start dev server first so we have the PID before subscribing
    let pid: number;
    try {
      pid = await bunDev(generatedDir, targetPort);
      runnerPid = pid;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ runnerStatus: "error", runnerError: message });
      rejectRunnerWaiters(new Error(message));
      throw error;
    }

    // Subscribe filtered to this server's PID so preview output is ignored
    let urlCaptured = false;
    runnerUnlisten = await onTerminalOutput((event: TerminalOutputEvent) => {
      if (event.pid !== runnerPid || urlCaptured) return;

      const url = extractLocalUrl(event.line);
      if (url) {
        urlCaptured = true;
        set({ runnerStatus: "running", runnerUrl: url, runnerError: null });
        settleRunnerWaiters(url);
        if (runnerTimeoutHandle) {
          clearTimeout(runnerTimeoutHandle);
          runnerTimeoutHandle = null;
        }
      }
    });

    return new Promise<string>((resolve, reject) => {
      runnerUrlWaiters.push({ resolve, reject });

      runnerTimeoutHandle = setTimeout(() => {
        const err = new Error(`Runner dev server URL capture timed out after ${URL_CAPTURE_TIMEOUT_MS / 1000}s`);
        set({ runnerStatus: "error", runnerError: `Dev server started (PID ${pid}) but URL was not captured within ${URL_CAPTURE_TIMEOUT_MS / 1000}s` });
        rejectRunnerWaiters(err);
        runnerTimeoutHandle = null;
      }, URL_CAPTURE_TIMEOUT_MS);
    });
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

    // Reject all callers waiting for the URL
    const stopped = new Error("Preview dev server was stopped before URL was captured");
    for (const w of previewUrlWaiters) w.reject(stopped);
    previewUrlWaiters = [];

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

    // Reject all callers waiting for the URL
    const stopped = new Error("Runner dev server was stopped before URL was captured");
    for (const w of runnerUrlWaiters) w.reject(stopped);
    runnerUrlWaiters = [];

    set({ runnerStatus: "idle", runnerUrl: null, runnerError: null });
  },
}));