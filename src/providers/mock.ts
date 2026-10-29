import type { Embedder, EmbedKind, Provider, ProviderRequest } from "../types";

// Test doubles. Nothing here calls a network. The embedder is a hashed bag of words and the
// "model" simply copies the best-matching sentence out of the retrieved excerpts, so the pipeline
// around them (retrieval, citation check, refusals) is what gets exercised. Neither says anything
// about how a real embedding model or LLM would behave.

const STOPWORDS = new Set(
  (
    "a an and are as at be but by can do does for from has have how i if in is it its me my of on or " +
    "our so than that the their there these they this to us was we were what when where which who whom " +
    "why will with you your should would could about into over under up out any some"
  ).split(" "),
);

/** Lowercased content words, lightly stemmed so "refunds" and "refund" meet. */
export function contentStems(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 5 && word.endsWith("ing")) {
    const base = word.slice(0, -3);
    return /([^aeiou])\1$/.test(base) ? base.slice(0, -1) : base; // shipping -> ship
  }
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const MOCK_DIMS = 512;

export function createMockEmbedder(options: { defaultMinSimilarity?: number } = {}): Embedder {
  return {
    name: `mock-bow-${MOCK_DIMS}`,
    defaultMinSimilarity: options.defaultMinSimilarity ?? 0.2,
    async embed(texts: string[], _kind: EmbedKind): Promise<number[][]> {
      return texts.map((t) => embedOne(t));
    },
  };
}

function embedOne(text: string): number[] {
  const v = new Array<number>(MOCK_DIMS).fill(0);
  const counts = new Map<string, number>();
  for (const s of contentStems(text)) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const [term, count] of counts) {
    const h = fnv1a(term);
    const sign = (h >>> 31) & 1 ? -1 : 1;
    v[h % MOCK_DIMS] = (v[h % MOCK_DIMS] as number) + sign * (1 + Math.log(count));
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

export interface ExtractiveMockOptions {
  /** Minimum number of the question's content words a sentence must contain. Default scales with question length. */
  minOverlap?: number;
}

/**
 * Stand-in "model": answers with the single retrieved sentence that shares the most content words
 * with the question, quoting it verbatim, or declines when nothing overlaps enough.
 */
export function createExtractiveMockProvider(options: ExtractiveMockOptions = {}): Provider {
  return {
    name: "mock-extractive",
    async generate(request: ProviderRequest): Promise<unknown> {
      const q = [...new Set(contentStems(request.question))];
      if (q.length === 0) return { answerable: false, answer: "", citations: [] };
      const need = options.minOverlap ?? (q.length <= 2 ? q.length : Math.max(2, Math.ceil(q.length * 0.5)));

      let best: { chunkId: string; sentence: string; overlap: number } | null = null;
      for (const chunk of request.context) {
        for (const { heading, sentence } of sectionsOf(chunk.text)) {
          // The section heading counts as context for matching, but only the sentence is quoted.
          const have = new Set(contentStems(`${heading} ${sentence}`));
          const overlap = q.filter((s) => have.has(s)).length;
          if (overlap >= need && (best === null || overlap > best.overlap)) {
            best = { chunkId: chunk.id, sentence, overlap };
          }
        }
      }
      if (best === null) return { answerable: false, answer: "", citations: [] };
      return {
        answerable: true,
        answer: best.sentence,
        citations: [{ chunkId: best.chunkId, quote: best.sentence }],
      };
    },
  };
}

/**
 * Splits text into sentences and list items, each tagged with the nearest heading above it.
 * Headings are context only, never answers. Every `sentence` is an exact substring of `text`.
 */
export function sectionsOf(text: string): { heading: string; sentence: string }[] {
  const out: { heading: string; sentence: string }[] = [];
  let heading = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (/^#+\s/.test(trimmed)) {
      heading = trimmed.replace(/^#+\s+/, "");
      continue;
    }
    const body = trimmed.replace(/^([-*]\s+|\d+\.\s+)/, "").trim();
    if (body === "") continue;
    for (const s of body.split(/(?<=[.!?])\s+/)) {
      const t = s.trim();
      if (t !== "") out.push({ heading, sentence: t });
    }
  }
  return out;
}

export interface ScriptedProvider extends Provider {
  readonly calls: ProviderRequest[];
}

/** Returns canned replies in order (repeating the last) and records every request. For tests. */
export function createScriptedProvider(replies: (unknown | ((req: ProviderRequest) => unknown))[]): ScriptedProvider {
  const calls: ProviderRequest[] = [];
  return {
    name: "scripted",
    calls,
    async generate(request: ProviderRequest): Promise<unknown> {
      calls.push(request);
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
      return typeof reply === "function" ? (reply as (r: ProviderRequest) => unknown)(request) : reply;
    },
  };
}
