import { Toaster, type ToasterProps } from "sonner";
/**
 * ToastProvider — root-level sonner Toaster with full Prototyper theme integration.
 *
 * Styled via CSS variables and Tailwind classes injected through sonner's
 * toastOptions.classNames. Works seamlessly in light/dark/AMOLED modes.
 */
export function ToastProvider(props: Omit<ToasterProps, "children">) {
  return (
    <Toaster
      position="top-right"
      offset={{ top: 56, right: 16 }}
      visibleToasts={5}
      toastOptions={{
        duration: 5000,
        classNames: {
          toast:
            "group toast flex w-full items-start gap-3 rounded-lg border p-4 shadow-lg backdrop-blur-sm " +
            "bg-card text-card-foreground border-border " +
            "data-[type=error]:border-destructive/30 data-[type=error]:bg-destructive/10 data-[type=error]:text-destructive-foreground " +
            "data-[type=success]:border-emerald-500/30 data-[type=success]:bg-emerald-500/10 data-[type=success]:text-emerald-700 dark:data-[type=success]:text-emerald-300 " +
            "data-[type=warning]:border-amber-500/30 data-[type=warning]:bg-amber-500/10 data-[type=warning]:text-amber-700 dark:data-[type=warning]:text-amber-300 " +
            "data-[type=info]:border-sky-500/30 data-[type=info]:bg-sky-500/10 data-[type=info]:text-sky-700 dark:data-[type=info]:text-sky-300",
          title: "text-sm font-semibold leading-tight",
          description: "text-xs opacity-90 leading-relaxed mt-0.5",
          actionButton:
            "inline-flex items-center justify-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
          cancelButton:
            "inline-flex items-center justify-center rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/80 transition-colors",
          closeButton:
            "absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted",
          icon: "mt-0.5 size-5 shrink-0",
        },
      }}
      {...props}
    />
  );
}
