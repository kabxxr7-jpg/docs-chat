import { describe, expect, it } from "vitest";
import { chunkText } from "../src/chunk";

const sentence = "The quick brown fox jumps over the lazy dog. ";

describe("chunkText", () => {
  it("returns one chunk with exact offsets for short text", () => {
    const text = "Hello world.\n\nSecond paragraph.";
    const chunks = chunkText(text, "a.md", { size: 200, overlap: 20 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ id: "a.md#0", file: "a.md", start: 0, end: text.length, text });
  });

  it("keeps chunks within size, and text matches the source at the given offsets", () => {
    const long = sentence.repeat(60);
    const chunks = chunkText(long, "f.txt", { size: 300, overlap: 60 });
    expect(chunks.length).toBeGreaterThan(5);
    chunks.forEach((c, i) => {
      expect(c.text.length).toBeLessThanOrEqual(300);
      expect(long.slice(c.start, c.end)).toBe(c.text);
      expect(c.id).toBe(`f.txt#${i}`);
      expect(c.text).toBe(c.text.trim());
    });
  });

  it("overlaps consecutive chunks and covers all non-whitespace text", () => {
    const long = sentence.repeat(60);
    const chunks = chunkText(long, "f.txt", { size: 300, overlap: 60 });
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!;
      const cur = chunks[i]!;
      expect(cur.start).toBeGreaterThan(prev.start);
      expect(cur.start).toBeLessThan(prev.end);
    }
    for (let j = 0; j < long.length; j++) {
      if (/\s/.test(long[j]!)) continue;
      expect(chunks.some((c) => c.start <= j && j < c.end)).toBe(true);
    }
  });

  it("prefers to cut at a paragraph break", () => {
    const para = "alpha beta gamma delta ".repeat(10).trim();
    const chunks = chunkText(`${para}\n\n${para}`, "p.md", { size: 300, overlap: 40 });
    expect(chunks[0]!.text).toBe(para);
  });

  it("never starts a later chunk in the middle of a word", () => {
    const long = sentence.repeat(40);
    const chunks = chunkText(long, "w.txt", { size: 200, overlap: 50 });
    for (const c of chunks.slice(1)) {
      expect(long[c.start - 1]).toMatch(/\s/);
    }
  });

  it("normalises CRLF and indexes the normalised text", () => {
    const chunks = chunkText("line one\r\nline two", "c.txt");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe("line one\nline two");
    expect(chunks[0]!.end).toBe(17);
  });

  it("skips leading whitespace and returns nothing for blank input", () => {
    expect(chunkText("   \n\n  ", "b.txt")).toEqual([]);
    expect(chunkText("", "b.txt")).toEqual([]);
    const [first] = chunkText("\n\n  hello", "b.txt");
    expect(first!.text).toBe("hello");
    expect(first!.start).toBe(4);
  });

  it("hard-cuts a token longer than the window and still terminates", () => {
    const chunks = chunkText("x".repeat(500), "x.txt", { size: 100, overlap: 10 });
    expect(chunks).toHaveLength(5);
    chunks.forEach((c) => expect(c.text.length).toBe(100));
  });

  it("rejects options that cannot work", () => {
    expect(() => chunkText("text", "a", { size: 10 })).toThrow(RangeError);
    expect(() => chunkText("text", "a", { size: 100.5 })).toThrow(RangeError);
    expect(() => chunkText("text", "a", { size: 100, overlap: 51 })).toThrow(RangeError);
    expect(() => chunkText("text", "a", { size: 100, overlap: -1 })).toThrow(RangeError);
  });
});
