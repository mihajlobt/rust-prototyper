import { useState, useCallback, memo } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { ClipboardList, Send, Check } from "lucide-react"
import { resolveAskUserForm } from "@/lib/ipc"
import type { FormField } from "@/lib/ipc"

export interface AskUserFormCardProps {
  requestId: number
  title: string
  fields: FormField[]
  onResolve?: () => void
}

export const AskUserFormCard = memo(function AskUserFormCard({
  requestId,
  title,
  fields,
  onResolve,
}: AskUserFormCardProps) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(() => {
    const init: Record<string, string | string[]> = {}
    for (const field of fields) {
      init[field.id] = field.field_type === "multiselect" ? [] : ""
    }
    return init
  })
  const [submitting, setSubmitting] = useState(false)

  const isComplete = fields.every((field) => {
    if (field.required === false) return true
    const answer = answers[field.id]
    if (Array.isArray(answer)) return answer.length > 0
    return typeof answer === "string" && answer.trim() !== ""
  })

  const handleSubmit = useCallback(async () => {
    if (submitting || !isComplete) return
    setSubmitting(true)
    await resolveAskUserForm(requestId, answers)
    onResolve?.()
  }, [submitting, isComplete, requestId, answers, onResolve])

  const setField = (id: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  const toggleMultiselect = (id: string, choice: string) => {
    setAnswers((prev) => {
      const current = (prev[id] as string[]) ?? []
      return {
        ...prev,
        [id]: current.includes(choice)
          ? current.filter((c) => c !== choice)
          : [...current, choice],
      }
    })
  }

  return (
    <div className={cn(
      "my-2 overflow-hidden rounded-lg border",
      "border-blue-200 bg-blue-50/60",
      "dark:border-blue-900/50 dark:bg-blue-950/15",
    )}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <ClipboardList className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">{title}</p>
      </div>

      {/* Fields */}
      <div className="border-t border-blue-200/60 dark:border-blue-900/40 px-3 py-3 space-y-4">
        {fields.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            value={answers[field.id] ?? (field.field_type === "multiselect" ? [] : "")}
            onText={(v) => setField(field.id, v)}
            onChoice={(v) => setField(field.id, v)}
            onMultiToggle={(v) => toggleMultiselect(field.id, v)}
            disabled={submitting}
          />
        ))}

        <Button
          size="sm"
          className="w-full gap-1.5 text-xs mt-1"
          onClick={handleSubmit}
          disabled={submitting || !isComplete}
        >
          <Send className="h-3.5 w-3.5" />
          {submitting ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </div>
  )
})

interface FieldRowProps {
  field: FormField
  value: string | string[]
  onText: (v: string) => void
  onChoice: (v: string) => void
  onMultiToggle: (v: string) => void
  disabled: boolean
}

function FieldRow({ field, value, onText, onChoice, onMultiToggle, disabled }: FieldRowProps) {
  const isRequired = field.required !== false

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-blue-800 dark:text-blue-300">
        {field.label}
        {isRequired && <span className="text-blue-500 ml-0.5">*</span>}
      </label>

      {field.field_type === "text" && (
        <Textarea
          value={value as string}
          onChange={(e) => onText(e.target.value)}
          placeholder={field.placeholder ?? "Your answer…"}
          className="min-h-[52px] resize-none text-sm"
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
          }}
        />
      )}

      {field.field_type === "choice" && field.choices && (
        <div className="flex flex-wrap gap-1.5">
          {field.choices.map((choice) => (
            <button
              key={choice}
              onClick={() => onChoice(choice)}
              disabled={disabled}
              className={cn(
                "px-2.5 py-1 rounded text-xs transition-colors border",
                value === choice
                  ? "bg-blue-600 text-white border-blue-600 dark:bg-blue-500 dark:border-blue-500"
                  : "border-blue-300 text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950",
              )}
            >
              {choice}
            </button>
          ))}
        </div>
      )}

      {field.field_type === "multiselect" && field.choices && (
        <div className="flex flex-wrap gap-1.5">
          {field.choices.map((choice) => {
            const selected = (value as string[]).includes(choice)
            return (
              <button
                key={choice}
                onClick={() => onMultiToggle(choice)}
                disabled={disabled}
                className={cn(
                  "px-2.5 py-1 rounded text-xs transition-colors border flex items-center gap-1",
                  selected
                    ? "bg-blue-600 text-white border-blue-600 dark:bg-blue-500 dark:border-blue-500"
                    : "border-blue-300 text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950",
                )}
              >
                {selected && <Check className="h-3 w-3" />}
                {choice}
              </button>
            )
          })}
        </div>
      )}

      {field.field_type === "confirm" && (
        <div className="flex gap-2">
          <button
            onClick={() => onChoice("Yes")}
            disabled={disabled}
            className={cn(
              "px-3 py-1 rounded text-xs border transition-colors",
              value === "Yes"
                ? "bg-blue-600 text-white border-blue-600 dark:bg-blue-500 dark:border-blue-500"
                : "border-blue-300 text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950",
            )}
          >
            Yes
          </button>
          <button
            onClick={() => onChoice("No")}
            disabled={disabled}
            className={cn(
              "px-3 py-1 rounded text-xs border transition-colors",
              value === "No"
                ? "bg-blue-600 text-white border-blue-600 dark:bg-blue-500 dark:border-blue-500"
                : "border-blue-300 text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950",
            )}
          >
            No
          </button>
        </div>
      )}
    </div>
  )
}
