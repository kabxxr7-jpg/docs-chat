import type { Chunk } from "./types";

export interface ChunkOptions {
  /** Maximum characters per chunk. Default 800. */
  size?: number;
  /** Characters repeated at the start of the next chunk. Default 120. At most half of `size`. */
  overlap?: number;
}

export const DEFAULT_CHUNK_SIZE = 800;
export const DEFAULT_CHUNK_OVERLAP = 120;

/**
 * Splits text into overlapping chunks. Cuts prefer a paragraph break, then a sentence end, then a
 * space, searching only the last 40% of the window so chunks never get tiny. `start` and `end` index
 * into the text with CRLF and CR turned into "\n", and `text === normalised.slice(start, end)`.
 */
export function chunkText(text: string, file: string, options: ChunkOptions = {}): Chunk[] {
  const size = options.size ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_CHUNK_OVERLAP;
  if (!Number.isInteger(size) || size < 50) {
    throw new RangeError("size must be an integer of at least 50.");
  }
  if (!Number.isInteger(overlap) || overlap < 0 || overlap > size / 2) {
    throw new RangeError("overlap must be an integer between 0 and half of size.");
  }

  const src = text.replace(/\r\n?/g, "\n");
  const chunks: Chunk[] = [];
  let pos = 0;

  while (pos < src.length) {
    while (pos < src.length && isSpace(src[pos])) pos++;
    if (pos >= src.length) break;

    let end = Math.min(src.length, pos + size);
    if (end < src.length) {
      end = findBreak(src, pos + Math.floor(size * 0.6), end);
    }
    while (end > pos && isSpace(src[end - 1])) end--;

    const body = src.slice(pos, end);
    if (body.length > 0) {
      chunks.push({ id: `${file}#${chunks.length}`, file, start: pos, end, text: body });
    }
    if (end >= src.length) break;

    let next = end - overlap;
    if (next <= pos) next = end;
    // Do not start the next chunk in the middle of a word.
    while (next < end && !isSpace(src[next - 1]) && !isSpace(src[next])) next++;
    pos = next;
  }
  return chunks;
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

function findBreak(src: string, floor: number, end: number): number {
  const seg = src.slice(floor, end);
  const para = seg.lastIndexOf("\n\n");
  if (para !== -1) return floor + para;
  const sentence = Math.max(
    seg.lastIndexOf(". "),
    seg.lastIndexOf("! "),
    seg.lastIndexOf("? "),
    seg.lastIndexOf(".\n"),
  );
  if (sentence !== -1) return floor + sentence + 1;
  const space = Math.max(seg.lastIndexOf(" "), seg.lastIndexOf("\n"));
  if (space !== -1) return floor + space;
  return end;
}
