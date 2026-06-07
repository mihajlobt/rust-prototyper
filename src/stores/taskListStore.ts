import { create } from "zustand";
import type { TodoItem } from "@/lib/ipc";
import { readFile } from "@/lib/ipc";
import { useAppStore } from "@/stores/appStore";

interface TaskListStore {
  todos: TodoItem[];
  setTodos: (todos: TodoItem[]) => void;
  clearTodos: () => void;
  hydrateTodos: () => Promise<void>;
}

export const useTaskListStore = create<TaskListStore>((set) => ({
  todos: [],
  setTodos: (todos) => set({ todos }),
  clearTodos: () => set({ todos: [] }),
  hydrateTodos: async () => {
    try {
      const project = useAppStore.getState().settings.project;
      const raw = await readFile(`projects/${project}/.prototyper/todos.json`);
      const parsed = JSON.parse(raw) as TodoItem[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        set({ todos: parsed });
      }
    } catch {
      // File doesn't exist or is invalid — start with empty list.
    }
  },
}));
