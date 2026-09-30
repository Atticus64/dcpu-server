import { once } from "node:events";
import { finished } from "node:stream/promises";
import type { Readable } from "node:stream";
import { upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { cleanupCSession, compileCToExe, SESSION_TIMEOUT_MS, type CSession } from "../sandbox/c.ts";
import { log } from "../lib/logger.ts";

const cSessionRouter = new Hono();

const WS_OPEN = 1;

interface SocketMsg {
  type: string;
  code?: string;
  data?: string;
}

cSessionRouter.get("/ws", upgradeWebSocket(() => {
  let session: CSession | null = null;
  let cleanedUp = false;
  let stdinOpen = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const drains: Promise<unknown>[] = [];

  const send = (ws: WSContext, msg: Record<string, unknown>) => {
    if (ws.readyState === WS_OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (watchdog) clearTimeout(watchdog);
    if (session) await cleanupCSession(session);
    stdinOpen = false;
    session = null;
  };

  const close = async (ws: WSContext, code = 1000) => {
    await cleanup();
    if (ws.readyState === WS_OPEN) {
      ws.close(code);
    }
  };

  const pipeOutput = (ws: WSContext, stream: Readable, source: "stdout" | "stderr") => {
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      send(ws, { type: "output", stream: source, data: chunk });
    });
    stream.on("error", () => {
      void cleanup();
    });
    drains.push(finished(stream).catch(() => {}));
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

        if (msg.type === "compile" && !session) {
          if (typeof msg.code !== "string") {
            send(ws, { type: "error", message: "Missing 'code'" });
            await close(ws, 4000);
            return;
          }

          try {
            session = await compileCToExe(msg.code);
          } catch (err) {
            log.warn(`C session compile failed: ${err}`);
            send(ws, { type: "error", message: err instanceof Error ? err.message : "Compilation failed" });
            await close(ws, 4000);
            return;
          }

          send(ws, { type: "ready" });

          const proc = session.proc;
          pipeOutput(ws, proc.stdout, "stdout");
          pipeOutput(ws, proc.stderr, "stderr");

          stdinOpen = true;

          watchdog = setTimeout(() => {
            log.warn("C session watchdog: killing process after timeout");
            send(ws, { type: "error", message: "Program timed out" });
            void close(ws, 4000);
          }, SESSION_TIMEOUT_MS);

          void once(proc, "close").then(
            async ([code]) => {
              if (watchdog) clearTimeout(watchdog);
              stdinOpen = false;
              proc.stdin.end();
              await Promise.all(drains);
              send(ws, { type: "exit", code });
              await close(ws, 1000);
            },
            (err: unknown) => {
              log.warn(`C session process error: ${err}`);
              void close(ws, 4000);
            },
          );
        } else if (msg.type === "input" && stdinOpen && typeof msg.data === "string" && session) {
          try {
            session.proc.stdin.write(msg.data);
          } catch {
            // ignore
          }
        }
      } catch (err) {
        log.error("C session handler error", err);
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

export { cSessionRouter };
