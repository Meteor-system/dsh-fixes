import { describe, expect, it } from "vitest";
import { probeHostSurface } from "../src/host-probe.ts";

describe("probeHostSurface", () => {
  it("reports a service ready when it exposes every required method", () => {
    const services: Record<string, unknown> = {
      llm: { stream: () => undefined },
      web: { registerSearchProvider: () => () => undefined },
    };
    const report = probeHostSurface((name) => services[name], [
      { name: "llm", members: ["stream"] },
      { name: "web", members: ["registerSearchProvider"] },
    ]);

    expect(report).toEqual({ ready: ["llm", "web"], missing: [] });
  });

  it("reports a service that is not registered as unavailable", () => {
    const report = probeHostSurface(() => undefined, [{ name: "web", members: ["registerSearchProvider"] }]);
    expect(report).toEqual({
      ready: [],
      missing: [{ name: "web", reason: "service unavailable" }],
    });
  });

  it("reports a service that lacks a required method by name", () => {
    const report = probeHostSurface(() => ({ measure: "not a function" }), [
      { name: "tokenMeter", members: ["measure"] },
    ]);
    expect(report.missing).toEqual([{ name: "tokenMeter", reason: "missing method measure" }]);
  });

  it("treats a lookup that throws as missing and keeps probing the rest", () => {
    const services: Record<string, unknown> = { llm: { stream: () => undefined } };
    const report = probeHostSurface(
      (name) => {
        if (name === "sessions") throw new Error("not mounted");
        return services[name];
      },
      [
        { name: "sessions", members: ["get"] },
        { name: "llm", members: ["stream"] },
      ],
    );

    expect(report.ready).toEqual(["llm"]);
    expect(report.missing).toEqual([{ name: "sessions", reason: "lookup failed: not mounted" }]);
  });
});
