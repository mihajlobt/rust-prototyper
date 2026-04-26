# Plan: Fix Ollama Tool Calling — "All Local Models Show No Capabilities"

## Context

The user reports that after commit `b22057d` ("feat(agent): implement multi-tool agentic loop in Rust"), all local Ollama models show zero capabilities. Tool calling is broken. This was working before the agent refactoring.

**Ollama API diagnostic confirms** ([ollama-api-diagnostic.md](file:///home/m/Desktop/Prototyper/ollama-api-diagnostic.md)):
- gemma4-26b-128k returns `capabilities: ["completion", "vision", "tools", "thinking"]` from `/api/show`
- gemma4 correctly produces `tool_calls` when tools are provided
- Ollama API itself is working perfectly

The bug is NOT in Ollama. The bug is in how the Rust/Tauri code processes these responses or how the frontend applies them.

---

## Root Cause Analysis (Verified with Direct API Test)

### Direct Ollama API Test: PASS ✅

Tested with curl against gemma4-26b-128k:latest using the **exact same** system prompt and tool schema that Prototyper uses:

**Command:** `curl -s -X POST http://localhost:11434/api/chat -d '{model, messages, tools}'`

**Result:**
```json
{
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [{
      "id": "call_m2664qm3",
      "function": {
        "name": "write_file",
        "arguments": {
          "content": "<valid React TSX code - 150+ lines>"
        }
      }
    }]
  },
  "done_reason": "stop"
}
```

**The model produces proper `tool_calls` with raw code in arguments. No JSON wrapper, no text in content field.**

Full test saved to: [gemma4-test-tools.md](file:///home/m/Desktop/Prototyper/gemma4-test-tools.md)

### Conclusion: Ollama API Works, Problem is in Prototyper Code

The bug is NOT in:
- ❌ Ollama API
- ❌ gemma4 model
- ❌ System prompt (`TOOL_USAGE_SECTION` works)
- ❌ Tool schema (ollama-rs `schemars` produces correct format)
- ❌ Model capability detection (Ollama returns `"tools"` in capabilities)

The bug IS in how Prototyper's Rust/Tauri code processes responses or how the frontend determines whether to use tools.

---

## Fix Plan (Updated with Confirmed Root Cause)

The diagnostic narrows the bug to one of:
1. **Frontend: `effectiveOutputPath` is `undefined`** because `toolsEnabled` is `false`
2. **Frontend: `useModelCapabilities` returns wrong `tools: false`** despite Ollama returning `"tools"`
3. **Backend: Response events not reaching frontend** via Channel
4. **Backend: Tool calls received but not parsed correctly**

### Phase 1: Add Debug Logging to Confirm Chain

**File:** `src/hooks/useModelCapabilities.ts` — add console.log in select callback

```typescript
select: (models: OllamaModel[]): Capabilities => {
  console.log('[useModelCapabilities] models count:', models.length);
  console.log('[useModelCapabilities] modelId:', modelId);
  models.forEach(m => console.log(`  ${m.id}: capabilities=`, m.capabilities));
  const model = models.find((m) => m.id === modelId)
  if (!model) { console.log('[useModelCapabilities] MODEL NOT FOUND'); return EMPTY_CAPS }
  const caps = toCaps(model);
  console.log('[useModelCapabilities] resulting caps:', caps);
  return caps;
},
```

**File:** `src/hooks/useChat.ts` — add console.log at line 148

```typescript
console.log('[useChat] toolsEnabled:', toolsEnabled, 'caps.tools:', caps.tools, 'outputPath:', outputPath);
const effectiveOutputPath = outputPath && toolsEnabled ? outputPath : undefined;
console.log('[useChat] effectiveOutputPath:', effectiveOutputPath);
```

### Phase 2: Run and Observe

1. Run `bun run tauri:dev`
2. Select gemma4-26b-128k:latest in Prototyper
3. Open Components panel
4. Send "admin panel sidebar component"
5. Check browser console for the debug logs
6. The logs will show exactly where the chain breaks

### Phase 3: Fix Based on Observed Behavior

Once we see where it breaks, apply targeted fix:

- If `models` is empty or doesn't include gemma4 → fix the `list_ollama_models` query
- If `model` not found (modelId mismatch) → fix how modelId is passed
- If `caps.tools` is `false` despite model having `"tools"` → fix `toCaps`
- If `effectiveOutputPath` is `undefined` → fix `toolsEnabled` logic

---

## Files to Modify

| File | Change | Reference |
|------|--------|-----------|
| `src/hooks/useModelCapabilities.ts` | Add console.log diagnostic in select callback | TanStack Query [useQuery](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery) |
| `src/hooks/useChat.ts` | Add console.log at effectiveOutputPath assignment | React hooks pattern |
| `src-tauri/src/lib.rs` | Optional: add tracing in `list_ollama_models` | [Ollama API docs](https://docs.ollama.com/api-reference/show-model-details) |

---

## Verification

1. Run `bun run tauri:dev`
2. Check browser console for diagnostic output
3. Find where chain breaks → apply fix
4. Verify `ToolCall` and `ToolResult` events appear in Channel
