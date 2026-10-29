import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROOT } from "./helpers";

const run = promisify(execFile);
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

async function cli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [TSX, "src/cli.ts", ...args], { cwd: ROOT, timeout: 60_000 });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

describe("command line", () => {
  let dir: string;
  let index: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "docs-chat-cli-"));
    index = join(dir, "index.json");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("ingests the sample files into an index", async () => {
    const out = await cli(["ingest", "examples/kb", "--out", index, "--size", "400", "--overlap", "60"]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("Indexed 13 chunks with mock-bow-512");
  }, 60_000);

  it("answers a question from that index with a citation", async () => {
    const out = await cli(["ask", "How long do refunds take?", "--index", index]);
    expect(out.code).toBe(0);
    const result = JSON.parse(out.stdout);
    expect(result.status).toBe("answered");
    expect(result.citations[0].file).toBe("returns.md");
  }, 60_000);

  it("runs the example evaluation and reports the numbers I checked by hand", async () => {
    // Stand-in model, 15 questions. Wrongly refused: "return-window" (the file says "return policy", never
    // "window") and "ship-germany" (the file never names Germany; the stand-in cannot reason from "only US and Canada").
    const report = join(dir, "report.md");
    const out = await cli(["eval", "--index", index, "--questions", "examples/questions.jsonl", "--report", report]);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout.split("\n")[0]!)).toEqual({
      total: 15,
      answeredCorrectly: 8,
      refusedCorrectly: 5,
      wronglyRefused: 2,
      wronglyAnswered: 0,
      wrongSource: 0,
      errors: 0,
    });
    const text = await readFile(report, "utf8");
    expect(text).toContain("stand-in");
    expect(text).toMatch(/\| return-window \|.*wrongly refused/);
    expect(text).toMatch(/\| ship-germany \|.*wrongly refused/);
  }, 60_000);

  it("lets the caller move the similarity cut-off", async () => {
    const strict = await cli(["ask", "How long do refunds take?", "--index", index, "--min-similarity", "0.99"]);
    expect(JSON.parse(strict.stdout)).toMatchObject({ status: "refused", reason: "low_similarity" });
    const lax = await cli(["ask", "What is the weather in Boston?", "--index", index, "--min-similarity", "-1"]);
    expect(JSON.parse(lax.stdout)).toMatchObject({ status: "refused", reason: "model_declined" });
    const bad = await cli(["ask", "hi", "--index", index, "--min-similarity", "abc"]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("--min-similarity must be a number");
  }, 60_000);

  it("refuses to use an index built with a different embedder", async () => {
    const out = await cli(["ask", "How long do refunds take?", "--index", index, "--provider", "gemini"]);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("Re-run ingest with the same --provider");
  }, 60_000);

  it("prints usage and exits 1 for an unknown command", async () => {
    const out = await cli(["frobnicate"]);
    expect(out.code).toBe(1);
    expect(out.stdout).toContain("Usage:");
  }, 60_000);

  it("rejects an unknown provider", async () => {
    const out = await cli(["ask", "hi", "--provider", "other"]);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('Unknown --provider "other"');
  }, 60_000);
});
