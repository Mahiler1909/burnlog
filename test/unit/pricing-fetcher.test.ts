import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node:fs and node:fs/promises before importing the module
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import {
  fetchRemotePricing,
  loadBundledPricing,
  loadCachedPricing,
  savePricingCache,
  resolvePricing,
} from "../../src/utils/pricing-fetcher.js";

describe("fetchRemotePricing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses LiteLLM format and converts to per-million pricing", async () => {
    const mockData = {
      "claude-sonnet-4-5": {
        input_cost_per_token: 0.000003,   // $3/M
        output_cost_per_token: 0.000015,  // $15/M
        cache_creation_input_token_cost: 0.00000375, // $3.75/M
        cache_read_input_token_cost: 0.0000003, // $0.30/M
      },
      "claude-opus-4-6": {
        input_cost_per_token: 0.000005,   // $5/M
        output_cost_per_token: 0.000025,  // $25/M
        cache_creation_input_token_cost: 0.00000625,
        cache_read_input_token_cost: 0.0000005,
      },
      // Non-claude entries should be filtered out
      "gpt-4o": {
        input_cost_per_token: 0.000005,
        output_cost_per_token: 0.000015,
      },
      // Bedrock variants should be filtered out (not starting with "claude-")
      "anthropic.claude-sonnet-4-5": {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      },
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const result = await fetchRemotePricing();

    expect(result.source).toBe("litellm");
    expect(Object.keys(result.models)).toHaveLength(2); // Only claude- prefixed

    const sonnet = result.models["claude-sonnet-4-5"];
    expect(sonnet.inputPerMillion).toBe(3);
    expect(sonnet.outputPerMillion).toBe(15);
    expect(sonnet.cacheWritePerMillion).toBe(3.75);
    expect(sonnet.cacheReadPerMillion).toBe(0.3);

    const opus = result.models["claude-opus-4-6"];
    expect(opus.inputPerMillion).toBe(5);
    expect(opus.outputPerMillion).toBe(25);
  });

  it("strips date suffix to create canonical keys", async () => {
    const mockData = {
      "claude-sonnet-4-5-20250929": {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      },
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const result = await fetchRemotePricing();
    expect(result.models["claude-sonnet-4-5"]).toBeDefined();
    expect(result.models["claude-sonnet-4-5-20250929"]).toBeUndefined();
  });

  it("throws on HTTP error", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(fetchRemotePricing()).rejects.toThrow("HTTP 500");
  });

  it("derives cache pricing when not provided", async () => {
    const mockData = {
      "claude-sonnet-4-5": {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
        // No cache fields
      },
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const result = await fetchRemotePricing();
    const sonnet = result.models["claude-sonnet-4-5"];
    // cacheWrite = input * 1.25, cacheRead = input * 0.1
    expect(sonnet.cacheWritePerMillion).toBe(3.75);
    expect(sonnet.cacheReadPerMillion).toBe(0.3);
  });

  it("derives display names for old naming pattern", async () => {
    const mockData = {
      "claude-3-5-sonnet": {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      },
      "claude-3-opus": {
        input_cost_per_token: 0.000015,
        output_cost_per_token: 0.000075,
      },
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const result = await fetchRemotePricing();
    expect(result.models["claude-3-5-sonnet"].displayName).toBe("Sonnet 3.5");
    expect(result.models["claude-3-opus"].displayName).toBe("Opus 3");
  });

  it("falls back to canonical key for unrecognized patterns", async () => {
    const mockData = {
      "claude-custom-model": {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      },
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const result = await fetchRemotePricing();
    expect(result.models["claude-custom-model"].displayName).toBe("claude-custom-model");
  });
});

describe("loadCachedPricing", () => {
  afterEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(readFileSync).mockReset();
  });

  it("returns null when cache file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(loadCachedPricing()).toBeNull();
  });

  it("returns null when cache is expired (>24h)", () => {
    const expiredDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        lastUpdated: "2026-03-29",
        source: "litellm",
        models: { "claude-opus-4-6": { displayName: "Opus 4.6", inputPerMillion: 5, outputPerMillion: 25, cacheWritePerMillion: 6.25, cacheReadPerMillion: 0.5 } },
        cachedAt: expiredDate,
      }),
    );
    expect(loadCachedPricing()).toBeNull();
  });

  it("returns data when cache is fresh (<24h)", () => {
    const freshDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
    const cachedData = {
      lastUpdated: "2026-03-30",
      source: "litellm",
      models: { "claude-opus-4-6": { displayName: "Opus 4.6", inputPerMillion: 5, outputPerMillion: 25, cacheWritePerMillion: 6.25, cacheReadPerMillion: 0.5 } },
      cachedAt: freshDate,
    };
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cachedData));

    const result = loadCachedPricing();
    expect(result).not.toBeNull();
    expect(result!.source).toBe("litellm");
    expect(result!.models["claude-opus-4-6"].inputPerMillion).toBe(5);
  });

  it("returns null when cache has no models field", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ lastUpdated: "2026-03-30", source: "litellm" }));
    expect(loadCachedPricing()).toBeNull();
  });

  it("returns null when cache has no lastUpdated field", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ source: "litellm", models: {} }));
    expect(loadCachedPricing()).toBeNull();
  });

  it("returns null when cache has no cachedAt (treats as expired)", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        lastUpdated: "2026-03-30",
        source: "litellm",
        models: { "claude-opus-4-6": { displayName: "Opus 4.6", inputPerMillion: 5, outputPerMillion: 25, cacheWritePerMillion: 6.25, cacheReadPerMillion: 0.5 } },
      }),
    );
    expect(loadCachedPricing()).toBeNull();
  });

  it("returns null on JSON parse error", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("not json {{{");
    expect(loadCachedPricing()).toBeNull();
  });
});

