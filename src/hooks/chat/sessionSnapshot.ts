import { useChatStore, type SessionUsageSnapshot } from "@/stores/chatStore"
import { writeFile } from "@/lib/ipc"

/** Build a SessionUsageSnapshot from partial overrides, merging with the
 *  current store value. Persists to `sessionPath` and updates the store. */
export function persistSessionSnapshot(
  entityId: string,
  sessionPath: string,
  overrides: Partial<SessionUsageSnapshot>,
): SessionUsageSnapshot {
  const prev = useChatStore.getState().chats[entityId]?.sessionUsage ?? { updatedAt: 0 }
  const next: SessionUsageSnapshot = {
    lastFinalUsage: overrides.lastFinalUsage ?? prev.lastFinalUsage,
    liveEstimate: overrides.liveEstimate ?? prev.liveEstimate ?? 0,
    updatedAt: Date.now(),
  }
  useChatStore.getState().setSessionUsage(entityId, next)
  writeFile(sessionPath, JSON.stringify(next, null, 2)).catch(() => {})
  return next
}
