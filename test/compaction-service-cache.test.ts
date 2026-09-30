import { describe, expect, it } from "vitest";
import { createAgentServiceCache } from "../src/compaction-service-cache.ts";

describe("createAgentServiceCache", () => {
  it("resolves an isolated service once for each agent", () => {
    const firstAgent = {};
    const secondAgent = {};
    let resolutions = 0;
    const firstService = { id: "first" };
    const secondService = { id: "second" };
    const cache = createAgentServiceCache((agent) => {
      resolutions += 1;
      return agent === firstAgent ? firstService : secondService;
    });

    expect(cache(firstAgent)).toBe(firstService);
    expect(cache(firstAgent)).toBe(firstService);
    expect(cache(secondAgent)).toBe(secondService);
    expect(cache(secondAgent)).toBe(secondService);
    expect(resolutions).toBe(2);
  });

  it("does not permanently cache an unavailable service", () => {
    const agent = {};
    let available = false;
    let resolutions = 0;
    const service = { id: "available" };
    const cache = createAgentServiceCache(() => {
      resolutions += 1;
      return available ? service : undefined;
    });

    expect(cache(agent)).toBeUndefined();
    available = true;
    expect(cache(agent)).toBe(service);
    expect(cache(agent)).toBe(service);
    expect(resolutions).toBe(2);
  });
});
