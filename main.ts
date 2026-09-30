import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { createApp } from "./app.ts";
import { log } from "./lib/logger.ts";

const app = createApp();

const PORT = Number(process.env.PORT || "3001");
const wss = new WebSocketServer({ noServer: true });

log.info(`Starting server on port ${PORT}`);
log.debug(`Tools dir: ${import.meta.dirname}`);

serve({ fetch: app.fetch, port: PORT, websocket: { server: wss } });
