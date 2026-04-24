import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { queryClient } from "./lib/queryClient";
import "./styles/globals.css";

// Expose React globally so sandboxed preview iframes can access it via window.parent
(window as unknown as Record<string, unknown>)["__React"] = React;
(window as unknown as Record<string, unknown>)["__ReactDOM"] = ReactDOM;

// Expose lucide-react globally for preview iframes
import * as Lucide from "lucide-react";
(window as unknown as Record<string, unknown>)["__IconLib"] = Lucide;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
