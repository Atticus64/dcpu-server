import { upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocket } from "ws";
import type { WSContext } from "hono/ws";
import {
  compileAndRunAsmCaptured,
  isAsmHeadlessAvailable,
  ASM_SESSION_TIMEOUT_MS,
} from "../sandbox/assembly.ts";
import { log } from "../lib/logger.ts";

const asmSessionRouter = new Hono();

const WS_OPEN = WebSocket.OPEN;

interface SocketMsg {
  type: string;
  code?: string;
  data?: string;
}

asmSessionRouter.get("/ws", upgradeWebSocket(() => {
  let cleanedUp = false;

  const send = (ws: WSContext, msg: Record<string, unknown>) => {
    if (ws.readyState === WS_OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
  };

  const close = async (ws: WSContext, code = 1000) => {
    await cleanup();
    if (ws.readyState === WS_OPEN) {
      ws.close(code);
    }
  };

  return {
    onMessage: async (event, ws) => {
      try {
        if (typeof event.data !== "string") return;
        let msg: SocketMsg;
        try {
          msg = JSON.parse(event.data) as SocketMsg;
        } catch {
          return;
        }

        const isRun = msg.type === "compile" || msg.type === "run";
        if (isRun) {
          if (typeof msg.code !== "string") {
            send(ws, { type: "error", message: "Missing 'code'" });
            await close(ws, 4000);
            return;
          }
          // js-dos 100% cliente: indicar fallback inmediato para que el frontend use js-dos
          // Sin esperar DOSBox headless (evita timeout 10s). Si ENABLE_DOSBOX_HEADLESS=1 y headless disponible, usar captura.
          if (!isAsmHeadlessAvailable()) {
            send(ws, {
              type: "error",
              message: "ASM headless disabled - use client js-dos (POST /api/compile/run -> exeBase64)",
              fallback: true,
            });
            await close(ws, 4000);
            return;
          }

          log.debug("ASM headless enabled via ENABLE_DOSBOX_HEADLESS=1 - running DOSBox capture");
          send(ws, { type: "ready" });

          const watchdog = setTimeout(() => {
            log.warn("ASM session watchdog: timeout");
            send(ws, { type: "error", message: "Program timed out" });
            void close(ws, 4000);
          }, ASM_SESSION_TIMEOUT_MS + 2000);

          try {
            const result = await compileAndRunAsmCaptured(msg.code);
            clearTimeout(watchdog);

            if (!result.success) {
              const message = result.error || result.stderr || "Execution failed";
              const isFallback = message.includes("DOSBox not available");
              send(ws, { type: "error", message, fallback: isFallback });
              await close(ws, 4000);
              return;
            }

            if (result.stdout) {
              send(ws, { type: "output", stream: "stdout", data: result.stdout });
            }
            if (result.stderr) {
              send(ws, { type: "output", stream: "stderr", data: result.stderr });
            }
            send(ws, { type: "exit", code: result.exitCode ?? 0 });
            await close(ws, 1000);
          } catch (err) {
            clearTimeout(watchdog);
            const message = err instanceof Error ? err.message : "Internal error";
            log.warn(`ASM WS error: ${message}`);
            send(ws, { type: "error", message });
            await close(ws, 4000);
          }
        } else if (msg.type === "input") {
          send(ws, { type: "error", message: "Input not supported for ASM (output-only mode)" });
        }
      } catch (err) {
        log.error("ASM session handler error", err);
        send(ws, {
          type: "error",
          message: err instanceof Error ? err.message : "Internal error",
        });
        await close(ws, 4000);
      }
    },

    onError: () => {
      void cleanup();
    },

    onClose: () => {
      void cleanup();
    },
  };
}));

// POST fallback for non-WS clients (simple run, output-only)
// js-dos 100% cliente: por defecto retorna fallback:true para que cliente use /api/compile/run (exeBase64 + js-dos)
asmSessionRouter.post("/run", async (c) => {
  let payload: { code?: string } = {};
  try {
    payload = (await c.req.json()) as { code?: string };
  } catch {
    return c.json({ success: false, error: "Invalid JSON" }, 400);
  }
  const code = payload.code;
  if (!code) {
    return c.json({ success: false, error: "Missing 'code'" }, 400);
  }

  if (!isAsmHeadlessAvailable()) {
    return c.json(
      {
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        error: "ASM headless disabled - use client js-dos (POST /api/compile/run -> exeBase64).",
        fallback: true,
      },
      501,
    );
  }

  try {
    const result = await compileAndRunAsmCaptured(code);
    return c.json({
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      error: result.error,
    });
  } catch (err) {
    return c.json(
      {
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        error: err instanceof Error ? err.message : "Internal error",
      },
      500,
    );
  }
});

asmSessionRouter.get("/capabilities", (c) => {
  return c.json({
    headless: isAsmHeadlessAvailable(),
    timeoutMs: ASM_SESSION_TIMEOUT_MS,
  });
});

export { asmSessionRouter };
