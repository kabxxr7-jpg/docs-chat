import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ask } from "../src/answer";
import { createServer, type ServerOptions } from "../src/server";
import type { AskResult } from "../src/types";
import { ROOT, exampleDeps } from "./helpers";

let running: Server | undefined;

afterEach(async () => {
  const server = running;
  running = undefined;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function start(options: ServerOptions): Promise<string> {
  const server = createServer(options);
  running = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function realAsk(): Promise<ServerOptions["ask"]> {
  const deps = await exampleDeps();
  return (q) => ask(q, deps);
}

const post = (url: string, body: string) =>
  fetch(`${url}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body });

describe("POST /ask with the real pipeline", () => {
  it("answers an in-scope question with citations", async () => {
    const url = await start({ ask: await realAsk() });
    const res = await post(url, JSON.stringify({ question: "How long do refunds take?" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as AskResult;
    expect(body.status).toBe("answered");
    if (body.status !== "answered") return;
    expect(body.answer).toContain("5 to 7 business days");
    expect(body.citations[0]).toMatchObject({ file: "returns.md" });
    expect(typeof body.citations[0]!.quote).toBe("string");
  });

  it("returns 200 with a refusal for an out-of-scope question", async () => {
    const url = await start({ ask: await realAsk() });
    const res = await post(url, JSON.stringify({ question: "What is the weather in Boston?" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "refused", reason: "low_similarity" });
  });
});

describe("request validation", () => {
  it.each([
    ["invalid JSON", "{nope"],
    ["a missing question", "{}"],
    ["a non-string question", JSON.stringify({ question: 42 })],
    ["a blank question", JSON.stringify({ question: "   " })],
    ["a question over the length limit", JSON.stringify({ question: "x".repeat(501) })],
  ])("returns 400 for %s", async (_label, body) => {
    let called = false;
    const url = await start({
      ask: async () => {
        called = true;
        return { status: "refused", reason: "low_similarity", message: "m" };
      },
    });
    const res = await post(url, body);
    expect(res.status).toBe(400);
    expect((await res.json()) as { status: string }).toMatchObject({ status: "error" });
    expect(called).toBe(false);
  });

  it("returns 413 for a body over the cap", async () => {
    const url = await start({ ask: await realAsk(), maxBodyBytes: 100 });
    const res = await post(url, JSON.stringify({ question: "x".repeat(300) }));
    expect(res.status).toBe(413);
  });

  it("returns 405 with an Allow header for GET /ask, and 404 elsewhere", async () => {
    const url = await start({ ask: await realAsk() });
    const get = await fetch(`${url}/ask`);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect((await fetch(`${url}/nope`)).status).toBe(404);
    expect((await fetch(`${url}/nope`, { method: "POST", body: "{}" })).status).toBe(404);
  });
});

describe("failures and headers", () => {
  it("maps a pipeline error to 502", async () => {
    const url = await start({ ask: async () => ({ status: "error", message: "The answering model isn't available right now." }) });
    const res = await post(url, JSON.stringify({ question: "hi" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ status: "error" });
  });

  it("returns a generic 500 and does not leak a thrown message", async () => {
    const url = await start({
      ask: async () => {
        throw new Error("secret-key-123 in stack");
      },
    });
    const res = await post(url, JSON.stringify({ question: "hi" }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret-key-123");
  });

  it("sets no-store and nosniff on JSON responses", async () => {
    const url = await start({ ask: await realAsk() });
    const res = await post(url, JSON.stringify({ question: "How long do refunds take?" }));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("CORS", () => {
  it("sends no CORS headers unless an origin is configured", async () => {
    const url = await start({ ask: await realAsk() });
    const res = await post(url, JSON.stringify({ question: "How long do refunds take?" }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect((await fetch(`${url}/ask`, { method: "OPTIONS" })).status).toBe(405);
  });

  it("answers the preflight and tags responses when an origin is configured", async () => {
    const url = await start({ ask: await realAsk(), allowOrigin: "https://example.com" });
    const preflight = await fetch(`${url}/ask`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://example.com");
    expect(preflight.headers.get("access-control-allow-headers")).toBe("content-type");
    const res = await post(url, JSON.stringify({ question: "How long do refunds take?" }));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://example.com");
  });
});

describe("static files", () => {
  it("serves the widget exactly as it is on disk", async () => {
    const url = await start({ ask: await realAsk() });
    const res = await fetch(`${url}/widget.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(await res.text()).toBe(await readFile(join(ROOT, "widget", "widget.js"), "utf8"));
  });

  it("serves the demo page at / and says the company is fictional", async () => {
    const url = await start({ ask: await realAsk() });
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("fictional");
    expect(html).toContain('<script src="/widget.js">');
  });
});
