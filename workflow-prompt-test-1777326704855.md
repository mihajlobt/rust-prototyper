# Workflow Prompt Test Report

**Date**: 2026-04-27T21:51:44.855Z
**Models**: gemma4-26b-128k:latest
**Host**: http://localhost:11434 (local), https://ollama.com (cloud)
**Total assertions**: 77

## gemma4-26b-128k:latest

**Result**: 75/77 assertions passed

### ✅ Requirements

- **Assertions**: 11/11
- **Output length**: 3054 chars
- **Latency**: 21361ms

### ✅ Architect

- **Assertions**: 9/9
- **Output length**: 5747 chars
- **Latency**: 18050ms

### ⚠️ Structure

- **Assertions**: 10/11
- **Output length**: 11356 chars
- **Latency**: 34013ms

**Failed assertions**:
- ❌ No HTML/DOCTYPE wrapper — Found HTML/DOCTYPE wrapper

### ✅ Style

- **Assertions**: 11/11
- **Output length**: 3867 chars
- **Latency**: 22507ms

### ✅ Interaction

- **Assertions**: 10/10
- **Output length**: 5845 chars
- **Latency**: 20233ms

### ✅ Reference

- **Assertions**: 8/8
- **Output length**: 2782 chars
- **Latency**: 12928ms

### ✅ Validate

- **Assertions**: 7/7
- **Output length**: 1713 chars
- **Latency**: 12355ms

### ⚠️ Transform

- **Assertions**: 9/10
- **Output length**: 175 chars
- **Latency**: 3065ms

**Failed assertions**:
- ❌ Has table separator row (---) — Expected pattern /\|[\s-]*\|[\s-]*\|/ in output
