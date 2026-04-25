# Ollama REST API Reference

Source: Official OpenAPI spec — https://docs.ollama.com/openapi.yaml
Fetched: 2026-04-25 via Context7 (research mode)
Validated: Live Ollama instance on localhost:11434
Full spec: `docs/api/ollama-openapi.yaml`

---

## Base URL

- Local: `http://localhost:11434`
- Cloud: `https://ollama.com` (same endpoints, requires `Authorization: Bearer {key}`)

---

## GET /api/tags — List Models

List all locally available models.

> **IMPORTANT**: `/api/tags` does NOT return `context_length` or `capabilities`.
> Use `/api/show` for those fields. See `ShowResponse` in OpenAPI spec.

### Response (from `ListResponse` / `ModelSummary` schema)

| Field | Type | Description |
|-------|------|-------------|
| `models[].name` | string | Model name (e.g. `gemma4:26b`) |
| `models[].model` | string | Same as name |
| `models[].modified_at` | string | ISO 8601 timestamp |
| `models[].size` | integer | Size in bytes |
| `models[].digest` | string | SHA256 digest |
| `models[].details.format` | string | File format (`gguf`) |
| `models[].details.family` | string | Primary model family (e.g. `gemma4`) |
| `models[].details.families` | string[] | All families |
| `models[].details.parameter_size` | string | Parameter count (e.g. `25.8B`) |
| `models[].details.quantization_level` | string | Quantization (e.g. `Q4_K_M`) |

### Live Example

```json
{
  "models": [{
    "name": "gemma4:26b",
    "model": "gemma4:26b",
    "modified_at": "2026-04-09T16:46:03.974Z",
    "size": 17987581232,
    "digest": "sha256:c6cb73f6...",
    "details": {
      "parent_model": "",
      "format": "gguf",
      "family": "gemma4",
      "families": ["gemma4"],
      "parameter_size": "25.8B",
      "quantization_level": "Q4_K_M"
    }
  }]
}
```

---

## POST /api/show — Show Model Details

Get capabilities, context length, and architecture for a specific model.
Requires `verbose: true` for `model_info` (which contains `context_length`).

### Request (from `ShowRequest` schema)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | ✓ | Model name |
| `verbose` | boolean | – | If `true`, includes `model_info` and `tensors` |

### Response (from `ShowResponse` schema)

| Field | Type | Description |
|-------|------|-------------|
| `capabilities` | string[] | Supported feature flags |
| `details` | object | High-level model details |
| `details.family` | string | Primary family — **key for model_info lookup** |
| `details.families` | string[] | All families |
| `details.format` | string | File format |
| `details.parameter_size` | string | Parameter count |
| `details.quantization_level` | string | Quantization level |
| `model_info` | object | Architecture metadata (verbose only) |
| `model_info.{family}.context_length` | integer | **Context window in tokens** — e.g. `262144` |
| `template` | string | Prompt template |
| `parameters` | string | Model parameters as text |
| `license` | string | License text |
| `modified_at` | string | ISO 8601 timestamp |

### `capabilities` Array (verified live)

| Value | Description |
|-------|-------------|
| `completion` | Standard text completion |
| `vision` | Accepts image inputs |
| `tools` | Supports function/tool calling |
| `thinking` | Supports native thinking mode (`think: true`) |

### Live Example (verbose)

```json
{
  "capabilities": ["completion", "vision", "tools", "thinking"],
  "details": {
    "format": "gguf",
    "family": "gemma4",
    "families": ["gemma4"],
    "parameter_size": "25.8B",
    "quantization_level": "Q4_K_M"
  },
  "model_info": {
    "gemma4.context_length": 262144,
    "gemma4.attention.head_count": 16,
    "gemma4.attention.sliding_window": 1024,
    "gemma4.block_count": 30
  },
  "template": "{{ .Prompt }}",
  "parameters": "temperature 1\ntop_k 64\ntop_p 0.95",
  "modified_at": "2026-04-09T16:46:03.974Z"
}
```

### Context Length Extraction

From `ShowResponse.model_info`:
```
family = response.details.family
context_length = response.model_info[family + ".context_length"]
```

---

## GET /api/ps — List Running Models

Lists models currently loaded in memory.

### Response (from `PsResponse` / `Ps` schema)

| Field | Type | Description |
|-------|------|-------------|
| `models[].name` | string | Running model name |
| `models[].size` | integer | Size in bytes |
| `models[].size_vram` | integer | VRAM usage in bytes |
| `models[].context_length` | integer | Context length for the running model |
| `models[].expires_at` | string | When model will be unloaded |

> `/api/ps` returns `context_length` only for **running** models.
> Use `/api/show` for all models (running or not).

---

## POST /api/chat — Chat Completion

### Request (from `ChatRequest` schema)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | ✓ | Model name |
| `messages` | array | ✓ | Chat history |
| `stream` | boolean | – | Default `true` |
| `think` | boolean \| string | – | `true`, `false`, or `"high"/"medium"/"low"` |
| `format` | string \| object | – | `"json"` or JSON schema |
| `options` | object | – | `ModelOptions` (see below) |
| `keep_alive` | string \| number | – | e.g. `"5m"` or `0` to unload |
| `tools` | array | – | `ToolDefinition` objects |
| `logprobs` | boolean | – | Return log probabilities |
| `top_logprobs` | integer | – | Number of top log probs |

### ChatMessage schema

