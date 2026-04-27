import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useAppStore } from "@/stores/appStore";

function Toaster(props: ToasterProps) {
  const dark = useAppStore((s) => s.settings.dark);

  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      className="toaster group"
      position="top-right"
      offset={{ top: 56, right: 16 }}
      visibleToasts={5}
      expand
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        duration: 5000,
        classNames: {
          toast: "gap-3",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
