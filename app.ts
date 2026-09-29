import { Hono } from "hono";
import { cors } from "hono/cors";
import { compileRouter } from "./routes/compile.ts";
import { cSessionRouter } from "./routes/c-session.ts";
import { asmSessionRouter } from "./routes/asm-session.ts";
import { isAsmHeadlessAvailable } from "./sandbox/assembly.ts";
import { log } from "./lib/logger.ts";

export function createApp(): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    log.info(`${c.req.method} ${new URL(c.req.url).pathname} ${c.res.status} ${ms}ms`);
  });

  app.route("/api/compile/asm", asmSessionRouter);
  app.route("/api/compile/c", cSessionRouter);
  app.route("/api/compile", compileRouter);

  app.get("/api/health", (c) => {
    return c.json({ status: "ok", capabilities: { asmHeadless: isAsmHeadlessAvailable() } });
  });

  app.notFound((c) => c.json({ success: false, error: `Not found: ${c.req.path}` }, 404));

  app.onError((err, c) => {
    log.error(`Unhandled error on ${c.req.path}`, err);
    return c.json({ success: false, error: "Internal server error" }, 500);
  });

  return app;
}
