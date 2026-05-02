#!/usr/bin/env bash
# Test the Prototyper sandbox with commands the AI model actually runs.
# Uses a real scaffolded project from ~/.local/share/com.m.prototyper/projects/
# so node_modules, typescript, tsconfig etc. are all present.
set -euo pipefail

SELF_EXE=""
PROJECT=""
SANDBOX_TIMEOUT=25
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() { echo -e "${GREEN}PASS${NC}: $1"; PASS=$((PASS+1)); }
log_fail() { echo -e "${RED}FAIL${NC}: $1 — ${2:0:200}"; FAIL=$((FAIL+1)); }
log_info()  { echo -e "${YELLOW}INFO${NC}: $1"; }
log_output() { echo "  output:"; echo "$1" | head -20; }

# ── Locate the real project ────────────────────────────────────────────
APP_DATA="${XDG_DATA_HOME:-$HOME/.local/share}/com.m.prototyper/projects"
if [ -d "$APP_DATA" ]; then
    # Prefer my-test-project (has known TS errors for test 10)
    if [ -f "$APP_DATA/my-test-project/component-preview/node_modules/typescript/lib/tsc.js" ]; then
        PROJECT="$APP_DATA/my-test-project"
    else
        # Fall back: pick the first project that has a component-preview scaffold
        for dir in "$APP_DATA"/*/; do
            if [ -f "${dir}component-preview/node_modules/typescript/lib/tsc.js" ]; then
                PROJECT="${dir%/}"
                break
            fi
        done
    fi
fi

if [ -z "$PROJECT" ]; then
    echo "ERROR: No scaffolded project found in $APP_DATA"
    echo "Open Prototyper and create/scaffold a project first."
    exit 1
fi

# Build if needed
if [ ! -f "./src-tauri/target/debug/prototyper" ]; then
    log_info "Building prototyper..."
    (cd src-tauri && cargo build 2>&1)
fi

SELF_EXE=$(readlink -f "./src-tauri/target/debug/prototyper")

log_info "Project:  $PROJECT"
log_info "Binary:   $SELF_EXE"

# ── Helper: run a command inside the sandbox ────────────────────────────
# Mirrors build_sandbox_command in bwrap.rs exactly.
run_sandbox() {
    local cmd="$1"
    timeout "$SANDBOX_TIMEOUT" bwrap \
        --ro-bind /usr /usr \
        --symlink usr/bin /bin \
        --symlink usr/sbin /sbin \
        --ro-bind-try /lib /lib \
        --ro-bind-try /lib64 /lib64 \
        --ro-bind-try /etc /etc \
        --ro-bind-try /run /run \
        --ro-bind "$SELF_EXE" "$SELF_EXE" \
        --proc /proc \
        --dev /dev \
        --tmpfs /tmp \
        --bind "$PROJECT" "$PROJECT" \
        --chdir "$PROJECT" \
        --unshare-pid \
        --unshare-ipc \
        --unshare-uts \
        --hostname ai-sandbox \
        --new-session \
        --die-with-parent \
        --clearenv \
        --setenv HOME "$PROJECT" \
        --setenv USER sandbox \
        --setenv PATH "/usr/local/bin:/usr/bin:/bin" \
        -- "$SELF_EXE" \
        --sandbox-init \
        -- sh -c "$cmd" 2>&1
}

# Filter out [sandbox-init]/[sandbox] diagnostic lines from output
# (these go to stderr and get mixed in by the combined capture)
clean_output() {
    grep -v '^\[sandbox' || true
}

# ════════════════════════════════════════════════════════════════════════
# Test 1: Basic echo
# ════════════════════════════════════════════════════════════════════════
log_info "Test 1: echo hello"
OUTPUT=$(run_sandbox "echo hello" | clean_output) || true
log_output "$OUTPUT"
if echo "$OUTPUT" | grep -q "hello"; then
    log_pass "echo hello"
else
    log_fail "echo hello" "$OUTPUT"
fi

# ════════════════════════════════════════════════════════════════════════
# Test 2: ls -la (needs statx, getxattr)
# ════════════════════════════════════════════════════════════════════════
log_info "Test 2: ls -la"
OUTPUT=$(run_sandbox "ls -la" | clean_output) || true
log_output "$OUTPUT"
if echo "$OUTPUT" | grep -q "component-preview" && ! echo "$OUTPUT" | grep -q "Operation not permitted"; then
    log_pass "ls -la works (statx + xattr allowed)"
else
    log_fail "ls -la" "$OUTPUT"
fi

# ════════════════════════════════════════════════════════════════════════
# Test 3: bun --version
# ════════════════════════════════════════════════════════════════════════
log_info "Test 3: bun --version"
OUTPUT=$(run_sandbox "bun --version" | clean_output) || true
log_output "$OUTPUT"
if echo "$OUTPUT" | grep -qE "[0-9]+\.[0-9]+"; then
    log_pass "bun --version works"
else
    log_fail "bun --version" "$OUTPUT"
fi

# ════════════════════════════════════════════════════════════════════════
# Test 4: Shell operators (cd && echo)
# ════════════════════════════════════════════════════════════════════════
log_info "Test 4: cd && echo"
OUTPUT=$(run_sandbox "cd $PROJECT && echo ok" | clean_output) || true
log_output "$OUTPUT"
if echo "$OUTPUT" | grep -q "ok"; then
    log_pass "shell operators (&&) work"
else
    log_fail "shell operators" "$OUTPUT"
fi

# ════════════════════════════════════════════════════════════════════════
# Test 5: /dev/null write and stderr redirect
# ════════════════════════════════════════════════════════════════════════
log_info "Test 5: 2>/dev/null"
OUTPUT=$(run_sandbox "ls /nonexistent 2>/dev/null; echo done" | clean_output) || true
log_output "$OUTPUT"
if echo "$OUTPUT" | grep -q "done" && ! echo "$OUTPUT" | grep -q "Permission denied"; then
    log_pass "/dev/null redirect works"
else
    log_fail "/dev/null redirect" "$OUTPUT"
fi

# ════════════════════════════════════════════════════════════════════════
# Test 6: File write + read
# ════════════════════════════════════════════════════════════════════════
log_info "Test 6: file write + read"
OUTPUT=$(run_sandbox "echo testfile > sandbox_test.txt && cat sandbox_test.txt" | clean_output) || true
log_output "$OUTPUT"
if echo "$OUTPUT" | grep -q "testfile"; then
    log_pass "file write + read works"
else
    log_fail "file write + read" "$OUTPUT"
fi

# ════════════════════════════════════════════════════════════════════════
# Test 7: find command
# ════════════════════════════════════════════════════════════════════════
log_info "Test 7: find components"
OUTPUT=$(run_sandbox "find components -name '*.tsx' 2>/dev/null" | clean_output) || true
log_output "$OUTPUT"
if echo "$OUTPUT" | grep -q "component.tsx"; then
    log_pass "find command works"
else
    log_fail "find command" "$OUTPUT"
fi

# ════════════════════════════════════════════════════════════════════════
# Test 8: bun --print (JS execution inside sandbox)
# ════════════════════════════════════════════════════════════════════════
log_info "Test 8: bun --print"
OUTPUT=$(run_sandbox "bun --print '1+1'" | clean_output) || true
log_output "$OUTPUT"
if echo "$OUTPUT" | grep -q "2"; then
    log_pass "bun --print works"
else
    log_fail "bun --print" "$OUTPUT"
fi

# ════════════════════════════════════════════════════════════════════════
# Test 9: tsc --noEmit (the actual model workflow)
# Uses the locally-installed typescript from component-preview/node_modules
# (not bunx which would need network access to download).
# ════════════════════════════════════════════════════════════════════════
log_info "Test 9: tsc --noEmit (real model workflow)"
OUTPUT=$(run_sandbox "cd component-preview && bun node_modules/typescript/lib/tsc.js --noEmit --project ../tsconfig.check.json 2>&1" | clean_output) || true
log_output "$OUTPUT"
if ! echo "$OUTPUT" | grep -qi "permission denied\|operation not permitted\|seccomp\|illegal instruction\|bad system call\|SIGSYS"; then
    log_pass "tsc --noEmit runs without sandbox errors"
else
    log_fail "tsc --noEmit sandbox error" "$OUTPUT"
fi

# ════════════════════════════════════════════════════════════════════════
# Test 10: tsc actually finds TS errors in components
# ════════════════════════════════════════════════════════════════════════
log_info "Test 10: tsc finds real component errors"
OUTPUT=$(run_sandbox "cd component-preview && bun node_modules/typescript/lib/tsc.js --noEmit --project ../tsconfig.check.json 2>&1 | grep 'components/'" | clean_output) || true
log_output "$OUTPUT"
if echo "$OUTPUT" | grep -q "error TS"; then
    log_pass "tsc reports real TS errors in components"
else
    # Not necessarily a failure — components might be clean
    log_info "tsc found no component errors (may be clean project)"
fi

# ════════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════════
echo ""
echo "========================================="
echo "  Sandbox Test Results"
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
echo "========================================="

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
