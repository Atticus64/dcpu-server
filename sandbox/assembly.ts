import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../lib/logger.ts";
import { IS_LINUX, makeTempDir, readTextFileIfExists, removeDir, runCommand } from "../lib/proc.ts";

const TOOLS_DIR = join(import.meta.dirname, "..", "tools", "jwasm");
const JWASM_WIN = join(TOOLS_DIR, "JWasm.exe");
const JWASM_LOCAL = join(TOOLS_DIR, "jwasm");

function resolveAssembler(): string {
  if (!IS_LINUX) return JWASM_WIN;
  const fromEnv = process.env.JWASM_PATH;
  if (fromEnv) return fromEnv;
  const candidates = [
    "/usr/local/bin/jwasm",
    "/usr/bin/jwasm",
    JWASM_LOCAL,
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // fallback to PATH
  return "jwasm";
}

const ASSEMBLER = resolveAssembler();

type Config = {
  args: string[];
  source: string;
  obj: string;
  exe: string;
  tmpDir: string;
};

function asmArgs(config: Config): string[] {
  return ["-Fo", config.obj, "-I", TOOLS_DIR, config.source];
}

function exeArgs(config: Config): string[] {
  return ["-mz", "-Fo", config.exe, "-I", TOOLS_DIR, config.source];
}

export const ASM_SESSION_TIMEOUT_MS = 10_000;

function resolveDosbox(): string | null {
  const fromEnv = process.env.DOSBOX_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates = [
    "/usr/bin/dosbox",
    "/usr/bin/dosbox-staging",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function isAsmHeadlessAvailable(): boolean {
  // js-dos 100% cliente: el servidor solo compila (jwasm -mz) y retorna exeBase64.
  // Headless DOSBox desactivado por defecto para evitar timeout de 10s.
  // Activar solo con ENABLE_DOSBOX_HEADLESS=1 para debugging.
  if (process.env.ENABLE_DOSBOX_HEADLESS !== "1") return false;
  return resolveDosbox() !== null;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function spawnFailure(message: string) {
  return { success: false, stdout: "", stderr: "", error: message };
}

export function parseAsmSource(code: string): string {
  let resultado = code;
  resultado = resultado.replace(/^IDEAL\s*$/gm, "");
  resultado = resultado.replace(/^ideal\s*$/gm, "");
  resultado = resultado.replace(/^MODEL\s+/gm, ".MODEL ");
  resultado = resultado.replace(/^STACK\s+/gm, ".STACK ");
  resultado = resultado.replace(/^DATASEG\s*$/gm, ".DATA");
  resultado = resultado.replace(/^CODESEG\s*$/gm, ".CODE");
  resultado = resultado.replace(/^model\s+/gm, ".MODEL ");
  resultado = resultado.replace(/^stack\s+/gm, ".STACK ");
  resultado = resultado.replace(/^dataseg\s*$/gm, ".DATA");
  resultado = resultado.replace(/^codeseg\s*$/gm, ".CODE");
  resultado = resultado.replace(/^proc\s+(\w+)\s*(;.*)?$/gim, "$1 PROC$2");
  resultado = resultado.replace(/^endp\s+(\w+)\s*(;.*)?$/gim, "$1 ENDP$2");
  resultado = resultado.replace(/\boffset\s+/g, "OFFSET ");
  resultado = resultado.replace(/\n\s*\n\s*\n/g, "\n\n");
  return resultado;
}

function formatAsmOutput(s: string): string {
  let out = stripAnsi(s);
  // Normalize line endings
  out = out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Filter common DOSBox banners and mount messages
  const ignorePatterns = [
    /mounting.*drive/i,
    /mounted.*drive/i,
    /^drive c.*mounted/i,
    /^c:\\>/i,
    /^z:\\>/i,
    /dosbox/i,
    /staging/i,
    /copyright/i,
    /^\s*$/,
  ];
  // Also split and filter lines that are pure banners
  const lines = out.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep empty for spacing, but will join later
    for (const pat of ignorePatterns) {
      if (pat.test(trimmed)) return false;
    }
    // Filter mount commands echoed
    if (/^mount\s+/i.test(trimmed)) return false;
    return true;
  });
  out = filtered.join("\n");
  // Collapse 3+ blank lines
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

export async function compileAssembly(code: string) {
  const parsed = parseAsmSource(code);
  log.debug(`compileAssembly: tmpDir created, code.length=${code.length} parsed=${parsed.length}`);
  const tmpDir = await makeTempDir("dcpu-asm-");
  try {
    const srcFile = join(tmpDir, "input.asm");
    const objFile = join(tmpDir, "input.obj");
    await writeFile(srcFile, parsed);
    const config = { args: [], source: srcFile, tmpDir, obj: objFile, exe: "" };

    const start = Date.now();
    const proc = await runCommand(ASSEMBLER, asmArgs(config), { cwd: tmpDir });
    const ms = Date.now() - start;

    log.debug(`compileAssembly: exit_code=${proc.code}, duration=${ms}ms`);

    if (proc.spawnError !== null) {
      return spawnFailure(proc.spawnError);
    }

    const cleanedStdout = stripAnsi(proc.stdout);
    const cleanedStderr = stripAnsi(proc.stderr);

    if (!proc.success) {
      const hasErrors = cleanedStderr || cleanedStdout;
      return {
        success: false,
        stdout: cleanedStdout,
        stderr: cleanedStderr,
        error: hasErrors
          ? `Assembly failed:\n${cleanedStderr || cleanedStdout}`
          : `Assembly failed with exit code ${proc.code}`,
      };
    }

    return {
      success: true,
      stdout: cleanedStdout || "Assembly successful",
      stderr: "",
      error: null,
    };
  } finally {
    await removeDir(tmpDir).catch(() => {});
  }
}

export async function compileAssemblyRun(code: string) {
  const parsed = parseAsmSource(code);
  log.debug(`compileAssemblyRun: tmpDir created, code.length=${code.length} parsed=${parsed.length}`);
  const tmpDir = await makeTempDir("dcpu-asm-run-");
  try {
    const srcFile = join(tmpDir, "input.asm");
    const exeFile = join(tmpDir, "input.exe");
    await writeFile(srcFile, parsed);
    const config = { args: [], source: srcFile, tmpDir, obj: "", exe: exeFile };

    const start = Date.now();
    const proc = await runCommand(ASSEMBLER, exeArgs(config), { cwd: tmpDir });
    const ms = Date.now() - start;

    log.debug(`compileAssemblyRun: exit_code=${proc.code}, duration=${ms}ms`);

    if (proc.spawnError !== null) {
      return { success: false, exeBase64: null, error: proc.spawnError };
    }

    const cleanedStdout = stripAnsi(proc.stdout);
    const cleanedStderr = stripAnsi(proc.stderr);

    if (!proc.success) {
      const hasErrors = cleanedStderr || cleanedStdout;
      return {
        success: false,
        exeBase64: null,
        error: hasErrors
          ? `Assembly failed:\n${cleanedStderr || cleanedStdout}`
          : `Assembly failed with exit code ${proc.code}`,
      };
    }

    const exeBase64 = (await readFile(exeFile)).toString("base64");

    return {
      success: true,
      exeBase64,
      error: null,
    };
  } finally {
    await removeDir(tmpDir).catch(() => {});
  }
}

export interface AsmRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error: string | null;
}

/**
 * Compile ASM and try to run it headless via DOSBox.
 * Used by POST /api/compile/asm/run and WS session.
 * If DOSBox is not available, caller should fallback to client-side js-dos.
 */
export async function compileAndRunAsmCaptured(code: string): Promise<AsmRunResult> {
  const parsed = parseAsmSource(code);
  const tmpDir = await makeTempDir("dcpu-asm-cap-");
  try {
    const srcFile = join(tmpDir, "input.asm");
    const exeFile = join(tmpDir, "program.exe");
    await writeFile(srcFile, parsed);
    const config = { args: [], source: srcFile, tmpDir, obj: "", exe: exeFile };

    const proc = await runCommand(ASSEMBLER, exeArgs(config), { cwd: tmpDir });
    if (proc.spawnError !== null) {
      return {
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        error: `DOSBox execution failed: ${proc.spawnError}`,
      };
    }
    if (!proc.success) {
      const cleanedStdout = stripAnsi(proc.stdout);
      const cleanedStderr = stripAnsi(proc.stderr);
      const hasErrors = cleanedStderr || cleanedStdout;
      return {
        success: false,
        stdout: cleanedStdout,
        stderr: cleanedStderr,
        exitCode: proc.code,
        error: hasErrors
          ? `Assembly failed:\n${cleanedStderr || cleanedStdout}`
          : `Assembly failed with exit code ${proc.code}`,
      };
    }
    // Try DOSBox execution
    const dosbox = resolveDosbox();
    if (!dosbox) {
      return {
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        error: "DOSBox not available on server (install dosbox-staging or set DOSBOX_PATH). Use client-side fallback.",
      };
    }
    return await runDosboxCapture(dosbox, exeFile, tmpDir);
  } finally {
    await removeDir(tmpDir).catch(() => {});
  }
}

async function runDosboxCapture(dosboxBin: string, exeFile: string, tmpDir: string): Promise<AsmRunResult> {
  const outFile = join(tmpDir, "out.txt");
  // Compatibilidad audio/video sin xorg: offscreen video + dummy audio funciona con staging (probado: offscreen initialised, no ABORT)
  // Quitamos -securemode para que mount c funcione (con securemode solo existe Z)
  const dosboxConfContent =
    `[sdl]\noutput=texture\n[dosbox]\nmemsize=16\n[autoexec]\n@echo off\nmount z ${tmpDir}\nz:\nprogram.exe > out.txt 2> err.txt\n exit\n`;
  const confFile = join(tmpDir, "dosbox.conf");
  await writeFile(confFile, dosboxConfContent);

  log.debug(`runDosboxCapture: bin=${dosboxBin}, tmpDir=${tmpDir}`);

  // compatibilidad: offscreen evita ABORT OpenGL con dummy, dummy audio evita requerir ALSA/pulse
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SDL_VIDEODRIVER: "offscreen",
    // SDL_AUDIODRIVER: "dummy",
    // opcional: forzar render software para asegurar compatibilidad sin GL
    SDL_RENDER_DRIVER: "software",
  };

  const timeoutMs = ASM_SESSION_TIMEOUT_MS;
  const result = await runCommand(dosboxBin, ["-conf", confFile, "-noconsole", "-nosound"], {
    cwd: tmpDir,
    env,
    timeoutMs,
  });

  let stdout = result.stdout;
  let stderr = result.stderr;
  const exitCode = result.timedOut ? null : result.code;

  // Prefer captured out.txt if exists
  const captured = await readTextFileIfExists(outFile);
  if (captured !== null && captured.trim()) {
    stdout = captured;
  }
  const errCaptured = await readTextFileIfExists(join(tmpDir, "err.txt"));
  if (errCaptured !== null && errCaptured.trim()) {
    stderr += (stderr ? "\n" : "") + errCaptured;
  }

  const formattedStdout = formatAsmOutput(stdout);
  const formattedStderr = formatAsmOutput(stderr);

  if (result.timedOut) {
    return { success: false, stdout: formattedStdout, stderr: formattedStderr, exitCode, error: "Program timed out" };
  }

  if (result.spawnError !== null) {
    return {
      success: false,
      stdout: formattedStdout,
      stderr: formattedStderr,
      exitCode,
      error: `DOSBox execution failed: ${result.spawnError}`,
    };
  }

  return { success: true, stdout: formattedStdout, stderr: formattedStderr, exitCode, error: null };
}

export { formatAsmOutput, resolveDosbox };
