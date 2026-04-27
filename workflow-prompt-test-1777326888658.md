# Workflow Prompt Test Report

**Date**: 2026-04-27T21:54:48.658Z
**Models**: minimax-m2.7
**Host**: http://localhost:11434 (local), https://ollama.com (cloud)
**Total assertions**: 77

## minimax-m2.7

**Result**: 74/77 assertions passed

### ✅ Requirements

- **Assertions**: 11/11
- **Output length**: 5521 chars
- **Latency**: 17076ms

### ⚠️ Architect

- **Assertions**: 8/9
- **Output length**: 8545 chars
- **Latency**: 28787ms

**Failed assertions**:
- ❌ No implementation code (const/let/var assignments) — Found implementation code — architect should only produce structure

### ✅ Structure

- **Assertions**: 11/11
- **Output length**: 12196 chars
- **Latency**: 32452ms

### ⚠️ Style

- **Assertions**: 10/11
- **Output length**: 3972 chars
- **Latency**: 17305ms

**Failed assertions**:
- ❌ Has responsive breakpoints — Expected pattern /sm:|md:|lg:/i in output

### ✅ Interaction

- **Assertions**: 10/10
- **Output length**: 4881 chars
- **Latency**: 9359ms

### ✅ Reference

- **Assertions**: 8/8
- **Output length**: 3540 chars
- **Latency**: 22167ms

### ⚠️ Validate

- **Assertions**: 6/7
- **Output length**: 1540 chars
- **Latency**: 9708ms

**Failed assertions**:
- ❌ Catches TypeScript issues — Expected pattern /TypeScript|type|any|implicit/i in output

### ✅ Transform

- **Assertions**: 10/10
- **Output length**: 176 chars
- **Latency**: 4148ms
