import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../lib/logger.ts";
import { IS_LINUX, NATIVE_EXE_NAME, makeTempDir, removeDir, runCommand } from "../lib/proc.ts";

const TOOLS_DIR = join(import.meta.dirname, "..", "tools", "tcc", "tcc");
const TCC_PATH = join(TOOLS_DIR, "tcc.exe");
const SESSION_TIMEOUT_MS = 60_000;
const COMPILER_PATH = IS_LINUX ? "gcc" : TCC_PATH;

function compilerArgs(srcFile: string, exeFile: string): string[] {
  if (IS_LINUX) return ["-o", exeFile, srcFile];
  return [
    "-I", join(TOOLS_DIR, "include"),
    "-L", join(TOOLS_DIR, "lib"),
    "-run",
    srcFile,
  ];
}

export function prepareSource(code: string): { src: string; hasMain: boolean } {
  const hasMain = code.includes("int main") || code.includes("void main");
  if (hasMain) {
    return { src: code, hasMain: true };
  }
  return {
    src: `#include <stdio.h>\nint main() { ${code}; return 0; }\n`,
    hasMain: false,
  };
}

export async function compileC(code: string) {
  log.debug(`compileC: tmpDir created, code.length=${code.length}`);
  const tmpDir = await makeTempDir("dcpu-c-");
  try {
    const srcFile = join(tmpDir, "input.c");
    const { src, hasMain } = prepareSource(code);
    await writeFile(srcFile, src);

    // compile to temp exe for validation, then remove
    const tmpExe = join(tmpDir, NATIVE_EXE_NAME);
    const start = Date.now();
    const proc = await runCommand(COMPILER_PATH, compilerArgs(srcFile, tmpExe), { cwd: tmpDir });
    const ms = Date.now() - start;

    log.debug(`compileC: exit_code=${proc.code}, hasMain=${hasMain}, duration=${ms}ms`);

    if (proc.spawnError !== null) {
      return { success: false, stdout: "", stderr: "", error: proc.spawnError };
    }

    if (!proc.success) {
      return {
        success: false,
        stdout: proc.stdout,
        stderr: proc.stderr,
        error: proc.stderr || "Compilation failed",
      };
    }

    return {
      success: true,
      stdout: proc.stdout || "Compilation successful",
      stderr: "",
      error: null,
    };
  } finally {
    await removeDir(tmpDir).catch(() => {});
  }
}

export interface CSession {
  proc: ChildProcessWithoutNullStreams;
  tmpDir: string;
}

export async function compileCToExe(code: string): Promise<CSession> {
  log.debug(`compileCToExe: tmpDir created, code.length=${code.length}`);
  const tmpDir = await makeTempDir("dcpu-c-session-");
  const srcFile = join(tmpDir, "input.c");
  const exeFile = join(tmpDir, NATIVE_EXE_NAME);

  const { src } = prepareSource(code);
  await writeFile(srcFile, src);

  const start = Date.now();
  const proc = await runCommand(COMPILER_PATH, compilerArgs(srcFile, exeFile), { cwd: tmpDir });

  log.debug(`compileCToExe: exit_code=${proc.code}, duration=${Date.now() - start}ms`);

  if (proc.spawnError !== null || !proc.success) {
    await removeDir(tmpDir).catch(() => {});
    const message = proc.stderr || proc.stdout || proc.spawnError ||
      `Compilation failed with exit code ${proc.code}`;
    throw new Error(message.trim());
  }

  return {
    proc: spawn(exeFile, { cwd: tmpDir, stdio: "pipe" }),
    tmpDir,
  };
}

export function cleanupCSession(session: CSession): Promise<void> {
  session.proc.kill();
  return removeDir(session.tmpDir).catch(() => {});
}

export { SESSION_TIMEOUT_MS };
