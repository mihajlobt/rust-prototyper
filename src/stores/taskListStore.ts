import { create } from "zustand";
import type { TodoItem } from "@/lib/ipc";
import { readFile } from "@/lib/ipc";
import { useAppStore } from "@/stores/appStore";

interface TaskListStore {
  todos: TodoItem[];
  setTodos: (todos: TodoItem[]) => void;
  hydrateTodos: () => Promise<void>;
}

export const useTaskListStore = create<TaskListStore>((set) => ({
  todos: [],
  setTodos: (todos) => set({ todos }),
  hydrateTodos: async () => {
    try {
      const project = useAppStore.getState().settings.project;
      const raw = await readFile(`projects/${project}/.prototyper/todos.json`);
      const parsed = JSON.parse(raw) as TodoItem[];
      if (Array.isArray(parsed)) set({ todos: parsed });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found") || message.includes("No such")) return;
      console.error("taskListStore: failed to hydrate todos:", message);
    }
  },
}));
