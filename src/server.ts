import { readFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AskResult } from "./types";

export interface ServerOptions {
  ask: (question: string) => Promise<AskResult>;
  /** Value for Access-Control-Allow-Origin. Unset means same-origin only (no CORS headers). */
  allowOrigin?: string;
  /** Request body cap in bytes. Default 4096. */
  maxBodyBytes?: number;
  /** Default 500 characters. */
  maxQuestionLength?: number;
}

const WIDGET_URL = new URL("../widget/widget.js", import.meta.url);
const DEMO_URL = new URL("../widget/demo.html", import.meta.url);

/** No authentication and no rate limiting: put it behind your own before exposing it. */
export function createServer(options: ServerOptions): Server {
  const maxBody = options.maxBodyBytes ?? 4096;
  const maxQuestion = options.maxQuestionLength ?? 500;

  const send = (res: ServerResponse, status: number, body: unknown) => {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...corsHeaders(),
    });
    res.end(json);
  };

  const corsHeaders = (): Record<string, string> =>
    options.allowOrigin
      ? {
          "access-control-allow-origin": options.allowOrigin,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        }
      : {};

  const sendFile = async (res: ServerResponse, url: URL, type: string) => {
    try {
      const body = await readFile(url);
      res.writeHead(200, { "content-type": type, "x-content-type-options": "nosniff", "cache-control": "no-cache" });
      res.end(body);
    } catch {
      send(res, 500, { status: "error", message: "Could not read that file." });
    }
  };

  return createHttpServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];

    if (path === "/ask") {
      if (req.method === "OPTIONS" && options.allowOrigin) {
        res.writeHead(204, corsHeaders());
        res.end();
        return;
      }
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        send(res, 405, { status: "error", message: "Use POST." });
        req.resume();
        return;
      }
      void handleAsk(req, res);
      return;
    }
    if (req.method === "GET" && path === "/widget.js") {
      void sendFile(res, WIDGET_URL, "text/javascript; charset=utf-8");
      return;
    }
    if (req.method === "GET" && (path === "/" || path === "/demo.html")) {
      void sendFile(res, DEMO_URL, "text/html; charset=utf-8");
      return;
    }
    send(res, 404, { status: "error", message: "Not found." });
    req.resume();
  });

  async function handleAsk(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooBig = false;
    for await (const piece of req) {
      const buf = piece as Buffer;
      total += buf.length;
      if (total > maxBody) tooBig = true;
      else chunks.push(buf);
    }
    if (tooBig) return send(res, 413, { status: "error", message: "Request is too large." });

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(res, 400, { status: "error", message: "Body must be JSON." });
    }
    const question = (parsed as { question?: unknown } | null)?.question;
    if (typeof question !== "string" || question.trim() === "") {
      return send(res, 400, { status: "error", message: 'Send {"question": "..."}.' });
    }
    if (question.length > maxQuestion) {
      return send(res, 400, { status: "error", message: `Questions are limited to ${maxQuestion} characters.` });
    }

    try {
      const result = await options.ask(question);
      send(res, result.status === "error" ? 502 : 200, result);
    } catch {
      send(res, 500, { status: "error", message: "Something went wrong." });
    }
  }
}
