import { readFile, writeFile } from "node:fs/promises";
import { ask } from "./answer";
import { parseCases, renderReport, runEval } from "./eval";
import { ingestDirectory } from "./ingest";
import { createGeminiEmbedder, createGeminiProvider } from "./providers/gemini";
import { createExtractiveMockProvider, createMockEmbedder } from "./providers/mock";
import { createServer } from "./server";
import { VectorStore } from "./store";
import type { Embedder, Provider } from "./types";

const USAGE = `Usage:
  cli ingest <docs-dir> [--out index.json] [--size 800] [--overlap 120] [--provider mock|gemini]
  cli ask "<question>" [--index index.json] [--min-similarity N] [--provider mock|gemini]
  cli eval [--questions examples/questions.jsonl] [--index index.json] [--report eval-report.md] [--min-similarity N] [--provider mock|gemini]
  cli serve [--index index.json] [--port 8787] [--host 127.0.0.1] [--min-similarity N] [--provider mock|gemini]

--provider defaults to mock (no network, no key). gemini reads GEMINI_API_KEY and is not run live in this repo.`;

function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${a} needs a value.`);
      flags.set(a.slice(2), value);
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function makeBackends(kind: string): { embedder: Embedder; provider: Provider } {
  if (kind === "mock") return { embedder: createMockEmbedder(), provider: createExtractiveMockProvider() };
  if (kind === "gemini") return { embedder: createGeminiEmbedder(), provider: createGeminiProvider() };
  throw new Error(`Unknown --provider "${kind}". Use mock or gemini.`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const backends = makeBackends(flags.get("provider") ?? "mock");
  const indexPath = flags.get("index") ?? "index.json";
  const minSimilarity = flags.has("min-similarity") ? Number(flags.get("min-similarity")) : undefined;
  if (minSimilarity !== undefined && !Number.isFinite(minSimilarity)) {
    throw new Error("--min-similarity must be a number.");
  }
  const askOptions = { minSimilarity };

  const loadStore = async () => {
    const store = await VectorStore.load(indexPath);
    if (store.embedderName !== backends.embedder.name) {
      throw new Error(
        `${indexPath} was built with "${store.embedderName}" but this run uses "${backends.embedder.name}". Re-run ingest with the same --provider.`,
      );
    }
    return store;
  };

  switch (command) {
    case "ingest": {
      const dir = positional[0];
      if (!dir) throw new Error("ingest needs a documents folder.");
      const store = await ingestDirectory(dir, backends.embedder, {
        size: flags.has("size") ? Number(flags.get("size")) : undefined,
        overlap: flags.has("overlap") ? Number(flags.get("overlap")) : undefined,
      });
      const out = flags.get("out") ?? indexPath;
      await store.save(out);
      console.log(`Indexed ${store.size} chunks with ${store.embedderName} into ${out}.`);
      return;
    }
    case "ask": {
      const question = positional.join(" ").trim();
      if (!question) throw new Error("ask needs a question.");
      const store = await loadStore();
      const result = await ask(question, { store, ...backends }, askOptions);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "eval": {
      const store = await loadStore();
      const cases = parseCases(await readFile(flags.get("questions") ?? "examples/questions.jsonl", "utf8"));
      const { results, summary } = await runEval(cases, { store, ...backends }, askOptions);
      const report = renderReport(results, summary, {
        embedder: backends.embedder.name,
        provider: backends.provider.name,
        minSimilarity: minSimilarity ?? backends.embedder.defaultMinSimilarity,
      });
      const reportPath = flags.get("report") ?? "eval-report.md";
      await writeFile(reportPath, report, "utf8");
      console.log(JSON.stringify(summary));
      console.log(`Report written to ${reportPath}.`);
      return;
    }
    case "serve": {
      const store = await loadStore();
      const port = Number(flags.get("port") ?? 8787);
      const host = flags.get("host") ?? "127.0.0.1";
      const server = createServer({ ask: (q) => ask(q, { store, ...backends }, askOptions) });
      server.listen(port, host, () => console.log(`Listening on http://${host}:${port}/ (no auth, no rate limit).`));
      return;
    }
    default:
      console.log(USAGE);
      if (command !== undefined && command !== "help") process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
