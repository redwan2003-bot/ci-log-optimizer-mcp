import { describe, expect, it } from "vitest";
import {
  logExtractSignals,
  logMatchPatterns,
  pipelineEstimate,
  regexExplain,
  regexTest,
  workflowParse,
} from "../src/tools.js";

describe("regexTest", () => {
  it("returns matches with indices and groups", () => {
    const res = regexTest({ pattern: "(\\d+)-(\\w+)", flags: "g", text: "id 123-abc and 9-zz" });
    expect(res.matches.length).toBeGreaterThan(0);
    expect(res.matches[0]?.start).toBe(3);
    expect(res.matches[0]?.groups).toEqual(["123", "abc"]);
  });

  it("handles invalid regex", () => {
    const res = regexTest({ pattern: "(", text: "x" });
    expect(res.errors?.length).toBeTruthy();
  });
});

describe("regexExplain", () => {
  it("summarizes basic properties", () => {
    const res = regexExplain({ pattern: "^(?<name>\\w+)$", flavor: "ecmascript" });
    expect(res.summary.anchoredStart).toBe(true);
    expect(res.summary.anchoredEnd).toBe(true);
    expect(res.summary.hasNamedGroups).toBe(true);
  });
});

describe("logExtractSignals", () => {
  it("extracts errors and failing tests", () => {
    const log = [
      "Starting build",
      "WARN deprecated thing",
      "Error: cannot find module",
      "FAIL src/foo.test.ts",
    ].join("\n");
    const res = logExtractSignals({ logText: log, formatHint: "generic" });
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.failingTests.length).toBeGreaterThan(0);
    expect(res.stats.totalLines).toBe(4);
  });
});

describe("logMatchPatterns", () => {
  it("counts matching lines per pattern", () => {
    const log = ["Error: boom", "ok", "Error: again"].join("\n");
    const res = logMatchPatterns({
      logText: log,
      patterns: [{ id: "errs", pattern: "^Error:", flags: "" }],
    });
    expect(res.countsByPattern.errs).toBe(2);
    expect(res.samplesByPattern.errs.length).toBeGreaterThan(0);
  });
});

describe("workflowParse + pipelineEstimate", () => {
  it("parses jobs and estimates minutes", () => {
    const yaml = `
name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm test
`;
    const model = workflowParse({ workflowYaml: yaml, provider: "github-actions" });
    expect(model.jobs.length).toBe(1);
    const est = pipelineEstimate({ workflowModel: model, runHistory: [{ job: "test", durationSec: 120 }] });
    expect(est.estimate.totalSeconds).toBeGreaterThan(0);
    expect(est.estimate.jobs[0]?.basis).toBe("history");
  });
});

