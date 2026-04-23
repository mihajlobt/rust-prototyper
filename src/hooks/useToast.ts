import { toast, type ExternalToast } from "sonner";
import {
  CircleCheck,
  CircleX,
  Info,
  TriangleAlert,
  Loader2,
} from "lucide-react";
import React from "react";

// ─── Types ───

export type ToastType = "error" | "success" | "warning" | "info";

export interface NotifyOptions {
  /** Override the default icon */
  icon?: React.ReactNode;
  /** Primary action button */
  action?: {
    label: string;
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  };
  /** Secondary dismiss action */
  cancel?: {
    label: string;
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  };
  /** Duration in milliseconds */
  duration?: number;
  /** Dismiss callback */
  onDismiss?: ExternalToast["onDismiss"];
  /** Position override */
  position?: ExternalToast["position"];
}

export interface PromiseToastOptions<T> {
  loading: string;
  success: string | ((data: T) => string);
  error: string | ((error: Error) => string);
}

// ─── Icon map ───

const ICONS: Record<ToastType, React.ReactNode> = {
  error: React.createElement(CircleX, { className: "size-5 text-destructive" }),
  success: React.createElement(CircleCheck, {
    className: "size-5 text-emerald-600 dark:text-emerald-400",
  }),
  warning: React.createElement(TriangleAlert, {
    className: "size-5 text-amber-600 dark:text-amber-400",
  }),
  info: React.createElement(Info, {
    className: "size-5 text-sky-600 dark:text-sky-400",
  }),
};

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  error: 8000,
  success: 4000,
  warning: 6000,
  info: 5000,
};

// ─── Core toast builder ───

function buildToast(
  type: ToastType,
  title: string,
  description?: string,
  options: NotifyOptions = {}
): string | number {
  const { icon, action, cancel, duration, ...rest } = options;

  const toastContent = description
    ? React.createElement(
        "div",
        { className: "grid gap-1" },
        React.createElement("div", { className: "font-semibold" }, title),
        React.createElement(
          "div",
          { className: "text-xs opacity-90" },
          description
        )
      )
    : title;

  return toast[type](toastContent, {
    icon: icon ?? ICONS[type],
    duration: duration ?? DEFAULT_DURATIONS[type],
    ...(action && { action }),
    ...(cancel && { cancel }),
    ...rest,
  });
}

// ─── Public API ───

export const notify = {
  error: (title: string, description?: string, options?: NotifyOptions) =>
    buildToast("error", title, description, options),

  success: (title: string, description?: string, options?: NotifyOptions) =>
    buildToast("success", title, description, options),

  warning: (title: string, description?: string, options?: NotifyOptions) =>
    buildToast("warning", title, description, options),

  info: (title: string, description?: string, options?: NotifyOptions) =>
    buildToast("info", title, description, options),

  /**
   * Track a promise with loading / success / error toasts.
   * Returns the original promise so callers can still await it.
   */
  promise: <T,>(
    promise: Promise<T>,
    opts: PromiseToastOptions<T>,
    options?: NotifyOptions
  ): Promise<T> => {
    const {
      icon,
      action,
      cancel,
      duration,
      onDismiss,
      position,
    } = options ?? {};

    toast.promise(promise, {
      loading: React.createElement(
        "div",
        { className: "flex items-center gap-2" },
        React.createElement(Loader2, {
          className: "size-4 animate-spin text-muted-foreground",
        }),
        opts.loading
      ),
      success: (data) =>
        typeof opts.success === "function"
          ? opts.success(data)
          : opts.success,
      error: (err: Error) =>
        typeof opts.error === "function" ? opts.error(err) : opts.error,
      ...(icon && { icon }),
      ...(action && { action }),
      ...(cancel && { cancel }),
      ...(duration !== undefined && { duration }),
      ...(onDismiss && { onDismiss }),
      ...(position && { position }),
    });

    return promise;
  },

  /** Dismiss a specific toast by its ID */
  dismiss: (id?: string | number) => toast.dismiss(id),

  /** Dismiss all active toasts */
  dismissAll: () => toast.dismiss(),
};

/** Hook re-export for convention; notify is a pure object so no React needed */
export function useToast() {
  return notify;
}
