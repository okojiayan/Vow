import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkOutdirCompatibility,
  classifyProvenanceTier,
  provenanceMetrics,
  stampRunIdentity,
} from "./bench-protocol";

const MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

describe("provenance tiers: heuristic fallback can never count as model-backed", () => {
  it("verified provider-backed task success is model-backed", () => {
    expect(
      classifyProvenanceTier({ pass: true, ok: true, plannerPath: "provider-analysis", model: MODEL, expectedModel: MODEL }),
    ).toBe("model-backed");
    expect(
      classifyProvenanceTier({ pass: true, ok: true, plannerPath: "mixed", model: MODEL, expectedModel: MODEL }),
    ).toBe("model-backed");
  });

  it("heuristic fallback satisfying output checks is fallback-unproven", () => {
    expect(
      classifyProvenanceTier({ pass: true, ok: true, plannerPath: "heuristic-fallback", model: "heuristic-demo" }),
    ).toBe("fallback-unproven");
    // Even with a passing grade, heuristic-demo model can never be model-backed.
    expect(
      classifyProvenanceTier({ pass: true, ok: true, plannerPath: "provider-analysis", model: "heuristic-demo", expectedModel: MODEL }),
    ).toBe("fallback-unproven");
  });

  it("deterministic-tool and tool-grounded passes are labeled accurately, not as inference", () => {
    expect(classifyProvenanceTier({ pass: true, ok: true, plannerPath: "deterministic-tool", model: null })).toBe(
      "deterministic-tool",
    );
    expect(classifyProvenanceTier({ pass: true, ok: true, plannerPath: "tool-grounded", model: null })).toBe(
      "tool-grounded",
    );
  });

  it("missing, malformed, and unknown provenance fail closed", () => {
    expect(classifyProvenanceTier({ pass: true, ok: true })).toBe("fallback-unproven");
    expect(classifyProvenanceTier({ pass: true, ok: true, plannerPath: 42, model: MODEL })).toBe("fallback-unproven");
    expect(classifyProvenanceTier({ pass: true, ok: true, plannerPath: "future-path", model: MODEL })).toBe(
      "fallback-unproven",
    );
    expect(classifyProvenanceTier({ pass: true, ok: true, plannerPath: "provider-analysis", model: "" })).toBe(
      "fallback-unproven",
    );
    expect(
      classifyProvenanceTier({ pass: true, ok: true, plannerPath: "mixed", model: "other-model", expectedModel: MODEL }),
    ).toBe("fallback-unproven");
  });

  it("failed verification despite provider execution is failed, not a pass", () => {
    expect(
      classifyProvenanceTier({ pass: false, ok: true, plannerPath: "provider-analysis", model: MODEL }),
    ).toBe("failed");
    expect(classifyProvenanceTier({ pass: false, ok: false, plannerPath: "not-invoked" })).toBe("not-executed");
  });

  it("never-executed runs are not-executed", () => {
    expect(classifyProvenanceTier({ pass: false, ok: false, plannerPath: "not-invoked" })).toBe("not-executed");
  });

  it("refusal passes do not inflate task-completion metrics", () => {
    expect(classifyProvenanceTier({ pass: true, ok: true, plannerPath: "mixed", model: MODEL, refusalCase: true })).toBe(
      "refusal",
    );
    const m = provenanceMetrics(
      [
        { pass: true, ok: true, plannerPath: "mixed", model: MODEL, refusalCase: true },
        { pass: true, ok: true, plannerPath: "mixed", model: MODEL, refusalCase: false },
      ],
      { expectedModel: MODEL },
    );
    expect(m.refusalPass).toBe(1);
    expect(m.taskPass).toBe(1);
    expect(m.modelBackedPass).toBe(1);
  });
});

describe("provenance metrics: denominators and coverage", () => {
  it("reports attempted, eligible, coverage, and both rates", () => {
    const m = provenanceMetrics(
      [
        { pass: true, ok: true, plannerPath: "mixed", model: MODEL },
        { pass: true, ok: true, plannerPath: "heuristic-fallback", model: "heuristic-demo" },
        { pass: false, ok: false, plannerPath: "not-invoked" },
        { pass: false, ok: true, plannerPath: "mixed", model: MODEL },
      ],
      { expectedModel: MODEL },
    );
    expect(m.attempted).toBe(4);
    expect(m.eligible).toBe(3);
    expect(m.coveragePct).toBe(75);
    expect(m.modelBackedPass).toBe(1);
    expect(m.modelBackedRatePct).toBe(25);
    expect(m.modelBackedEligibleRatePct).toBe(33.3);
    expect(m.taskPass).toBe(1);
    expect(m.fallbackUnprovenPass).toBe(1);
    expect(m.notExecuted).toBe(1);
    expect(m.failed).toBe(1);
  });

  it("eligible-only rate is null with zero eligible and coverage is zero", () => {
    const m = provenanceMetrics([{ pass: false, ok: false, plannerPath: "not-invoked" }]);
    expect(m.eligible).toBe(0);
    expect(m.coveragePct).toBe(0);
    expect(m.modelBackedEligibleRatePct).toBeNull();
    expect(m.modelBackedRatePct).toBe(0);
  });
});

