import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,      // 30s cache for file reads
      gcTime: 5 * 60_000,     // 5min garbage collection
      retry: 1,
      refetchOnWindowFocus: false, // Desktop app doesn't need this
    },
    mutations: {
      retry: 0,
    },
  },
});
