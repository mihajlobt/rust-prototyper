import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { MessageCircleQuestion, Send, Check, X } from "lucide-react"
import { useState, useCallback, memo } from "react"
import { resolveAskUser, type AskUserQuestionType } from "@/lib/ipc"

export interface AskUserCardProps {
  requestId: number
  question: string
  questionType: AskUserQuestionType
  choices?: string[]
  onResolve?: (answer: string) => void
}

export const AskUserCard = memo(function AskUserCard({
  requestId,
  question,
  questionType,
  choices,
  onResolve,
}: AskUserCardProps) {
  const [textAnswer, setTextAnswer] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(async (answer: string) => {
    if (submitting || !answer.trim()) return
    setSubmitting(true)
    await resolveAskUser(requestId, answer.trim())
    onResolve?.(answer.trim())
  }, [requestId, onResolve, submitting])

  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-lg border",
        "border-blue-200 bg-blue-50/60",
        "dark:border-blue-900/50 dark:bg-blue-950/15"
      )}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300 leading-snug">
          {question}
        </p>
      </div>

      <div className="border-t border-blue-200/60 px-3 py-2.5 dark:border-blue-900/40">
        {questionType === "text" && (
          <div className="flex flex-col gap-2">
            <Textarea
              value={textAnswer}
              onChange={(e) => setTextAnswer(e.target.value)}
              placeholder="Your answer…"
              className="min-h-[60px] resize-none text-sm"
              disabled={submitting}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void submit(textAnswer)
                }
              }}
            />
            <Button
              size="sm"
              className="self-end h-7 gap-1 text-xs"
              onClick={() => void submit(textAnswer)}
              disabled={submitting || !textAnswer.trim()}
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </Button>
          </div>
        )}

        {questionType === "choice" && choices && (
          <div className="flex flex-wrap gap-2">
            {choices.map((choice) => (
              <Button
                key={choice}
                size="sm"
                variant="outline"
                className="h-7 text-xs border-blue-300 text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950"
                disabled={submitting}
                onClick={() => void submit(choice)}
              >
                {choice}
              </Button>
            ))}
          </div>
        )}

        {questionType === "confirm" && (
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 gap-1 text-xs bg-blue-700 text-white hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500"
              disabled={submitting}
              onClick={() => void submit("Yes")}
            >
              <Check className="h-3.5 w-3.5" />
              Yes
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs border-blue-300 text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950"
              disabled={submitting}
              onClick={() => void submit("No")}
            >
              <X className="h-3.5 w-3.5" />
              No
            </Button>
          </div>
        )}
      </div>
    </div>
  )
})
