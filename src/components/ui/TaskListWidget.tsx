import { memo, useState } from "react"
import { cn } from "@/lib/utils"
import { ListTodo, Circle, CircleDot, CircleCheck, ChevronDown, ChevronRight } from "lucide-react"
import type { TodoItem } from "@/lib/ipc"

export interface TaskListWidgetProps {
  todos: TodoItem[]
}

const STATUS_ICON = {
  pending: Circle,
  in_progress: CircleDot,
  completed: CircleCheck,
} as const

const STATUS_CLASS = {
  pending: "text-muted-foreground",
  in_progress: "text-blue-600 dark:text-blue-400",
  completed: "text-emerald-600 dark:text-emerald-400",
} as const

export const TaskListWidget = memo(function TaskListWidget({ todos }: TaskListWidgetProps) {
  const [collapsed, setCollapsed] = useState(true)
  if (todos.length === 0) return null
  const completed = todos.filter((t) => t.status === "completed").length

  return (
    <div className="sticky top-0 z-10 my-2 overflow-hidden rounded-lg border border-border bg-background">
      <button
        className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-muted/50 transition-colors"
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Tasks</span>
        <span className="text-[10px] text-muted-foreground">{completed}/{todos.length} done</span>
      </button>
      {!collapsed && (
        <ul className="px-3 pb-2 flex flex-col gap-1.5">
          {todos.map((todo, index) => {
            const Icon = STATUS_ICON[todo.status]
            const label = todo.status === "in_progress" ? todo.active_form : todo.content
            return (
              <li key={index} className="flex items-start gap-2 text-xs">
                <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", STATUS_CLASS[todo.status])} />
                <span className={cn(todo.status === "completed" && "text-muted-foreground line-through")}>
                  {label}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
})
