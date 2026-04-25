# TanStack Query v5 — React Reference

Source: Context7 fetched docs from https://tanstack.com/query/latest
Fetched: 2026-04-25
Package: `@tanstack/react-query` v5.100.1 (installed)

---

## Setup: QueryClient & Provider

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,   // data never stale unless manually invalidated
      gcTime: 5 * 60 * 1000, // 5min default — unused cache garbage collected
      refetchOnWindowFocus: false,
    },
  },
})

// Wrap app:
<QueryClientProvider client={queryClient}>
  <App />
  <ReactQueryDevtools initialIsOpen />
</QueryClientProvider>
```

### Key options

| Option | Default | Description |
|--------|---------|-------------|
| `staleTime` | `0` | Time (ms) data is considered fresh. `Infinity` = never stale |
| `gcTime` | `5 * 60 * 1000` | Time (ms) unused cache stays in memory. `Infinity` = never GC |
| `refetchOnWindowFocus` | `true` | Auto-refetch when window regains focus |
| `retry` | `3` | Retry count on failure. `false` = no retries |

> **v5 migration**: `cacheTime` → `gcTime`

---

## useQuery Hook

```typescript
import { useQuery } from '@tanstack/react-query'

const result = useQuery({
  queryKey: ['todos', 1],
  queryFn: () => fetch('/api/todos/1').then(res => res.json()),
  enabled: true,           // set false to disable auto-fetch
  staleTime: 60_000,       // 1 minute
  refetchInterval: 15_000, // poll every 15s
})
```

### Return fields

| Field | Type | Description |
|-------|------|-------------|
| `data` | `TData` | Resolved data from queryFn |
| `error` | `TError` | Error if query failed |
| `status` | `'pending' \| 'error' \| 'success'` | Overall status |
| `isPending` | `boolean` | True when no data yet (initial load) |
| `isError` | `boolean` | True when in error state |
| `isSuccess` | `boolean` | True when data available |
| `isLoading` | `boolean` | True during first fetch (`isFetching && isPending`) |
| `isFetching` | `boolean` | True whenever a fetch is in-flight |
| `isRefetching` | `boolean` | True during background refetch (not initial) |
| `isStale` | `boolean` | True if data older than staleTime |
| `isFetched` | `boolean` | True if fetched at least once |
| `fetchStatus` | `'fetching' \| 'paused' \| 'idle'` | Network state |
| `refetch` | `function` | Manually trigger refetch |
| `dataUpdatedAt` | `number` | Timestamp of last successful data |

### Conditional rendering pattern

```tsx
const { isPending, isError, data, error, isFetching } = useQuery({ ... })

if (isPending) return <span>Loading...</span>
if (isError) return <span>Error: {error.message}</span>
return <>{data.map(...)}</>
```

---

## queryOptions Helper (best practice for reuse)

```typescript
import { queryOptions } from '@tanstack/react-query'

function groupOptions(id: number) {
  return queryOptions({
    queryKey: ['groups', id],
    queryFn: () => fetchGroups(id),
    staleTime: 5 * 1000,
  })
}

// Reuse everywhere — type-safe:
useQuery(groupOptions(1))
queryClient.prefetchQuery(groupOptions(23))
queryClient.setQueryData(groupOptions(42).queryKey, newGroups)
```

> `queryOptions` co-locates `queryKey` and `queryFn`. Runtime: identity function. TypeScript: full type inference for all consumers.

---

## QueryClient Methods (v5 — object signatures)

```typescript
const queryClient = useQueryClient()

// Invalidate and refetch active queries matching key prefix
await queryClient.invalidateQueries({
  queryKey: ['posts'],
  exact: true,            // exact key match only
  refetchType: 'active',  // 'active' | 'inactive' | 'all' | 'none'
})

// Set cache data directly (optimistic updates)
queryClient.setQueryData(['post', 1], (old) => ({ ...old, title: 'new' }))

// Read cached data synchronously
const data = queryClient.getQueryData(['post', 1])

// Prefetch (loads into cache without mount)
await queryClient.prefetchQuery({ queryKey: ['posts'], queryFn: fetchPosts })

// Remove queries from cache
queryClient.removeQueries({ queryKey: ['posts'] })
```

### v5 signature changes (positional → object)

```typescript
// v4 (old):
queryClient.invalidateQueries(key, filters)
// v5 (new):
queryClient.invalidateQueries({ queryKey, ...filters })
```

---

## Paginated Queries with placeholderData

```tsx
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const { data, isPlaceholderData, isFetching } = useQuery({
  queryKey: ['projects', page],
  queryFn: () => fetchProjects(page),
  placeholderData: keepPreviousData,  // shows old data while new page loads
})
```

---

## Key Patterns

1. **Query keys are hierarchical**: `['posts', 'list']`, `['posts', 'detail', id]`
   - Invalidating `['posts']` also invalidates all children
2. **staleTime vs gcTime**: `staleTime` = freshness window, `gcTime` = cache lifetime
3. **enabled for dependent queries**: `enabled: !!userId` — don't fetch until userId exists
4. **refetchInterval for polling**: Auto-refetch at interval (e.g., `/api/ps` for running models)
5. **Structural sharing**: Enabled by default — TanStack Query reuses object references when data structure hasn't changed, preventing unnecessary re-renders