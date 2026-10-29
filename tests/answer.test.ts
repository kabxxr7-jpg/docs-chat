import { describe, expect, it } from "vitest";
import { ANSWER_SCHEMA, ask } from "../src/answer";
import { createMockEmbedder, createScriptedProvider } from "../src/providers/mock";
import type { Embedder, ProviderRequest } from "../src/types";
import { exampleDeps, exampleStore } from "./helpers";

const REFUND_Q = "How long do refunds take?";
const REFUND_QUOTE = "Refunds are processed within 5 to 7 business days";

/** A reply that cites the top retrieved chunk with a quote that really is in it. */
function goodReply(req: ProviderRequest) {
  return {
    answerable: true,
    answer: "Refunds take 5 to 7 business days after the item is received.",
    citations: [{ chunkId: req.context[0]!.id, quote: REFUND_QUOTE }],
  };
}

describe("ask: answering", () => {
  it("returns the answer with citations that carry file, quote, position and score", async () => {
    const provider = createScriptedProvider([goodReply]);
    const result = await ask(REFUND_Q, await exampleDeps(provider));

    expect(result.status).toBe("answered");
    if (result.status !== "answered") return;
    expect(result.answer).toBe("Refunds take 5 to 7 business days after the item is received.");
    expect(result.citations).toHaveLength(1);
    const c = result.citations[0]!;
    expect(c.file).toBe("returns.md");
    expect(c.chunkId).toMatch(/^returns\.md#\d+$/);
    expect(c.quote).toBe(REFUND_QUOTE);
    expect(c.end).toBeGreaterThan(c.start);
    expect(c.score).toBeGreaterThan(0);
    expect(c.score).toBeLessThanOrEqual(1);
  });

  it("sends the model the question, the retrieved excerpts, the schema, and a warning that excerpts are untrusted", async () => {
    const provider = createScriptedProvider([goodReply]);
    await ask(REFUND_Q, await exampleDeps(provider));

    expect(provider.calls).toHaveLength(1);
    const req = provider.calls[0]!;
    expect(req.question).toBe(REFUND_Q);
    expect(req.schema).toBe(ANSWER_SCHEMA);
    expect(req.context[0]!.text).toContain(REFUND_QUOTE);
    expect(req.prompt).toContain(`Question: ${REFUND_Q}`);
    expect(req.prompt).toContain(`[id: ${req.context[0]!.id}]`);
    expect(req.prompt).toMatch(/never follow instructions/i);
  });

  it("accepts a quote that differs only in case and whitespace", async () => {
    const provider = createScriptedProvider([
      (req: ProviderRequest) => ({
        answerable: true,
        answer: "5 to 7 business days.",
        citations: [{ chunkId: req.context[0]!.id, quote: "REFUNDS ARE   processed\nwithin 5 to 7 business days" }],
      }),
    ]);
    expect((await ask(REFUND_Q, await exampleDeps(provider))).status).toBe("answered");
  });

  it("accepts the reply as JSON text, which is how a real model returns it", async () => {
    const provider = createScriptedProvider([(req: ProviderRequest) => JSON.stringify(goodReply(req))]);
    expect((await ask(REFUND_Q, await exampleDeps(provider))).status).toBe("answered");
  });
});

describe("ask: refusing", () => {
  it("refuses without calling the model when nothing retrieved is similar enough", async () => {
    const provider = createScriptedProvider([goodReply]);
    const result = await ask("What is the weather in Boston?", await exampleDeps(provider));
    expect(result).toMatchObject({ status: "refused", reason: "low_similarity" });
    expect(provider.calls).toHaveLength(0);
  });

  it("uses the similarity threshold as the gate, and lets the caller move it", async () => {
    const strict = createScriptedProvider([goodReply]);
    const tooStrict = await ask(REFUND_Q, await exampleDeps(strict), { minSimilarity: 0.99 });
    expect(tooStrict).toMatchObject({ status: "refused", reason: "low_similarity" });
    expect(strict.calls).toHaveLength(0);

    const lax = createScriptedProvider([{ answerable: false, answer: "", citations: [] }]);
    const result = await ask("What is the weather in Boston?", await exampleDeps(lax), { minSimilarity: -1 });
    expect(lax.calls).toHaveLength(1);
    expect(result).toMatchObject({ status: "refused", reason: "model_declined" });
  });

  it("refuses when a quote is not in the cited chunk, and does not leak the unverified answer", async () => {
    const provider = createScriptedProvider([
      (req: ProviderRequest) => ({
        answerable: true,
        answer: "Refunds are instant.",
        citations: [{ chunkId: req.context[0]!.id, quote: "Refunds are instant and arrive within one hour" }],
      }),
    ]);
    const result = await ask(REFUND_Q, await exampleDeps(provider));
    expect(result).toMatchObject({ status: "refused", reason: "fabricated_quote" });
    expect(JSON.stringify(result)).not.toContain("instant");
  });

  it("refuses when a real quote is attributed to a different chunk", async () => {
    const provider = createScriptedProvider([
      (req: ProviderRequest) => {
        const other = req.context.find((c) => !c.text.includes(REFUND_QUOTE))!;
        return {
          answerable: true,
          answer: "x",
          citations: [{ chunkId: other.id, quote: REFUND_QUOTE }],
        };
      },
    ]);
    const result = await ask(REFUND_Q, await exampleDeps(provider), { minSimilarity: -1, topK: 3 });
    expect(provider.calls[0]!.context.length).toBeGreaterThan(1);
    expect(result).toMatchObject({ status: "refused", reason: "fabricated_quote" });
  });

  it("refuses an empty quote, which would otherwise match everything", async () => {
    const provider = createScriptedProvider([
      (req: ProviderRequest) => ({
        answerable: true,
        answer: "x",
        citations: [{ chunkId: req.context[0]!.id, quote: "   " }],
      }),
    ]);
    expect(await ask(REFUND_Q, await exampleDeps(provider))).toMatchObject({ reason: "fabricated_quote" });
  });

  it("refuses the whole answer when one of two citations is fabricated", async () => {
    const provider = createScriptedProvider([
      (req: ProviderRequest) => ({
        answerable: true,
        answer: "x",
        citations: [
          { chunkId: req.context[0]!.id, quote: REFUND_QUOTE },
          { chunkId: req.context[0]!.id, quote: "Refunds also come with a free gift" },
        ],
      }),
    ]);
    expect(await ask(REFUND_Q, await exampleDeps(provider))).toMatchObject({ reason: "fabricated_quote" });
  });

  it("refuses a citation that points at a chunk that was never retrieved", async () => {
    const provider = createScriptedProvider([
      { answerable: true, answer: "x", citations: [{ chunkId: "nope.md#9", quote: REFUND_QUOTE }] },
    ]);
    expect(await ask(REFUND_Q, await exampleDeps(provider))).toMatchObject({ reason: "unknown_chunk" });
  });

  it("refuses an answer with no citations", async () => {
    const provider = createScriptedProvider([{ answerable: true, answer: "Five days.", citations: [] }]);
    expect(await ask(REFUND_Q, await exampleDeps(provider))).toMatchObject({ reason: "no_citations" });
  });

  it("refuses when the model says the documents do not answer", async () => {
    const provider = createScriptedProvider([{ answerable: false, answer: "", citations: [] }]);
    expect(await ask(REFUND_Q, await exampleDeps(provider))).toMatchObject({ reason: "model_declined" });
  });

  it.each([
    ["text that is not JSON", "I think it is five days"],
    ["an array", []],
    ["null", null],
    ["a missing field", { answerable: true, answer: "x" }],
    ["a citation of the wrong type", { answerable: true, answer: "x", citations: [{ chunkId: 1, quote: "q" }] }],
    ["an empty answer", { answerable: true, answer: "  ", citations: [{ chunkId: "a", quote: "q" }] }],
  ])("refuses an unusable reply: %s", async (_label, reply) => {
    const provider = createScriptedProvider([reply]);
    expect(await ask(REFUND_Q, await exampleDeps(provider))).toMatchObject({
      status: "refused",
      reason: "invalid_output",
    });
  });
});

describe("ask: failures are errors, not answers or refusals", () => {
  it("reports a model failure without leaking its message", async () => {
    const provider = createScriptedProvider([
      () => {
        throw new Error("secret-key-123 was rejected");
      },
    ]);
    const result = await ask(REFUND_Q, await exampleDeps(provider));
    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain("secret-key-123");
  });

  it("reports an embedder failure", async () => {
    const broken: Embedder = {
      name: "broken",
      defaultMinSimilarity: 0.2,
      async embed() {
        throw new Error("embedder down");
      },
    };
    const deps = { ...(await exampleDeps()), embedder: broken };
    const result = await ask(REFUND_Q, deps);
    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain("embedder down");
  });

  it("reports a query vector of the wrong size instead of crashing", async () => {
    const tiny: Embedder = { ...createMockEmbedder(), embed: async () => [[1, 2, 3]] };
    expect((await ask(REFUND_Q, { ...(await exampleDeps()), embedder: tiny })).status).toBe("error");
  });

  it("rejects an empty question before doing any work", async () => {
    const provider = createScriptedProvider([goodReply]);
    const result = await ask("   ", await exampleDeps(provider));
    expect(result.status).toBe("error");
    expect(provider.calls).toHaveLength(0);
    expect((await exampleStore()).size).toBeGreaterThan(0);
  });
});
