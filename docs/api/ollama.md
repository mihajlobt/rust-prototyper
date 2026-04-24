# Ollama API Reference

Source: https://docs.ollama.com/api — fetched 2026-04-25 via Context7

---

## POST /api/chat

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | ✓ | Model name (e.g. `qwen3`, `llama3.2`) |
| `messages` | array | ✓ | Conversation messages |
| `stream` | boolean | – | Default `true`. Set `false` for single response |
| `think` | boolean \| string | – | Enable native thinking. `true`, `false`, or `"high"/"medium"/"low"` |
| `format` | string \| object | – | `"json"` or JSON schema for structured output |
| `options` | object | – | Model runtime options (see below) |
| `keep_alive` | string \| number | – | Duration to keep model loaded, e.g. `"5m"` or `0` to unload |
| `tools` | array | – | Function tools the model may call |
| `logprobs` | boolean | – | Return log probabilities |

### Message Object

```json
{
  "role": "user" | "assistant" | "system",
  "content": "string",
  "images": ["base64_string", ...]
}
```

### ModelOptions (in `options` field)

| Field | Type | Description |
|-------|------|-------------|
| `num_ctx` | integer | Context window size (tokens) |
| `num_predict` | integer | Max tokens to generate |
| `temperature` | number | Randomness (higher = more random) |
| `top_k` | integer | Limit token selection to top-K |
| `top_p` | number | Nucleus sampling threshold |
| `min_p` | number | Minimum probability threshold |
| `seed` | integer | Random seed for reproducibility |
| `stop` | string \| array | Stop sequences |

---

## Streaming Response Chunks

Each NDJSON line when `stream: true`:

```json
{
  "model": "qwen3",
  "created_at": "2025-...",
  "message": {
    "role": "assistant",
    "content": "partial text",
    "thinking": "reasoning trace (only when think:true)"
  },
  "done": false
}
```

Final chunk (`done: true`):
```json
{
  "model": "qwen3",
  "done": true,
  "done_reason": "stop",
  "total_duration": 1234567890,
  "prompt_eval_count": 15,
  "eval_count": 25
}
```

### Thinking Mode (native)

When `think: true`, chunks may have:
- `message.thinking` — reasoning trace (streamed)
- `message.content` — actual response (streamed after thinking)

These are **separate fields**, not embedded `<think>` tags.

```python
for chunk in stream:
    if chunk.message.thinking:  # reasoning
        ...
    if chunk.message.content:   # response
        ...
```

Some models (DeepSeek-R1 via GGUF) still use `<think>` tags in `content` instead — handle both.

---

## POST /api/tags (list local models)

```
GET /api/tags
```

Response:
```json
{
  "models": [
    {
      "name": "llama3.2:latest",
      "model": "llama3.2:latest",
      "modified_at": "2025-...",
      "size": 2019393189,
      "digest": "sha256:...",
      "details": {
        "parent_model": "",
        "format": "gguf",
        "family": "llama",
        "families": ["llama"],
        "parameter_size": "3.2B",
        "quantization_level": "Q4_K_M"
      }
    }
  ]
}
```

---

## OpenAI-compatible endpoint

```
POST /v1/chat/completions
```

Accepts standard OpenAI format. Extra Ollama-specific field:
- `reasoning_effort`: `"high"/"medium"/"low"/"none"` — controls thinking depth

---

## Notes

- Default port: `11434`
- Cloud API: `https://ollama.com` — same endpoints, requires `Authorization: Bearer {key}`
- Thinking models: Qwen3, DeepSeek-R1 (via `think: true` or auto-detected by model)
- Vision: attach `images` array to message object (base64 strings)
