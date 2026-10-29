import { describe, expect, it } from "vitest";
import { classify, parseCases, renderReport, runEval, type EvalCase } from "../src/eval";
import { createExtractiveMockProvider } from "../src/providers/mock";
import type { AskResult, Provider } from "../src/types";
import { exampleDeps } from "./helpers";

const answered = (file: string): AskResult => ({
  status: "answered",
  answer: "x",
  citations: [{ chunkId: `${file}#0`, file, quote: "q", start: 0, end: 1, score: 0.5 }],
});
const refused: AskResult = { status: "refused", reason: "low_similarity", message: "m" };

describe("classify", () => {
  const wantAnswer: EvalCase = { id: "a", question: "q", expect: "answer", source: "returns.md" };
  const wantRefusal: EvalCase = { id: "b", question: "q", expect: "refuse" };

  it("covers every outcome", () => {
    expect(classify(wantAnswer, answered("returns.md"))).toBe("answered_correctly");
    expect(classify(wantAnswer, answered("shipping.md"))).toBe("wrong_source");
    expect(classify(wantAnswer, refused)).toBe("wrongly_refused");
    expect(classify(wantRefusal, refused)).toBe("refused_correctly");
    expect(classify(wantRefusal, answered("returns.md"))).toBe("wrongly_answered");
    expect(classify(wantAnswer, { status: "error", message: "m" })).toBe("error");
  });

  it("accepts any file when no source is expected", () => {
    expect(classify({ id: "c", question: "q", expect: "answer" }, answered("anything.md"))).toBe("answered_correctly");
  });

  it("accepts an answer that cites the expected file among several", () => {
    const both: AskResult = {
      status: "answered",
      answer: "x",
      citations: [
        { chunkId: "a#0", file: "shipping.md", quote: "q", start: 0, end: 1, score: 0.5 },
        { chunkId: "b#0", file: "returns.md", quote: "q", start: 0, end: 1, score: 0.4 },
      ],
    };
    expect(classify(wantAnswer, both)).toBe("answered_correctly");
  });
});

describe("runEval metrics", () => {
  it("counts a hand-checked mixture of six cases", async () => {
    const extractive = createExtractiveMockProvider();
    const flaky: Provider = {
      name: "mock-flaky",
      async generate(req) {
        if (req.question.includes("boom")) throw new Error("model down");
        return extractive.generate(req);
      },
    };
    const cases: EvalCase[] = [
      { id: "right-answer", question: "How long do refunds take?", expect: "answer", source: "returns.md" },
      { id: "right-refusal", question: "What is the weather in Boston?", expect: "refuse" },
      { id: "wrong-refusal", question: "Do you ship to Germany?", expect: "answer", source: "shipping.md" },
      { id: "wrong-answer", question: "How long do refunds take?", expect: "refuse" },
      { id: "wrong-file", question: "How long do refunds take?", expect: "answer", source: "shipping.md" },
      { id: "model-error", question: "How long do refunds take? boom", expect: "answer", source: "returns.md" },
    ];

    const { results, summary } = await runEval(cases, await exampleDeps(flaky));

    expect(results.map((r) => r.outcome)).toEqual([
      "answered_correctly",
      "refused_correctly",
      "wrongly_refused",
      "wrongly_answered",
      "wrong_source",
      "error",
    ]);
    expect(summary).toEqual({
      total: 6,
      answeredCorrectly: 1,
      refusedCorrectly: 1,
      wronglyRefused: 1,
      wronglyAnswered: 1,
      wrongSource: 1,
      errors: 1,
    });
  });
});

describe("parseCases", () => {
  it("reads JSONL and skips blank lines", () => {
    const cases = parseCases(
      '{"id":"a","question":"Q1?","expect":"answer","source":"x.md"}\n\n{"id":"b","question":"Q2?","expect":"refuse"}\n',
    );
    expect(cases).toEqual([
      { id: "a", question: "Q1?", expect: "answer", source: "x.md" },
      { id: "b", question: "Q2?", expect: "refuse", source: undefined },
    ]);
  });

  it("names the line of the first bad entry", () => {
    expect(() => parseCases('{"id":"a","question":"q","expect":"answer"}\nnot json')).toThrow(/Line 2 is not valid JSON/);
    expect(() => parseCases('{"id":"a","question":"q","expect":"maybe"}')).toThrow(/Line 1 needs/);
    expect(() => parseCases('{"id":"a","expect":"answer"}')).toThrow(/Line 1 needs/);
    expect(() =>
      parseCases('{"id":"a","question":"q","expect":"answer"}\n{"id":"a","question":"r","expect":"refuse"}'),
    ).toThrow(/Line 2 repeats the id "a"/);
  });
});

describe("renderReport", () => {
  const summary = {
    total: 6,
    answeredCorrectly: 1,
    refusedCorrectly: 1,
    wronglyRefused: 1,
    wronglyAnswered: 1,
    wrongSource: 1,
    errors: 1,
  };

  it("includes every count, one row per case, and says when the model is a stand-in", () => {
    const cases: EvalCase[] = [{ id: "a|b", question: "Q | with pipe", expect: "refuse" }];
    const report = renderReport(
      [{ case: cases[0]!, outcome: "refused_correctly", result: refused }],
      summary,
      { embedder: "mock-bow-512", provider: "mock-extractive", minSimilarity: 0.2 },
    );
    expect(report).toContain("| Cases | 6 |");
    expect(report).toContain("| Wrongly refused (should have answered) | 1 |");
    expect(report).toContain("| Wrongly answered (should have refused) | 1 |");
    expect(report).toContain("a\\|b");
    expect(report).toContain("Q \\| with pipe");
    expect(report).toContain("stand-in");
    expect(report).toContain("refused (low_similarity)");
  });

  it("does not call a real model a stand-in", () => {
    const report = renderReport([], summary, { embedder: "e", provider: "gemini (x)", minSimilarity: 0.55 });
    expect(report).not.toContain("stand-in");
    expect(report).toContain("not a benchmark");
  });
});
