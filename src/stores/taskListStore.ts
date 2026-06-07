import { create } from "zustand";
import type { TodoItem } from "@/lib/ipc";

interface TaskListStore {
  todos: TodoItem[];
  setTodos: (todos: TodoItem[]) => void;
  clearTodos: () => void;
}

export const useTaskListStore = create<TaskListStore>((set) => ({
  todos: [],
  setTodos: (todos) => set({ todos }),
  clearTodos: () => set({ todos: [] }),
}));
