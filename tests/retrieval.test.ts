import { describe, expect, it } from "vitest";
import { createMockEmbedder } from "../src/providers/mock";
import { exampleStore } from "./helpers";

const embedder = createMockEmbedder();

async function top(question: string, k = 3) {
  const [vector] = await embedder.embed([question], "query");
  return (await exampleStore()).search(vector!, k);
}

describe("mock embedder", () => {
  it("is deterministic and returns unit-length vectors", async () => {
    const [a] = await embedder.embed(["How long do refunds take?"], "query");
    const [b] = await embedder.embed(["How long do refunds take?"], "document");
    expect(a).toEqual(b);
    expect(Math.hypot(...a!)).toBeCloseTo(1);
  });

  it("returns a zero vector for text with no content words", async () => {
    const [v] = await embedder.embed(["the and of"], "query");
    expect(v!.every((n) => n === 0)).toBe(true);
  });
});

describe("retrieval over the sample knowledge base", () => {
  it("ranks the refunds passage first for a refunds question", async () => {
    const hits = await top("How long do refunds take?");
    expect(hits[0]!.file).toBe("returns.md");
    expect(hits[0]!.text).toContain("Refunds are processed within 5 to 7 business days");
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it("ranks the shipping file first for a shipping-cost question", async () => {
    const hits = await top("Is shipping free over $50?");
    expect(hits[0]!.file).toBe("shipping.md");
    expect(hits[0]!.text).toContain("ship free");
  });

  it("ranks the accounts file first for a password question", async () => {
    const hits = await top("How do I reset my password?");
    expect(hits[0]!.file).toBe("accounts.md");
  });

  it("scores an in-scope question above the embedder's cut-off and an off-topic one below it", async () => {
    const inScope = await top("How long do refunds take?", 1);
    const offTopic = await top("What is the weather in Boston?", 1);
    expect(inScope[0]!.score).toBeGreaterThanOrEqual(embedder.defaultMinSimilarity);
    expect(offTopic[0]!.score).toBeLessThan(embedder.defaultMinSimilarity);
  });
});
