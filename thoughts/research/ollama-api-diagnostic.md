# Ollama API Diagnostic Report

Date: 2026-04-26
Model: gemma4-26b-128k

## Test 1: List Models

**Command:**
```bash
curl -s http://localhost:11434/api/tags | jq .
```

**Result:** gemma4-26b-128k:latest is present in the model list.

---

## Test 2: Show Model Capabilities

**Command:**
```bash
curl -s -X POST http://localhost:11434/api/show -d '{"model":"gemma4-26b-128k"}' | jq '.capabilities'
```

**Result:**
```json
["completion", "vision", "tools", "thinking"]
```

**Conclusion:** capabilities.tools IS present. The model reports it supports tools.

---

## Test 3: Tool Calling Test

**Command:**
```bash
curl -s -X POST http://localhost:11434/api/chat -d '{
  "model": "gemma4-26b-128k",
  "messages": [{"role": "user", "content": "What is 2+2? Just answer briefly."}],
  "tools": [{"type": "function", "function": {"name": "add", "description": "Add two numbers", "parameters": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}, "required": ["a", "b"]}}}]
}' | jq .
```

**Key Response (final chunk):**
```json
{
  "model": "gemma4-26b-128k",
  "created_at": "2026-04-26T17:28:56.799465360Z",
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      {
        "id": "call_okdhmw3f",
        "function": {
          "index": 0,
          "name": "add",
          "arguments": {
            "a": 2,
            "b": 2
          }
        }
      }
    ]
  },
  "done": true,
  "done_reason": "stop",
  "total_duration": 6977460906,
  "load_duration": 6037192807,
  "prompt_eval_count": 76,
  "prompt_eval_duration": 66121114,
  "eval_count": 89,
  "eval_duration": 730622249
}
```

**Conclusion:** gemma4-26b-128k correctly produces `tool_calls` with a proper call ID, function name, and parsed JSON arguments when tools are provided.

---

## Summary

| Check | Status |
|-------|--------|
| Model available | PASS |
| capabilities.tools present | PASS |
| Model produces tool_calls | PASS |

**The Ollama API itself is working correctly.** gemma4-26b-128k:
- Reports "tools" capability
- Produces `tool_calls` array (not text) when tools are provided
- Correctly parses arguments as JSON `{"a":2,"b":2}`

The bug is NOT in Ollama or the raw API responses. The issue is in how the Rust agent code (commit b22057d) parses or handles these responses after receiving them. The agent loop or capability detection code in `src-tauri/src/agent/` may be incorrectly filtering or ignoring the capabilities.tools field, or mishandling the tool_calls in the streaming response.