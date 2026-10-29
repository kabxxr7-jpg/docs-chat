// Same quote-check idea as opsflow's lib/ai.ts and the extraction kit: a quote only counts if it
// really appears in the text it is attributed to. Whitespace runs collapse and case is ignored,
// nothing else is loosened.

export function normalizeForQuote(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** An empty quote is never "found": it would match every text. */
export function quoteAppearsIn(quote: string, source: string): boolean {
  const q = normalizeForQuote(quote);
  if (q === "") return false;
  return normalizeForQuote(source).includes(q);
}
