import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../app.ts";
import { resolveDosbox } from "../sandbox/assembly.ts";

const app = createApp();

const CANONICAL_ASM = `.MODEL SMALL
.STACK 100h
.DATA
MSG DB "Hola DCPU$"
.CODE
start PROC
 mov ax, SEG MSG
 mov ds, ax
 mov dx, OFFSET MSG
 mov ah, 09h
 int 21h
 mov ax, 4C00h
 int 21h
start ENDP
END start
`;

interface CompileBody {
  success: boolean;
  stdout: string;
  stderr: string;
  error: string | null;
}

interface CompileRunBody {
  success: boolean;
  exeBase64: string | null;
  error: string | null;
}

interface AsmCaptureBody {
  success: boolean;
  stdout: string;
  error: string | null;
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

const send = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const LOCAL_JWASM = join(import.meta.dirname, "..", "tools", "jwasm", "jwasm");

// JWasm prints its option list and exits non-zero, so probe the output only.
const jwasmAvailable = (): boolean => {
  const bin = process.env.JWASM_PATH || (existsSync(LOCAL_JWASM) ? LOCAL_JWASM : "jwasm");
  const probe = spawnSync(bin, ["-h"], { encoding: "utf8" });
  return /-mz/.test(`${probe.stdout}${probe.stderr}`);
};

const noJwasm = jwasmAvailable() ? false : "JWasm is not built; run scripts/setup-fedora.sh";
const headlessOff = process.env.ENABLE_DOSBOX_HEADLESS === "1" && resolveDosbox()
  ? false
  : "ENABLE_DOSBOX_HEADLESS=1 and a DOSBox binary are required";

test("POST /api/compile assembles canonical MASM source", { skip: noJwasm }, async () => {
  const res = await send("/api/compile", { code: CANONICAL_ASM, language: "assembly" });
  const body = await json<CompileBody>(res);

  assert.equal(res.status, 200);
  assert.equal(body.success, true, body.error ?? "");
});

test("POST /api/compile surfaces assembler errors", { skip: noJwasm }, async () => {
  const res = await send("/api/compile", {
    code: ".CODE\nthis is not an instruction\nEND",
    language: "assembly",
  });
  const body = await json<CompileBody>(res);

  assert.equal(res.status, 200);
  assert.equal(body.success, false);
  assert.ok((body.error ?? "").length > 0);
});

test("POST /api/compile/run emits a DOS MZ executable", { skip: noJwasm }, async () => {
  const res = await send("/api/compile/run", { code: CANONICAL_ASM, language: "assembly" });
  const body = await json<CompileRunBody>(res);

  assert.equal(res.status, 200);
  assert.equal(body.success, true, body.error ?? "");

  const bytes = Buffer.from(body.exeBase64 ?? "", "base64");
  assert.equal(bytes.subarray(0, 2).toString("latin1"), "MZ");
  assert.ok(bytes.length > 0);
});

test("POST /api/compile compiles C and wraps a bare statement in main", async () => {
  const res = await send("/api/compile", { code: 'printf("hola\\n");', language: "c" });
  const body = await json<CompileBody>(res);

  assert.equal(res.status, 200);
  assert.equal(body.success, true, body.error ?? "");
});

test("POST /api/compile/asm/run captures DOSBox output", { skip: headlessOff }, async () => {
  const res = await send("/api/compile/asm/run", { code: CANONICAL_ASM });
  const body = await json<AsmCaptureBody>(res);

  assert.equal(res.status, 200);
  assert.equal(body.success, true, body.error ?? "");
  assert.ok(body.stdout.includes("Hola DCPU"), `unexpected stdout: ${body.stdout}`);
});
