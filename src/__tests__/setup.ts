// Mock Tauri IPC — @tauri-apps/api/core is not available in jsdom
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: vi.fn().mockImplementation(() => ({ onmessage: null })),
  convertFileSrc: vi.fn((p: string) => p),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// crypto.randomUUID is available in Node 19+ but some jsdom versions need this
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      randomUUID: () =>
        Math.random().toString(36).slice(2) +
        Math.random().toString(36).slice(2),
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
        return arr;
      },
    },
    configurable: true,
  });
}
