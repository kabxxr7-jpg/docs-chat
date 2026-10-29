export { ask, buildPrompt, ANSWER_SCHEMA, type AskDeps, type AskOptions } from "./answer";
export { chunkText, type ChunkOptions } from "./chunk";
export { classify, parseCases, renderReport, runEval, type EvalCase, type EvalSummary } from "./eval";
export { ingestDirectory } from "./ingest";
export { createServer, type ServerOptions } from "./server";
export { cosine, StoreError, VectorStore } from "./store";
export { quoteAppearsIn, normalizeForQuote } from "./normalize";
export { createGeminiEmbedder, createGeminiProvider, GeminiError } from "./providers/gemini";
export {
  createExtractiveMockProvider,
  createMockEmbedder,
  createScriptedProvider,
} from "./providers/mock";
export type * from "./types";
