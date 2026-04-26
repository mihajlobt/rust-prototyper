import { cn } from "@/lib/utils";

interface PaneHeaderProps {
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}

/** Clickable collapsible-pane header strip used across panel sections. */
export function PaneHeader({ onClick, className, children }: PaneHeaderProps) {
  return (
    <div
      className={cn(
        "h-full border-b border-border flex items-center px-3 bg-card",
        onClick && "cursor-pointer select-none hover:bg-muted transition-colors",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
