import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { makeTempDir, readTextFileIfExists, removeDir, runCommand } from "../lib/proc.ts";

test("runCommand resolves on a non-zero exit instead of rejecting", async () => {
  const result = await runCommand("node", ["-e", "process.stdout.write('out');process.stderr.write('err');process.exit(3)"]);

  assert.equal(result.success, false);
  assert.equal(result.code, 3);
  assert.equal(result.stdout, "out");
  assert.equal(result.stderr, "err");
  assert.equal(result.spawnError, null);
  assert.equal(result.timedOut, false);
});

test("runCommand reports success for a clean exit", async () => {
  const result = await runCommand("node", ["-e", "process.stdout.write('ok')"]);

  assert.equal(result.success, true);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "ok");
});

test("runCommand sets spawnError when the binary does not exist", async () => {
  const result = await runCommand("dcpu-definitely-not-a-real-binary", []);

  assert.equal(result.success, false);
  assert.match(result.spawnError ?? "", /ENOENT/);
});

test("runCommand kills a process that outlives its timeout", async () => {
  const result = await runCommand("node", ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 200 });

  assert.equal(result.timedOut, true);
  assert.equal(result.success, false);
});

test("runCommand captures output in the given cwd", async () => {
  const dir = await makeTempDir("dcpu-test-");
  try {
    const result = await runCommand("node", ["-e", "process.stdout.write(process.cwd())"], { cwd: dir });

    assert.equal(result.success, true);
    assert.ok(existsSync(dir));
  } finally {
    await removeDir(dir);
  }

  assert.equal(existsSync(dir), false);
});

test("readTextFileIfExists returns null instead of throwing", async () => {
  const dir = await makeTempDir("dcpu-test-");
  try {
    assert.equal(await readTextFileIfExists(`${dir}/missing.txt`), null);
  } finally {
    await removeDir(dir);
  }
});
