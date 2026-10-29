import { readFile, writeFile } from "node:fs/promises";
import type { Chunk, ScoredChunk, StoredChunk } from "./types";

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new StoreError(`Vector length mismatch: ${a.length} vs ${b.length}.`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface StoreFile {
  version: 1;
  embedder: string;
  dims: number;
  chunks: StoredChunk[];
}

/** In-memory vector store with brute-force cosine search. Fine for hundreds of chunks, not for millions. */
export class VectorStore {
  private readonly items: StoredChunk[] = [];

  constructor(
    readonly embedderName: string,
    readonly dims: number,
  ) {
    if (!Number.isInteger(dims) || dims < 1) throw new StoreError("dims must be a positive integer.");
  }

  get size(): number {
    return this.items.length;
  }

  add(chunk: Chunk, vector: number[]): void {
    this.assertVector(vector);
    this.items.push({ ...chunk, vector });
  }

  /** Highest score first; equal scores keep insertion order. */
  search(query: number[], k = 4): ScoredChunk[] {
    this.assertVector(query);
    return this.items
      .map((item, order) => ({ item, order, score: cosine(query, item.vector) }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, Math.max(0, k))
      .map(({ item, score }) => ({ ...item, score }));
  }

  toJSON(): StoreFile {
    return { version: 1, embedder: this.embedderName, dims: this.dims, chunks: this.items };
  }

  static fromJSON(data: unknown): VectorStore {
    if (!isRecord(data) || data.version !== 1) throw new StoreError("Not a docs-chat index (version 1).");
    const { embedder, dims, chunks } = data;
    if (typeof embedder !== "string" || embedder === "") throw new StoreError("Index has no embedder name.");
    if (typeof dims !== "number" || !Number.isInteger(dims) || dims < 1) {
      throw new StoreError("Index has an invalid dims value.");
    }
    if (!Array.isArray(chunks)) throw new StoreError("Index has no chunks array.");

    const store = new VectorStore(embedder, dims);
    for (const [i, c] of chunks.entries()) {
      if (!isRecord(c)) throw new StoreError(`Chunk ${i} is not an object.`);
      const { id, file, start, end, text, vector } = c;
      if (
        typeof id !== "string" ||
        typeof file !== "string" ||
        typeof text !== "string" ||
        typeof start !== "number" ||
        typeof end !== "number" ||
        !Array.isArray(vector) ||
        !vector.every((n) => typeof n === "number")
      ) {
        throw new StoreError(`Chunk ${i} has the wrong shape.`);
      }
      store.add({ id, file, start, end, text }, vector as number[]);
    }
    return store;
  }

  async save(path: string): Promise<void> {
    await writeFile(path, JSON.stringify(this.toJSON()), "utf8");
  }

  static async load(path: string): Promise<VectorStore> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      throw new StoreError(`Could not read the index file at ${path}.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new StoreError(`The index file at ${path} is not valid JSON.`);
    }
    return VectorStore.fromJSON(parsed);
  }

  private assertVector(v: number[]): void {
    if (v.length !== this.dims) {
      throw new StoreError(`Expected a vector of length ${this.dims}, got ${v.length}.`);
    }
    if (!v.every((n) => Number.isFinite(n))) throw new StoreError("Vector contains a non-finite number.");
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
