import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGeminiEmbedder, createGeminiProvider, GeminiError } from "../src/providers/gemini";
import { ANSWER_SCHEMA } from "../src/answer";

// Fake fetch only. Nothing here talks to Google.

interface Call {
  url: string;
  init: RequestInit;
  body: any;
}

function fakeFetch(respond: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body ?? "null")) };
    calls.push(call);
    return respond(call, calls.length - 1);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const SECRET = "test-key-should-never-appear";
let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
});

describe("createGeminiEmbedder", () => {
  it("sends a batchEmbedContents request per the documented shape, key in a header", async () => {
    const { fn, calls } = fakeFetch((call) =>
      json({ embeddings: call.body.requests.map(() => ({ values: [0.1, 0.2, 0.3] })) }),
    );
    const embedder = createGeminiEmbedder({ apiKey: SECRET, fetch: fn });
    const vectors = await embedder.embed(["first", "second"], "document");

    expect(vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.1, 0.2, 0.3],
    ]);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents");
    expect((call.init.headers as Record<string, string>)["x-goog-api-key"]).toBe(SECRET);
    expect(call.url).not.toContain(SECRET);
    expect(call.body.requests).toEqual([
      {
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: "first" }] },
        embedContentConfig: { taskType: "RETRIEVAL_DOCUMENT" },
      },
      {
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: "second" }] },
        embedContentConfig: { taskType: "RETRIEVAL_DOCUMENT" },
      },
    ]);
  });

  it("uses the query task type for questions", async () => {
    const { fn, calls } = fakeFetch(() => json({ embeddings: [{ values: [1] }] }));
    await createGeminiEmbedder({ apiKey: SECRET, fetch: fn }).embed(["q"], "query");
    expect(calls[0]!.body.requests[0].embedContentConfig.taskType).toBe("RETRIEVAL_QUERY");
  });

  it("splits long inputs into batches and keeps the order", async () => {
    const { fn, calls } = fakeFetch((call) =>
      json({ embeddings: call.body.requests.map((r: any) => ({ values: [Number(r.content.parts[0].text)] })) }),
    );
    const embedder = createGeminiEmbedder({ apiKey: SECRET, fetch: fn, batchSize: 2 });
    const vectors = await embedder.embed(["1", "2", "3", "4", "5"], "document");
    expect(calls).toHaveLength(3);
    expect(vectors).toEqual([[1], [2], [3], [4], [5]]);
  });

  it("rejects a response with the wrong number of embeddings or a malformed vector", async () => {
    const wrongCount = fakeFetch(() => json({ embeddings: [{ values: [1] }] }));
    await expect(createGeminiEmbedder({ apiKey: SECRET, fetch: wrongCount.fn }).embed(["a", "b"], "document")).rejects.toMatchObject({
      kind: "invalid_output",
    });
    const malformed = fakeFetch(() => json({ embeddings: [{ values: ["x"] }] }));
    await expect(createGeminiEmbedder({ apiKey: SECRET, fetch: malformed.fn }).embed(["a"], "document")).rejects.toMatchObject({
      kind: "invalid_output",
    });
  });

  it("fails clearly without a key, and never makes a request", async () => {
    const { fn, calls } = fakeFetch(() => json({}));
    await expect(createGeminiEmbedder({ fetch: fn }).embed(["a"], "query")).rejects.toMatchObject({ kind: "not_configured" });
    expect(calls).toHaveLength(0);
  });

  it("reads the key from GEMINI_API_KEY when none is passed", async () => {
    process.env.GEMINI_API_KEY = SECRET;
    const { fn, calls } = fakeFetch(() => json({ embeddings: [{ values: [1] }] }));
    await createGeminiEmbedder({ fetch: fn }).embed(["a"], "query");
    expect((calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe(SECRET);
  });
});

describe("error handling", () => {
  it.each([
    [429, "rate_limit"],
    [500, "api_error"],
    [403, "api_error"],
  ])("maps HTTP %i to %s and keeps the key out of the message", async (status, kind) => {
    const { fn } = fakeFetch(() => new Response(`denied for ${SECRET}`, { status }));
    const err = await createGeminiEmbedder({ apiKey: SECRET, fetch: fn })
      .embed(["a"], "query")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect((err as GeminiError).kind).toBe(kind);
    expect((err as GeminiError).message).not.toContain(SECRET);
  });

  it("maps a network failure to api_error without the underlying message", async () => {
    const failing = (async () => {
      throw new TypeError(`connect failed for ${SECRET}`);
    }) as unknown as typeof fetch;
    const err = await createGeminiEmbedder({ apiKey: SECRET, fetch: failing })
      .embed(["a"], "query")
      .catch((e: unknown) => e);
    expect((err as GeminiError).kind).toBe("api_error");
    expect((err as GeminiError).message).not.toContain(SECRET);
  });

  it("maps a non-JSON body to invalid_output", async () => {
    const { fn } = fakeFetch(() => new Response("<html>", { status: 200 }));
    await expect(createGeminiEmbedder({ apiKey: SECRET, fetch: fn }).embed(["a"], "query")).rejects.toMatchObject({
      kind: "invalid_output",
    });
  });
});

describe("createGeminiProvider", () => {
  const request = { question: "q", context: [], prompt: "the prompt", schema: ANSWER_SCHEMA };

  it("sends generateContent with the prompt and the JSON schema, and returns the raw text", async () => {
    const reply = '{"answerable":false,"answer":"","citations":[]}';
    const { fn, calls } = fakeFetch(() => json({ candidates: [{ content: { parts: [{ text: reply }] } }] }));
    const out = await createGeminiProvider({ apiKey: SECRET, fetch: fn }).generate(request);

    expect(out).toBe(reply);
    const call = calls[0]!;
    expect(call.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent");
    expect((call.init.headers as Record<string, string>)["x-goog-api-key"]).toBe(SECRET);
    expect(call.body.contents[0].parts[0].text).toBe("the prompt");
    expect(call.body.generationConfig).toEqual({
      responseMimeType: "application/json",
      responseJsonSchema: ANSWER_SCHEMA,
    });
  });

  it("reports an empty candidate list as invalid_output", async () => {
    const { fn } = fakeFetch(() => json({ candidates: [] }));
    await expect(createGeminiProvider({ apiKey: SECRET, fetch: fn }).generate(request)).rejects.toMatchObject({
      kind: "invalid_output",
    });
  });
});
