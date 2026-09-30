import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const IS_LINUX = process.platform === "linux";
export const NATIVE_EXE_NAME = IS_LINUX ? "a.out" : "program.exe";

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  success: boolean;
  timedOut: boolean;
  spawnError: string | null;
}

const FAILED_TO_RUN = -1;

export function runCommand(
  bin: string,
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const settle = (code: number, spawnError: string | null) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (killTimer !== null) clearTimeout(killTimer);
      resolve({
        code,
        stdout,
        stderr,
        success: code === 0 && !timedOut,
        timedOut,
        spawnError,
      });
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => void (stdout += chunk));
    child.stderr.on("data", (chunk: string) => void (stderr += chunk));

    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
        killTimer.unref();
      }, options.timeoutMs);
    }

    child.on("error", (err) => settle(FAILED_TO_RUN, err.message));
    child.on("close", (code) => settle(code ?? FAILED_TO_RUN, null));
  });
}

export function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export function removeDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true });
}

export async function readTextFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
