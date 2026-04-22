import { useCallback, useRef } from "react";
import { Channel } from "@tauri-apps/api/core";
import { generateCompletionStream, type CompletionEvent, type Message } from "@/lib/ipc";

export function useStreamingCompletion() {
  const abortChannelRef = useRef<Channel<CompletionEvent> | null>(null);

  const stream = useCallback(
    async (
      model: string,
      messages: Message[],
      host: string,
      apiKey: string,
      onChunk: (text: string) => void,
      onDone: () => void,
      onError: (message: string) => void
    ) => {
      const channel = new Channel<CompletionEvent>();
      abortChannelRef.current = channel;

      channel.onmessage = (msg: CompletionEvent) => {
        if (msg.event === "Chunk") {
          onChunk(msg.data.text);
        } else if (msg.event === "Done") {
          onDone();
        } else if (msg.event === "Error") {
          onError(msg.data.message);
        }
      };

      await generateCompletionStream(model, messages, host, apiKey, channel);
      abortChannelRef.current = null;
    },
    []
  );

  return { stream };
}