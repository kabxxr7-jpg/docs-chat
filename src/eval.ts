import { ask, type AskDeps, type AskOptions } from "./answer";
import type { AskResult } from "./types";

export interface EvalCase {
  id: string;
  question: string;
  expect: "answer" | "refuse";
  /** For expect "answer": the file the answer should cite. */
  source?: string;
}

export type CaseOutcome =
  | "answered_correctly"
  | "refused_correctly"
  | "wrongly_refused"
  | "wrongly_answered"
  | "wrong_source"
  | "error";

export interface CaseResult {
  case: EvalCase;
  outcome: CaseOutcome;
  result: AskResult;
}

export interface EvalSummary {
  total: number;
  answeredCorrectly: number;
  refusedCorrectly: number;
  wronglyRefused: number;
  /** Expected a refusal, got an answer. */
  wronglyAnswered: number;
  /** Expected an answer from one file, got an answer citing a different one. */
  wrongSource: number;
  errors: number;
}

export function parseCases(jsonl: string): EvalCase[] {
  const cases: EvalCase[] = [];
  const ids = new Set<string>();
  jsonl.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`Line ${i + 1} is not valid JSON.`);
    }
    const v = value as Record<string, unknown> | null;
    if (
      !v ||
      typeof v.id !== "string" ||
      typeof v.question !== "string" ||
      (v.expect !== "answer" && v.expect !== "refuse") ||
      (v.source !== undefined && typeof v.source !== "string")
    ) {
      throw new Error(`Line ${i + 1} needs "id", "question" and "expect" ("answer" or "refuse").`);
    }
    if (ids.has(v.id)) throw new Error(`Line ${i + 1} repeats the id "${v.id}".`);
    ids.add(v.id);
    cases.push({ id: v.id, question: v.question, expect: v.expect, source: v.source as string | undefined });
  });
  return cases;
}

export function classify(c: EvalCase, result: AskResult): CaseOutcome {
  if (result.status === "error") return "error";
  if (c.expect === "refuse") return result.status === "refused" ? "refused_correctly" : "wrongly_answered";
  if (result.status === "refused") return "wrongly_refused";
  if (c.source !== undefined && !result.citations.some((cit) => cit.file === c.source)) return "wrong_source";
  return "answered_correctly";
}

export async function runEval(
  cases: EvalCase[],
  deps: AskDeps,
  options: AskOptions = {},
): Promise<{ results: CaseResult[]; summary: EvalSummary }> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const result = await ask(c.question, deps, options);
    results.push({ case: c, outcome: classify(c, result), result });
  }
  const count = (o: CaseOutcome) => results.filter((r) => r.outcome === o).length;
  return {
    results,
    summary: {
      total: results.length,
      answeredCorrectly: count("answered_correctly"),
      refusedCorrectly: count("refused_correctly"),
      wronglyRefused: count("wrongly_refused"),
      wronglyAnswered: count("wrongly_answered"),
      wrongSource: count("wrong_source"),
      errors: count("error"),
    },
  };
}

export function renderReport(
  results: CaseResult[],
  summary: EvalSummary,
  info: { embedder: string; provider: string; minSimilarity: number },
): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const detail = (r: CaseResult): string =>
    r.result.status === "answered"
      ? `answered, cited ${[...new Set(r.result.citations.map((c) => c.file))].join(", ")}`
      : r.result.status === "refused"
        ? `refused (${r.result.reason})`
        : "error";
  const lines = [
    "# docs-chat evaluation",
    "",
    `Embedder: ${info.embedder}. Model: ${info.provider}. Minimum similarity: ${info.minSimilarity}.`,
    info.provider.startsWith("mock")
      ? "The model here is a stand-in that copies the best-matching sentence. These numbers describe the pipeline around it, not a real model."
      : "Numbers come from one run on the questions file; they are not a benchmark.",
    "",
    "| Result | Count |",
    "|---|---|",
    `| Cases | ${summary.total} |`,
    `| Answered correctly | ${summary.answeredCorrectly} |`,
    `| Refused correctly | ${summary.refusedCorrectly} |`,
    `| Wrongly refused (should have answered) | ${summary.wronglyRefused} |`,
    `| Wrongly answered (should have refused) | ${summary.wronglyAnswered} |`,
    `| Answered from the wrong file | ${summary.wrongSource} |`,
    `| Errors | ${summary.errors} |`,
    "",
    "| Id | Question | Expected | Outcome | Detail |",
    "|---|---|---|---|---|",
    ...results.map(
      (r) =>
        `| ${cell(r.case.id)} | ${cell(r.case.question)} | ${r.case.expect}${r.case.source ? ` (${r.case.source})` : ""} | ${r.outcome.replace(/_/g, " ")} | ${cell(detail(r))} |`,
    ),
    "",
  ];
  return lines.join("\n");
}
