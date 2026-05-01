import { toast } from "sonner";
import { onTerminalOutput, getErrorMessage } from "@/lib/ipc";
import type { UnlistenFn } from "@tauri-apps/api/event";

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "").trim();
}

function isMeaningfulLine(raw: string): boolean {
  const clean = stripAnsi(raw);
  if (clean.length < 4) return false;
  // Skip spinner frames, pure punctuation/symbols, and box-drawing chars
  if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷▶▸►\-=─━│╭╮╯╰]+$/.test(clean)) return false;
  return /[a-zA-Z0-9]/.test(clean);
}

/**
 * Runs a scaffold function with a persistent updating floating toast.
 * Shows each step label as the toast title and pipes terminal output as
 * the description so the user sees live progress without opening the terminal.
 *
 * @param toastId  Stable sonner toast ID — reuse the same one per scaffold type
 *                 so repeated calls update rather than stack.
 * @param title    Human-readable name of the operation ("Scaffolding component preview")
 * @param fn       Async function that receives an `onStep` callback and runs the scaffold
 */
export async function withScaffoldNotifications(
  toastId: string,
  title: string,
  fn: (onStep: (step: string) => void) => Promise<void>
): Promise<void> {
  let currentStep = title;
  let lastDetail: string | undefined;
  let unlisten: UnlistenFn | null = null;

  const updateToast = (step: string, detail?: string) => {
    toast.loading(step, {
      id: toastId,
      description: detail,
      duration: Infinity,
    });
  };

  updateToast(title);

  try {
    unlisten = await onTerminalOutput((event) => {
      if (!isMeaningfulLine(event.line)) return;
      const clean = stripAnsi(event.line);
      if (clean === lastDetail) return;
      lastDetail = clean;
      updateToast(currentStep, clean.length > 120 ? `${clean.slice(0, 117)}…` : clean);
    });
  } catch {
    // Terminal output subscription is non-critical
  }

  const onStep = (step: string) => {
    currentStep = step;
    lastDetail = undefined;
    updateToast(step);
  };

  try {
    await fn(onStep);
    unlisten?.();
    toast.success(title, {
      id: toastId,
      description: "Done",
      duration: 5000,
    });
  } catch (e) {
    unlisten?.();
    const msg = getErrorMessage(e);
    toast.error(title, {
      id: toastId,
      description: msg,
      duration: 12000,
    });
    throw e;
  }
}
