import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AskDeps } from "../src/answer";
import { ingestDirectory } from "../src/ingest";
import { createExtractiveMockProvider, createMockEmbedder } from "../src/providers/mock";
import type { VectorStore } from "../src/store";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const KB_DIR = join(ROOT, "examples", "kb");

/** The chunk settings the README uses for the sample knowledge base. */
export const EXAMPLE_CHUNKING = { size: 400, overlap: 60 };

let cached: Promise<VectorStore> | undefined;

/** The three fictional sample files, embedded once with the mock embedder. Read-only. */
export function exampleStore(): Promise<VectorStore> {
  cached ??= ingestDirectory(KB_DIR, createMockEmbedder(), EXAMPLE_CHUNKING);
  return cached;
}

export async function exampleDeps(provider = createExtractiveMockProvider()): Promise<AskDeps> {
  return { store: await exampleStore(), embedder: createMockEmbedder(), provider };
}
