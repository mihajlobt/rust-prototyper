import { notify } from "@/hooks/useToast";

// ─── Global Error Handlers ───

let globalHandlersInstalled = false;

/**
 * Attach window.onerror and window.onunhandledrejection listeners
 * that route to the toast system. Safe to call multiple times.
 */
export function setupGlobalErrorHandlers(): void {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    const msg = event.error instanceof Error
      ? event.error.message
      : event.message || "Unknown runtime error";
    notify.error("Runtime Error", msg, { duration: 10000 });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unhandled promise rejection";
    notify.error("Unhandled Promise Rejection", msg, { duration: 10000 });
  });
}

// ─── IPC Wrapper ───

/**
 * Wrap an IPC invoke call so that failures automatically show a toast.
 * The error is re-thrown so the caller can still handle it locally.
 */
export async function safeInvoke<T>(
  fn: () => Promise<T>,
  errorTitle = "Request Failed",
  errorDescription?: string
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Unknown error";
    notify.error(errorTitle, errorDescription ?? message, { duration: 8000 });
    throw err;
  }
}

/**
 * Convenience wrapper specifically for IPC calls that should silently fail
 * (no local catch) but still show a toast.
 */
export async function safeInvokeSilent<T>(
  fn: () => Promise<T>,
  errorTitle = "Request Failed"
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Unknown error";
    notify.error(errorTitle, message, { duration: 8000 });
    return undefined;
  }
}
