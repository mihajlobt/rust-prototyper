import React from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: React.ReactNode;
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  lastResetKey?: string;
}

/**
 * PreviewErrorBoundary — catches React render errors inside preview frames
 * and shows a compact fallback so the rest of the panel remains usable.
 * Auto-resets when `resetKey` changes (e.g. new generated code).
 */
export class PreviewErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, lastResetKey: props.resetKey };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== undefined && props.resetKey !== state.lastResetKey) {
      return { hasError: false, error: null, lastResetKey: props.resetKey };
    }
    return null;
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("PreviewErrorBoundary caught:", error, info);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center bg-destructive/5">
          <p className="text-xs font-medium text-destructive">Preview Error</p>
          <p className="text-[10px] text-muted-foreground max-w-full line-clamp-3">
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] mt-1"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
