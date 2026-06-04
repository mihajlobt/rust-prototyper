import { create } from "zustand";
import type { AskUserQuestionType, FormField } from "@/lib/ipc";

interface PendingAskUser {
  requestId: number;
  question: string;
  questionType: AskUserQuestionType;
  choices?: string[];
}

interface PendingAskUserForm {
  requestId: number;
  title: string;
  fields: FormField[];
}

interface AskUserStore {
  pendingAskUser: PendingAskUser | null;
  pendingAskUserForm: PendingAskUserForm | null;
  setAskUser: (payload: PendingAskUser) => void;
  setAskUserForm: (payload: PendingAskUserForm) => void;
  clearAskUser: () => void;
  clearAskUserForm: () => void;
}

export const useAskUserStore = create<AskUserStore>((set) => ({
  pendingAskUser: null,
  pendingAskUserForm: null,
  setAskUser: (payload) => set({ pendingAskUser: payload }),
  setAskUserForm: (payload) => set({ pendingAskUserForm: payload }),
  clearAskUser: () => set({ pendingAskUser: null }),
  clearAskUserForm: () => set({ pendingAskUserForm: null }),
}));
