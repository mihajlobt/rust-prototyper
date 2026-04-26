# gemma4-26b-128k Tool Calling Test Report

**Date:** 2026-04-26
**Model:** gemma4-26b-128k:latest
**Test:** Full Prototyper system prompt + write_file tool via direct Ollama API

## Test Setup

**Command:**
```bash
curl -s -X POST http://localhost:11434/api/chat -d '{
  "model": "gemma4-26b-128k:latest",
  "messages": [
    {"role": "system", "content": "<FULL PROTOTYPER SYSTEM PROMPT>"},
    {"role": "user", "content": "admin panel sidebar component"}
  ],
  "stream": false,
  "tools": [<WRITE_FILE_TOOL_SCHEMA>]
}'
```

## Result: PASS

**Response:**
```json
{
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      {
        "id": "call_m2664qm3",
        "function": {
          "index": 0,
          "name": "write_file",
          "arguments": {
            "content": "<valid React TSX code>"
          }
        }
      }
    ]
  },
  "done_reason": "stop"
}
```

## Findings

| Check | Result |
|-------|--------|
| Model produces `tool_calls` | ✅ PASS |
| `content` field is empty | ✅ PASS |
| Arguments include `content` with raw code | ✅ PASS |
| Code is valid React (no JSON wrapper) | ✅ PASS |
| `done_reason: "stop"` (not "tool_calls") | ✅ PASS |

## Conclusion

**Ollama API with gemma4-26b-128k is working correctly.** The model correctly produces `tool_calls` when:
1. The system prompt includes `TOOL_USAGE_SECTION`
2. The `tools` array includes the `write_file` function definition

The problem is NOT in Ollama, the model, the system prompt, or the tool schema. The problem is in how Prototyper sends the request or processes the response.

## Next Steps

1. Check Prototyper's actual request — compare what `useChat.ts` sends vs this curl test
2. Check if `effectiveOutputPath` is `undefined` (tools disabled) in the app
3. Check if the Channel events are being processed correctly
4. Check if `toolsEnabled` is `false` due to capability detection failure