import type { Embedder, EmbedKind, Provider, ProviderRequest } from "../types";

// Adapters written against Google's documented REST API. NOT run against the live service in this
// build: the request shapes are covered by tests with a fake fetch, and the field names come from
// https://ai.google.dev/api/embeddings and the generateContent shape used by opsflow's lib/ai.ts.
// The API key goes in the x-goog-api-key header, is read when the first call is made, and is never
// logged or put in an error message.

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GENERATION_MODEL = "gemini-flash-lite-latest";
export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly kind: "not_configured" | "rate_limit" | "api_error" | "invalid_output",
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

interface CommonOptions {
  /** Defaults to the GEMINI_API_KEY environment variable. */
  apiKey?: string;
  baseUrl?: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

async function post(options: CommonOptions, path: string, body: unknown): Promise<unknown> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set.", "not_configured");
  const doFetch = options.fetch ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`${options.baseUrl ?? DEFAULT_BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.name : "unknown error";
    throw new GeminiError(`Gemini request failed (${reason}).`, "api_error");
  }
  if (!response.ok) {
    if (response.status === 429) throw new GeminiError("Gemini is rate-limited right now.", "rate_limit");
    throw new GeminiError(`Gemini API error (${response.status}).`, "api_error");
  }
  try {
    return await response.json();
  } catch {
    throw new GeminiError("Gemini returned a body that was not JSON.", "invalid_output");
  }
}

export interface GeminiProviderOptions extends CommonOptions {
  model?: string;
}

export function createGeminiProvider(options: GeminiProviderOptions = {}): Provider {
  const model = options.model ?? DEFAULT_GENERATION_MODEL;
  return {
    name: `gemini (${model})`,
    async generate(request: ProviderRequest): Promise<unknown> {
      const body = await post(options, `/models/${encodeURIComponent(model)}:generateContent`, {
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: request.schema },
      });
      const parts = (body as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | null)
        ?.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts) ? parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("") : "";
      if (!text) throw new GeminiError("Gemini did not return any output.", "invalid_output");
      // Raw text: `ask` parses it and treats bad JSON like any other unusable reply.
      return text;
    },
  };
}

export interface GeminiEmbedderOptions extends CommonOptions {
  model?: string;
  /** Texts per batchEmbedContents call. The docs page does not state a limit; 50 is a cautious guess. */
  batchSize?: number;
  /**
   * Similarity cut-off for "not in the documents". 0.55 is an UNTUNED starting point: tune it on the
   * client's own documents and questions before trusting refusals.
   */
  defaultMinSimilarity?: number;
}

export function createGeminiEmbedder(options: GeminiEmbedderOptions = {}): Embedder {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const batchSize = options.batchSize ?? 50;
  return {
    name: `gemini-${model}`,
    defaultMinSimilarity: options.defaultMinSimilarity ?? 0.55,
    async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
      const taskType = kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const body = await post(options, `/models/${encodeURIComponent(model)}:batchEmbedContents`, {
          requests: batch.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            embedContentConfig: { taskType },
          })),
        });
        const embeddings = (body as { embeddings?: { values?: unknown }[] } | null)?.embeddings;
        if (!Array.isArray(embeddings) || embeddings.length !== batch.length) {
          throw new GeminiError("Gemini returned the wrong number of embeddings.", "invalid_output");
        }
        for (const e of embeddings) {
          const values = e?.values;
          if (!Array.isArray(values) || values.length === 0 || !values.every((n) => typeof n === "number")) {
            throw new GeminiError("Gemini returned an embedding in an unexpected shape.", "invalid_output");
          }
          out.push(values as number[]);
        }
      }
      return out;
    },
  };
}
