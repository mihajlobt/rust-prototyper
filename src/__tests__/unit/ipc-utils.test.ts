/**
 * Unit tests for IPC utility functions that contain pure logic.
 *
 * isNotFoundError is used throughout the app to distinguish "file doesn't exist"
 * from real errors. Getting this wrong causes silent data loss or spurious crashes.
 */

import { describe, it, expect } from "vitest";
import { isNotFoundError, getErrorMessage } from "@/lib/ipc";

describe("isNotFoundError", () => {
  // The implementation uses /os error 2/ — the POSIX error code Tauri surfaces
  // for ENOENT. This is the contract: only "os error 2" is treated as not-found.
  it("returns true for the Tauri os-error-2 string", () => {
    expect(isNotFoundError("os error 2")).toBe(true);
    expect(isNotFoundError("read file failed: os error 2")).toBe(true);
  });

  it("returns true for Error objects containing os error 2", () => {
    expect(isNotFoundError(new Error("No such file or directory (os error 2)"))).toBe(true);
  });

  it("returns false for other error strings", () => {
    expect(isNotFoundError("No such file or directory")).toBe(false);
    expect(isNotFoundError("path not found")).toBe(false);
    expect(isNotFoundError(new Error("Permission denied"))).toBe(false);
    expect(isNotFoundError("something went wrong")).toBe(false);
  });

  it("returns false for null/undefined/non-error types", () => {
    expect(isNotFoundError(null)).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
    expect(isNotFoundError(42)).toBe(false);
    expect(isNotFoundError({})).toBe(false);
  });
});

describe("getErrorMessage", () => {
  it("extracts message from an Error object", () => {
    expect(getErrorMessage(new Error("something failed"))).toBe("something failed");
  });

  it("returns plain strings as-is", () => {
    expect(getErrorMessage("tauri error: file not found")).toBe("tauri error: file not found");
  });

  it("falls back gracefully for non-string non-Error values", () => {
    const result = getErrorMessage(42);
    expect(typeof result).toBe("string");
  });
});
