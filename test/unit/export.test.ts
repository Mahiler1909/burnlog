import { describe, it, expect, vi } from "vitest";
import { outputAs } from "../../src/cli/formatters/export.js";

describe("outputAs", () => {
  it("outputs JSON with 2-space indent", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const data = { foo: "bar", num: 42 };
    outputAs("json", data, () => {});
    expect(spy).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
    spy.mockRestore();
  });

  it("outputs CSV with headers", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const data = [
      { name: "Alice", cost: 10 },
      { name: "Bob", cost: 20 },
    ];
    outputAs("csv", data, () => {});
    expect(spy).toHaveBeenCalledWith("name,cost");
    expect(spy).toHaveBeenCalledWith("Alice,10");
    expect(spy).toHaveBeenCalledWith("Bob,20");
    spy.mockRestore();
  });

  it("escapes commas in CSV values", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const data = [{ desc: "hello, world" }];
    outputAs("csv", data, () => {});
    expect(spy).toHaveBeenCalledWith('"hello, world"');
    spy.mockRestore();
  });

  it("doubles quotes in CSV values", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const data = [{ desc: 'say "hi"' }];
    outputAs("csv", data, () => {});
    expect(spy).toHaveBeenCalledWith('"say ""hi"""');
    spy.mockRestore();
  });

  it("wraps newlines in CSV values", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const data = [{ desc: "line1\nline2" }];
    outputAs("csv", data, () => {});
    expect(spy).toHaveBeenCalledWith('"line1\nline2"');
    spy.mockRestore();
  });

  it("calls renderFn for table format", () => {
    const renderFn = vi.fn();
    outputAs("table", {}, renderFn);
    expect(renderFn).toHaveBeenCalledOnce();
  });

  it("handles empty CSV array", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    outputAs("csv", [], () => {});
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