describe("output isolation: unique runs, no silent overwrites", () => {
  const fsDeps = { existsSync, readFileSync: (p: string, enc: "utf8") => readFileSync(p, enc) };

  it("fresh directory is fresh; stamp creates identity; resume is compatible", () => {
    const dir = mkdtempSync(join(tmpdir(), "vow-outdir-"));
    expect(checkOutdirCompatibility(dir, "1.0.0", fsDeps).status).toBe("fresh");
    const id1 = stampRunIdentity(
      dir,
      { manifestVersion: "1.0.0", batchIndex: 0, batchSize: 100, runId: "run-x" },
      { existsSync, readFileSync: (p: string, enc: "utf8") => readFileSync(p, enc), writeFileSync, mkdirSync },
    );
    expect(id1.runId).toBe("run-x");
    // run.json alone does not make the dir "populated"; still fresh until artifacts exist.
    expect(checkOutdirCompatibility(dir, "1.0.0", fsDeps).status).toBe("fresh");
    writeFileSync(join(dir, "runs_A.json"), "[]");
    writeFileSync(join(dir, "aggregate.json"), JSON.stringify({ manifestVersion: "1.0.0" }));
    const compat = checkOutdirCompatibility(dir, "1.0.0", fsDeps);
    expect(compat.status).toBe("compatible-resume");
    expect(compat.priorRunId).toBe("run-x");
    // Resume keeps the original runId and appends the new batch.
    const id2 = stampRunIdentity(
      dir,
      { manifestVersion: "1.0.0", batchIndex: 1, batchSize: 50, runId: "run-y" },
      { existsSync, readFileSync: (p: string, enc: "utf8") => readFileSync(p, enc), writeFileSync, mkdirSync },
    );
    expect(id2.runId).toBe("run-x");
    expect(id2.batches.length).toBe(2);
  });

  it("different manifest refuses; unreadable prior fails closed", () => {
    const dir = mkdtempSync(join(tmpdir(), "vow-outdir-"));
    writeFileSync(join(dir, "runs_A.json"), "[]");
    writeFileSync(join(dir, "aggregate.json"), JSON.stringify({ manifestVersion: "9.9.9" }));
    expect(checkOutdirCompatibility(dir, "1.0.0", fsDeps).status).toBe("manifest-mismatch");
    expect(() =>
      stampRunIdentity(
        dir,
        { manifestVersion: "1.0.0", batchIndex: 0, batchSize: 100, runId: "run-z" },
        { existsSync, readFileSync: (p: string, enc: "utf8") => readFileSync(p, enc), writeFileSync, mkdirSync },
      ),
    ).toThrow(/different manifest|fresh output directory/i);

    const dir2 = mkdtempSync(join(tmpdir(), "vow-outdir-"));
    writeFileSync(join(dir2, "results.csv"), "runId,caseId\n");
    expect(checkOutdirCompatibility(dir2, "1.0.0", fsDeps).status).toBe("ambiguous-prior");
  });

  it("case records, manifest, and aggregate stay associated per run", () => {
    const dir = mkdtempSync(join(tmpdir(), "vow-outdir-"));
    const id = stampRunIdentity(
      dir,
      { manifestVersion: "2.0.0", batchIndex: 0, batchSize: 3, runId: "run-link" },
      { existsSync, readFileSync: (p: string, enc: "utf8") => readFileSync(p, enc), writeFileSync, mkdirSync },
    );
    writeFileSync(join(dir, "runs_A.json"), JSON.stringify([{ runId: "A-X", caseId: "X", mode: "A", ok: true }]));
    writeFileSync(join(dir, "aggregate.json"), JSON.stringify({ manifestVersion: "2.0.0", runId: id.runId }));
    const compat = checkOutdirCompatibility(dir, "2.0.0", fsDeps);
    expect(compat.status).toBe("compatible-resume");
    expect(compat.priorManifestVersion).toBe("2.0.0");
    expect(compat.priorRunId).toBe("run-link");
    expect(compat.artifactFiles.sort()).toEqual(["aggregate.json", "runs_A.json"]);
  });
});
