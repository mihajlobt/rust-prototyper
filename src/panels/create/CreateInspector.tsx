// Shared inspector pane for the four sub-modes. Renders <PromptInspector>
// with the same prop shape the four legacy panels used. Visibility (the
// show/hide toggle) is handled by the consumer at the Allotment level via
// the `visible` prop on the parent pane, not by this component — the
// pattern preserved from WizardPanel/ScreensPanel/ComponentsPanel/ThemesPanel.

import { PromptInspector } from "@/components/PromptInspector";
import type { ChatMessage } from "@/types/chat";
import type { Message, Provider } from "@/lib/ipc";

export interface CreateInspectorProps {
  /** The system prompt currently being sent (after all dynamic sections are appended). */
  systemPrompt: string;
  /** The chat's live messages. Tool calls and images are flattened into the IPC Message shape. */
  messages: ChatMessage[];
  /** Model id — used by the token counter. */
  model: string;
  /** Resolved host (handles the openai / ollama / claude variants). */
  host: string;
  provider: Provider;
  /** The resolved think parameter being sent — undefined means not sent. */
  think?: boolean | "low" | "medium" | "high";
  /** Whether the agent tool set is included in the request. */
  hasTools?: boolean;
}

export function CreateInspector({
  systemPrompt,
  messages,
  model,
  host,
  provider,
  think,
  hasTools,
}: CreateInspectorProps) {
  const inspectorMessages: Message[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.images?.length ? { images: m.images } : {}),
      ...(m.thinking ? { thinking: m.thinking } : {}),
      ...(m.toolCalls?.length
        ? {
            tool_calls: m.toolCalls.map((tc) => ({
              function: { name: tc.tool, arguments: tc.arguments },
            })),
          }
        : {}),
    })),
  ];

  return (
    <PromptInspector
      model={model}
      messages={inspectorMessages}
      host={host}
      provider={provider}
      think={think}
      hasTools={hasTools}
    />
  );
}
