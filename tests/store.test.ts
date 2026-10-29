import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cosine, StoreError, VectorStore } from "../src/store";

const chunk = (id: string) => ({ id, file: "f.md", start: 0, end: 5, text: id });

describe("cosine", () => {
  it("is 1 for the same direction, 0 for orthogonal, -1 for opposite", () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("is 0 when either vector is all zeros, and throws on a length mismatch", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(() => cosine([1, 2], [1, 2, 3])).toThrow(StoreError);
  });
});

describe("VectorStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "docs-chat-store-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function sample(): VectorStore {
    const s = new VectorStore("test-embedder", 3);
    s.add(chunk("a"), [1, 0, 0]);
    s.add(chunk("b"), [0.9, 0.1, 0]);
    s.add(chunk("c"), [0, 1, 0]);
    s.add(chunk("d"), [0, 0, 1]);
    return s;
  }

  it("ranks by similarity, highest first, and honours k", () => {
    const hits = sample().search([1, 0, 0], 3);
    expect(hits.map((h) => h.id)).toEqual(["a", "b", "c"]);
    expect(hits[0]!.score).toBeCloseTo(1);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(sample().search([1, 0, 0], 0)).toEqual([]);
  });

  it("keeps insertion order for equal scores", () => {
    const s = new VectorStore("e", 2);
    s.add(chunk("first"), [1, 1]);
    s.add(chunk("second"), [1, 1]);
    expect(s.search([1, 1], 2).map((h) => h.id)).toEqual(["first", "second"]);
  });

  it("rejects vectors of the wrong length or with non-finite numbers", () => {
    const s = new VectorStore("e", 2);
    expect(() => s.add(chunk("x"), [1, 2, 3])).toThrow(StoreError);
    expect(() => s.add(chunk("x"), [1, Number.NaN])).toThrow(StoreError);
    expect(() => s.search([1])).toThrow(StoreError);
  });

  it("saves and loads without changing anything", async () => {
    const path = join(dir, "index.json");
    const original = sample();
    await original.save(path);
    const loaded = await VectorStore.load(path);
    expect(loaded.toJSON()).toEqual(original.toJSON());
    expect(loaded.embedderName).toBe("test-embedder");
    expect(loaded.search([0, 1, 0], 1)[0]!.id).toBe("c");
  });

  it("refuses files that are missing, not JSON, or not an index", async () => {
    await expect(VectorStore.load(join(dir, "missing.json"))).rejects.toThrow(/Could not read/);

    const notJson = join(dir, "bad.json");
    await writeFile(notJson, "not json");
    await expect(VectorStore.load(notJson)).rejects.toThrow(/not valid JSON/);

    expect(() => VectorStore.fromJSON({ version: 2 })).toThrow(/version 1/);
    expect(() => VectorStore.fromJSON({ version: 1, embedder: "e", dims: 2, chunks: "x" })).toThrow(/chunks/);
    expect(() =>
      VectorStore.fromJSON({
        version: 1,
        embedder: "e",
        dims: 2,
        chunks: [{ id: "a", file: "f", start: 0, end: 1, text: "t", vector: [1, 2, 3] }],
      }),
    ).toThrow(StoreError);
    expect(() =>
      VectorStore.fromJSON({ version: 1, embedder: "e", dims: 2, chunks: [{ id: "a", vector: [1, 2] }] }),
    ).toThrow(/wrong shape/);
  });
});
