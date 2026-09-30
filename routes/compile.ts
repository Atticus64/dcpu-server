import { Hono } from "hono";
import { compileAssembly, compileAssemblyRun } from "../sandbox/assembly.ts";
import { compileC } from "../sandbox/c.ts";
import { log } from "../lib/logger.ts";

const compileRouter = new Hono();

compileRouter.post("/", async (c) => {
  const { code, language } = await c.req.json<{ code: string; language: string }>();

  if (!code || !language) {
    return c.json({ error: "Missing 'code' or 'language'" }, 400);
  }

  log.debug(`Compile request: language=${language}, code.length=${code.length}`);

  try {
    const start = Date.now();
    let result;
    if (language === "assembly") {
      result = await compileAssembly(code);
    } else if (language === "c") {
      result = await compileC(code);
    } else {
      return c.json({ error: `Unsupported language: ${language}` }, 400);
    }

    const ms = Date.now() - start;
    log.debug(`Compile result: language=${language}, success=${result.success}, duration=${ms}ms`);
    if (!result.success) {
      log.warn(`Compilation failed: language=${language}`, (result as { error: string }).error);
    }

    return c.json(result);
  } catch (err) {
    log.error(`Compile error: language=${language}`, err);
    return c.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      500,
    );
  }
});

compileRouter.post("/run", async (c) => {
  const { code, language } = await c.req.json<{ code: string; language: string }>();

  if (!code || !language) {
    return c.json({ error: "Missing 'code' or 'language'" }, 400);
  }

  log.debug(`Compile+run request: language=${language}, code.length=${code.length}`);

  try {
    const start = Date.now();
    let result;
    if (language === "assembly") {
      result = await compileAssemblyRun(code);
    } else {
      return c.json({ error: `Unsupported language: ${language}` }, 400);
    }

    const ms = Date.now() - start;
    log.debug(`Compile+run result: language=${language}, success=${result.success}, duration=${ms}ms`);
    if (!result.success) {
      log.warn(`Compile+run failed: language=${language}`, (result as { error: string }).error);
    }

    return c.json(result);
  } catch (err) {
    log.error(`Compile+run error: language=${language}`, err);
    return c.json(
      {
        success: false,
        exeBase64: null,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      500,
    );
  }
});

export { compileRouter };
