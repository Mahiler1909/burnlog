import { vi } from "vitest";

// Mock process.exit to throw instead of exiting
vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
  throw new Error(`process.exit(${code})`);
});