describe("savePricingCache", () => {
  afterEach(() => {
    vi.mocked(mkdir).mockReset();
    vi.mocked(writeFile).mockReset();
  });

  it("creates directory and writes cache file", async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const data = {
      lastUpdated: "2026-03-30",
      source: "litellm",
      models: { "claude-opus-4-6": { displayName: "Opus 4.6", inputPerMillion: 5, outputPerMillion: 25, cacheWritePerMillion: 6.25, cacheReadPerMillion: 0.5 } },
    };

    await savePricingCache(data);

    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining("burnlog"), { recursive: true });
    expect(writeFile).toHaveBeenCalledOnce();
    const written = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
    expect(written.cachedAt).toBeDefined();
    expect(written.source).toBe("litellm");
  });

  it("does not throw when mkdir fails", async () => {
    vi.mocked(mkdir).mockRejectedValue(new Error("EACCES"));
    await expect(savePricingCache({ lastUpdated: "", source: "", models: {} })).resolves.toBeUndefined();
  });
});

describe("resolvePricing", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    stderrSpy.mockRestore();
    vi.mocked(existsSync).mockReset();
    vi.mocked(readFileSync).mockReset();
  });

  it("returns cached data when cache is fresh", async () => {
    const freshDate = new Date(Date.now() - 1000).toISOString();
    const cachedData = {
      lastUpdated: "2026-03-30",
      source: "litellm",
      models: { "claude-opus-4-6": { displayName: "Opus 4.6", inputPerMillion: 5, outputPerMillion: 25, cacheWritePerMillion: 6.25, cacheReadPerMillion: 0.5 } },
      cachedAt: freshDate,
    };
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cachedData));

    const result = await resolvePricing();
    expect(result.source).toBe("litellm");
    expect(fetch).not.toHaveBeenCalled(); // No network request needed
  });

  it("fetches remote and caches when no cached data", async () => {
    // No cache
    vi.mocked(existsSync).mockImplementation((path) => {
      if (String(path).includes("pricing-cache")) return false;
      // Allow actual bundled pricing.json to be read
      return true;
    });

    const remoteMock = {
      "claude-opus-4-6": {
        input_cost_per_token: 0.000005,
        output_cost_per_token: 0.000025,
      },
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => remoteMock,
    });
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await resolvePricing();
    expect(result.source).toBe("litellm");
    expect(fetch).toHaveBeenCalledOnce();
    expect(writeFile).toHaveBeenCalledOnce(); // Saved to cache
  });

  it("falls back to bundled when fetch fails and emits warning", async () => {
    // No cache file
    vi.mocked(existsSync).mockReturnValue(false);

    // Fetch fails
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network error"));

    // readFileSync must work for bundled pricing.json — restore real implementation
    vi.mocked(readFileSync).mockRestore();

    const result = await resolvePricing();
    expect(result.models).toBeDefined();
    expect(Object.keys(result.models).length).toBeGreaterThan(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("bundled pricing"));
  });

  it("returns bundled directly in offline mode without warning", async () => {
    vi.mocked(existsSync).mockReturnValue(false); // No cache

    const result = await resolvePricing({ offline: true });
    expect(result.models).toBeDefined();
    expect(Object.keys(result.models).length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled(); // No warning in offline mode
  });
});

describe("loadBundledPricing", () => {
  it("returns valid pricing data", () => {
    const data = loadBundledPricing();
    expect(data.lastUpdated).toBeDefined();
    expect(data.source).toBeDefined();
    expect(Object.keys(data.models).length).toBeGreaterThan(10);

    // Every model should have all required fields
    for (const [key, model] of Object.entries(data.models)) {
      expect(model.displayName, `${key} missing displayName`).toBeDefined();
      expect(model.inputPerMillion, `${key} missing inputPerMillion`).toBeGreaterThan(0);
      expect(model.outputPerMillion, `${key} missing outputPerMillion`).toBeGreaterThan(0);
      expect(model.cacheWritePerMillion, `${key} missing cacheWritePerMillion`).toBeGreaterThan(0);
      expect(model.cacheReadPerMillion, `${key} missing cacheReadPerMillion`).toBeGreaterThan(0);
    }
  });
});
