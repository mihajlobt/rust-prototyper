import type { AskUserQuestionType } from "@/lib/ipc"

export interface WizardAnnotation {
  id: string
  type: "point" | "region"
  x: number
  y: number
  w?: number
  h?: number
  text: string
  resolved: boolean
  createdAt: number
}

export interface PendingAskUser {
  requestId: number
  question: string
  questionType: AskUserQuestionType
  choices?: string[]
}
