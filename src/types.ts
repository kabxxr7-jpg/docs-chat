export type JsonSchema = Record<string, unknown>;

/** A slice of a source file. `start` and `end` index into the file text with newlines normalised to "\n". */
export interface Chunk {
  id: string;
  file: string;
  start: number;
  end: number;
  text: string;
}

export interface StoredChunk extends Chunk {
  vector: number[];
}

export interface ScoredChunk extends StoredChunk {
  score: number;
}

export type EmbedKind = "document" | "query";

export interface Embedder {
  readonly name: string;
  /**
   * Similarity scores below this mean "not in the documents". The scale depends on the embedder, so it
   * lives here and can be overridden per call. Values for real embedders are starting points to tune.
   */
  readonly defaultMinSimilarity: number;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

export interface ContextChunk {
  id: string;
  file: string;
  text: string;
}

export interface ProviderRequest {
  question: string;
  /** The retrieved excerpts the answer must come from. Real providers use `prompt` and `schema`; test doubles may use `context`. */
  context: ContextChunk[];
  prompt: string;
  schema: JsonSchema;
}

export interface Provider {
  readonly name: string;
  /** Returns the model's reply: a parsed object, or the raw JSON text. Anything else is treated as invalid. */
  generate(request: ProviderRequest): Promise<unknown>;
}

export interface Citation {
  chunkId: string;
  file: string;
  /** Copied by the model from the chunk; verified to appear in the chunk text (case and whitespace insensitive). */
  quote: string;
  /** Position of the cited chunk in its source file. */
  start: number;
  end: number;
  score: number;
}

export type RefusalReason =
  | "low_similarity"
  | "model_declined"
  | "invalid_output"
  | "no_citations"
  | "unknown_chunk"
  | "fabricated_quote";

export type AskResult =
  | { status: "answered"; answer: string; citations: Citation[] }
  | { status: "refused"; reason: RefusalReason; message: string }
  | { status: "error"; message: string };
