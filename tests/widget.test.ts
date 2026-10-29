import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers";

// Static checks only. The widget is not exercised in a browser by these tests.

describe("widget.js", async () => {
  const source = await readFile(join(ROOT, "widget", "widget.js"), "utf8");

  it("parses as a script", () => {
    expect(() => new vm.Script(source, { filename: "widget.js" })).not.toThrow();
  });

  it("never inserts server text as HTML", () => {
    for (const banned of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("]) {
      expect(source).not.toContain(banned);
    }
  });

  it("exposes init and ask on window.DocsChat", () => {
    expect(source).toContain("window.DocsChat = { init: init, ask: send }");
  });

  it("sends only the question, as JSON", () => {
    expect(source).toContain("JSON.stringify({ question: question })");
  });
});
