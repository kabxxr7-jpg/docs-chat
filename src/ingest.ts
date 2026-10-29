import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { chunkText, type ChunkOptions } from "./chunk";
import { VectorStore } from "./store";
import type { Chunk, Embedder } from "./types";

const DOC_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else if (entry.isFile() && DOC_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

export interface IngestOptions extends ChunkOptions {
  /** Chunks embedded per call. Default 32. */
  batchSize?: number;
}

/** Reads every .md, .markdown and .txt file under `dir` (sorted, so the result is deterministic) and embeds it. */
export async function ingestDirectory(dir: string, embedder: Embedder, options: IngestOptions = {}): Promise<VectorStore> {
  const files = (await listFiles(dir)).sort();
  const chunks: Chunk[] = [];
  for (const path of files) {
    const name = relative(dir, path).split(sep).join("/");
    chunks.push(...chunkText(await readFile(path, "utf8"), name, options));
  }
  if (chunks.length === 0) throw new Error(`No .md, .markdown or .txt content found under ${dir}.`);

  const batchSize = options.batchSize ?? 32;
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const result = await embedder.embed(
      batch.map((c) => c.text),
      "document",
    );
    if (result.length !== batch.length) throw new Error("The embedder returned the wrong number of vectors.");
    vectors.push(...result);
  }

  const dims = vectors[0]?.length ?? 0;
  const store = new VectorStore(embedder.name, dims);
  chunks.forEach((chunk, i) => store.add(chunk, vectors[i] as number[]));
  return store;
}
