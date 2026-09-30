import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../app.ts";

const app = createApp();

interface ErrorBody {
  error: string;
  success?: boolean;
}

interface HealthBody {
  status: string;
  capabilities: { asmHeadless: boolean };
}

interface AsmRunBody {
  success: boolean;
  error?: string;
  fallback?: boolean;
}

interface CapabilitiesBody {
  headless: boolean;
  timeoutMs: number;
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("GET /api/health reports status and ASM capability", async () => {
  const res = await app.request("/api/health");
  const body = await json<HealthBody>(res);

  assert.equal(res.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(typeof body.capabilities.asmHeadless, "boolean");
});

test("POST /api/compile rejects a missing code field with 400", async () => {
  const res = await post("/api/compile", { language: "assembly" });
  const body = await json<ErrorBody>(res);

  assert.equal(res.status, 400);
  assert.ok(body.error.includes("Missing"));
});

test("POST /api/compile rejects an unsupported language with 400", async () => {
  const res = await post("/api/compile", { code: "x", language: "python" });
  const body = await json<ErrorBody>(res);

  assert.equal(res.status, 400);
  assert.ok(body.error.includes("Unsupported language"));
});

test("POST /api/compile/run only accepts assembly", async () => {
  const res = await post("/api/compile/run", { code: "int main(){}", language: "c" });
  const body = await json<ErrorBody>(res);

  assert.equal(res.status, 400);
  assert.ok(body.error.includes("Unsupported language"));
});

test("POST /api/compile/asm/run reports the client-side fallback when headless is off", async () => {
  const res = await post("/api/compile/asm/run", { code: ".CODE\nEND" });
  const body = await json<AsmRunBody>(res);

  if (res.status === 501) {
    assert.equal(body.fallback, true);
    assert.ok(body.error?.includes("js-dos"));
  } else {
    assert.equal(res.status, 200);
  }
});

test("POST /api/compile/asm/run rejects a missing code field with 400", async () => {
  const res = await post("/api/compile/asm/run", {});

  assert.equal(res.status, 400);
});

test("POST /api/compile/asm/run rejects malformed JSON with 400", async () => {
  const res = await app.request("/api/compile/asm/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });

  assert.equal(res.status, 400);
});

test("GET /api/compile/asm/capabilities reports headless state and timeout", async () => {
  const res = await app.request("/api/compile/asm/capabilities");
  const body = await json<CapabilitiesBody>(res);

  assert.equal(res.status, 200);
  assert.equal(typeof body.headless, "boolean");
  assert.equal(typeof body.timeoutMs, "number");
});

test("unknown routes return a JSON 404", async () => {
  const res = await app.request("/api/does-not-exist");
  const body = await json<ErrorBody>(res);

  assert.equal(res.status, 404);
  assert.equal(body.success, false);
});

test("CORS preflight is answered with 204 and permissive headers", async () => {
  const res = await app.request("/api/compile", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });

  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.ok(res.headers.get("access-control-allow-methods")?.includes("POST"));
});

test("CORS headers are present on normal responses", async () => {
  const res = await app.request("/api/health");

  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});
