import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAsmOutput, parseAsmSource } from "../sandbox/assembly.ts";

test("parseAsmSource converts IDEAL directives to MASM", () => {
  const parsed = parseAsmSource(
    "IDEAL\nMODEL SMALL\nSTACK 100h\nDATASEG\nCODESEG\nstart: mov ax, 1\nEND start",
  );

  assert.ok(!parsed.includes("IDEAL"));
  assert.ok(parsed.includes(".MODEL SMALL"));
  assert.ok(parsed.includes(".STACK 100h"));
  assert.ok(parsed.includes(".DATA"));
  assert.ok(parsed.includes(".CODE"));
});

test("parseAsmSource reorders proc/endp labels", () => {
  const parsed = parseAsmSource("proc mover ; copia\n mov ax, 1\nendp mover");

  assert.ok(parsed.includes("mover PROC"));
  assert.ok(parsed.includes("mover ENDP"));
});

test("parseAsmSource uppercases offset", () => {
  const parsed = parseAsmSource("mov dx, offset buffer");

  assert.ok(parsed.includes("OFFSET buffer"));
  assert.ok(!parsed.includes("offset buffer"));
});

test("formatAsmOutput strips DOSBox banners and mount noise", () => {
  const formatted = formatAsmOutput(
    "DOSBox version 0.74\n" + "Copyright (C) 2000-2017\n" + "mount z /tmp\n" + "\n" + "hola DCPU\n" + "\n\n\n",
  );

  assert.ok(formatted.includes("hola DCPU"));
  assert.ok(!formatted.includes("DOSBox"));
  assert.ok(!formatted.includes("Copyright"));
  assert.ok(!/^mount /m.test(formatted));
});

test("formatAsmOutput normalises CRLF line endings", () => {
  assert.equal(formatAsmOutput("linea1\r\nlinea2\r"), "linea1\nlinea2");
});

test("formatAsmOutput strips ANSI colour codes", () => {
  assert.equal(formatAsmOutput("\x1b[32mverde\x1b[0m"), "verde");
});