| Field | Type | Description |
|-------|------|-------------|
| `role` | string | `system`, `user`, `assistant`, `tool` |
| `content` | string | Message text |
| `images` | string[] | Base64-encoded images (vision models) |
| `tool_calls` | array | Tool calls from assistant |

### ModelOptions schema

| Field | Type | Description |
|-------|------|-------------|
| `num_ctx` | integer | Context window size (tokens) |
| `num_predict` | integer | Max tokens to generate |
| `temperature` | float | Randomness |
| `top_k` | integer | Top-K sampling |
| `top_p` | float | Nucleus sampling threshold |
| `min_p` | float | Min probability threshold |
| `seed` | integer | Random seed |
| `stop` | string \| string[] | Stop sequences |
| `repeat_last_n` | integer | Tokens for repeat penalty |
| `repeat_penalty` | float | Repeat penalty |
| `presence_penalty` | float | Presence penalty |
| `frequency_penalty` | float | Frequency penalty |

### ChatResponse schema

| Field | Type | Description |
|-------|------|-------------|
| `message.role` | string | Always `assistant` |
| `message.content` | string | Assistant response text |
| `message.thinking` | string | Thinking trace (when `think` enabled) |
| `message.tool_calls` | array | Tool call requests |
| `done` | boolean | Whether response is complete |
| `done_reason` | string | Reason for completion |
| `total_duration` | integer | Total time (nanoseconds) |
| `load_duration` | integer | Load time (nanoseconds) |
| `prompt_eval_count` | integer | Input tokens |
| `eval_count` | integer | Output tokens |

### Streaming (NDJSON, `ChatStreamEvent` schema)

```json
{"model":"qwen3","created_at":"...","message":{"role":"assistant","content":"partial","thinking":"reasoning"},"done":false}
{"model":"qwen3","created_at":"...","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}
```

---

## POST /api/generate — Text Completion

### Request (from `GenerateRequest` schema)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | ✓ | Model name |
| `prompt` | string | ✓ | Input prompt |
| `suffix` | string | – | Fill-in-the-middle suffix |
| `images` | string[] | – | Base64 images |
| `format` | string \| object | – | Structured output format |
| `system` | string | – | System prompt |
| `stream` | boolean | – | Default `true` |
| `think` | boolean \| string | – | Thinking mode |
| `raw` | boolean | – | Skip prompt templating |
| `keep_alive` | string \| number | – | Model keep-alive |
| `options` | object | – | `ModelOptions` |
| `logprobs` | boolean | – | Return log probabilities |

### GenerateResponse schema

| Field | Type | Description |
|-------|------|-------------|
| `response` | string | Generated text |
| `thinking` | string | Thinking trace |
| `done` | boolean | Whether complete |
| `done_reason` | string | Completion reason |
| `total_duration` | integer | Total time (ns) |
| `prompt_eval_count` | integer | Input tokens |
| `eval_count` | integer | Output tokens |

---

## POST /api/embed — Generate Embeddings

### Request (from `EmbedRequest` schema)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | ✓ | Model name |
| `input` | string \| string[] | ✓ | Text(s) to embed |
| `truncate` | boolean | – | Default `true` |
| `dimensions` | integer | – | Output dimensions |
| `keep_alive` | string | – | Model keep-alive |
| `options` | object | – | `ModelOptions` |

### Response (from `EmbedResponse` schema)

```json
{
  "model": "embeddinggemma",
  "embeddings": [[0.010071029, -0.0017594862, ...]],
  "total_duration": 14143917,
  "prompt_eval_count": 8
}
```

---

## POST /api/create — Create Model

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | ✓ | Name for the new model |
| `from` | string | – | Existing model to create from |
| `template` | string | – | Prompt template |
| `system` | string | – | System prompt |
| `parameters` | object | – | Key-value parameters |
| `quantize` | string | – | Quantization level |
| `stream` | boolean | – | Default `true` |

---

## POST /api/copy — Copy Model

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | ✓ | Source model name |
| `destination` | string | ✓ | Destination model name |

---

## DELETE /api/delete — Delete Model

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | ✓ | Model name to delete |

---

## POST /api/pull — Pull Model

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | ✓ | Model to download |
| `insecure` | boolean | – | Allow insecure connections |
| `stream` | boolean | – | Default `true` |

---

## POST /api/push — Push Model

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | ✓ | Model to publish |
| `insecure` | boolean | – | Allow insecure connections |
| `stream` | boolean | – | Default `true` |

---

## OpenAI-Compatible Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | Standard OpenAI chat. Extra: `reasoning_effort` field |
| `POST /v1/embeddings` | Standard OpenAI embeddings |
| `GET /v1/models` | List models in OpenAI format |
| `POST /v1/messages` | Anthropic-compatible. Supports thinking, vision, tools |

---

## Key Implementation Notes

1. **Capabilities source of truth**: `/api/show` → `capabilities[]` array. NOT model name heuristics.
2. **Context length source of truth**: `/api/show` → `model_info.{family}.context_length`. Requires `verbose: true`.
3. `/api/tags` does NOT include `context_length` or `capabilities`.
4. `/api/ps` includes `context_length` but only for currently running models.
5. Thinking is enabled by `think: true` in chat requests. Ollama ignores this for non-thinking models.
6. Vision models accept `images` array (base64 strings) in message objects.
7. All durations are in nanoseconds.
8. Streaming uses NDJSON format (newline-delimited JSON).