import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export interface XTerminalHandle {
  writeln: (line: string) => void;
  write: (text: string) => void;
  clear: () => void;
}

interface XTerminalProps {
  className?: string;
}

export const XTerminal = forwardRef<XTerminalHandle, XTerminalProps>(
  function XTerminal({ className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;

      const term = new Terminal({
        cursorBlink: false,
        disableStdin: true,
        fontSize: 12,
        fontFamily: '"Geist Mono", "JetBrains Mono", ui-monospace, monospace',
        theme: {
          background: "#000000",
          foreground: "#d4d4d4",
          green: "#4ade80",
          red: "#f87171",
          yellow: "#facc15",
          cyan: "#22d3ee",
          blue: "#60a5fa",
          brightBlack: "#6b7280",
        },
        convertEol: true,
        scrollback: 5000,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();

      termRef.current = term;
      fitRef.current = fit;

      // rAF prevents fit() from triggering a ResizeObserver loop
      let rafId = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => fit.fit());
      });
      observer.observe(containerRef.current);

      return () => {
        cancelAnimationFrame(rafId);
        observer.disconnect();
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    }, []);

    useImperativeHandle(ref, () => ({
      writeln: (line: string) => termRef.current?.writeln(line),
      write: (text: string) => termRef.current?.write(text),
      clear: () => termRef.current?.clear(),
    }));

    return <div ref={containerRef} className={className} style={{ height: "100%", width: "100%" }} />;
  }
);
