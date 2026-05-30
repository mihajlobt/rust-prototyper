import { readFile, writeFile, createDir } from "@/lib/ipc";

export interface ItemMeta {
  createdAt: number;
  updatedAt: number;
  initialPrompt: string;
  updates: Array<{ at: number; prompt: string }>;
}

function metaPath(projectDir: string, type: "components" | "themes" | "screens", id: string): string {
  return `${projectDir}/${type}/${id}/meta.json`;
}

export async function loadItemMeta(
  projectDir: string,
  type: "components" | "themes" | "screens",
  id: string
): Promise<ItemMeta | null> {
  try {
    const raw = await readFile(metaPath(projectDir, type, id));
    return JSON.parse(raw) as ItemMeta;
  } catch {
    return null;
  }
}

export async function saveItemMeta(
  projectDir: string,
  type: "components" | "themes" | "screens",
  id: string,
  prompt: string
): Promise<void> {
  const path = metaPath(projectDir, type, id);
  const existing = await loadItemMeta(projectDir, type, id);
  const now = Date.now();

  let meta: ItemMeta;
  if (!existing) {
    meta = { createdAt: now, updatedAt: now, initialPrompt: prompt, updates: [] };
  } else {
    meta = {
      ...existing,
      updatedAt: now,
      updates: prompt && prompt !== existing.initialPrompt
        ? [...existing.updates, { at: now, prompt }]
        : existing.updates,
    };
  }

  try {
    await createDir(`${projectDir}/${type}/${id}`);
    await writeFile(path, JSON.stringify(meta, null, 2));
  } catch { /* ignore write failures */ }
}
