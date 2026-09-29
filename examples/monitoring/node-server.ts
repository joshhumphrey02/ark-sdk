/**
 * A Node (or Bun) API reporting to Nerdstack Monitoring.
 *
 *   MONITORING_URL=https://nerdstackgrp.com \
 *   MONITORING_TOKEN=nsk_live_… \
 *   MONITORING_SERVICE=ark-api \
 *   APP_VERSION=2.4.1 \
 *   node --experimental-strip-types node-server.ts
 *
 * The same code runs under Bun (`bun node-server.ts`).
 */

import http from "node:http";
import { createMonitoring } from "@nerdstackgrp/monitoring";

// Everything else comes from MONITORING_* and APP_VERSION.
const monitoring = createMonitoring({
  checks: {
    // Replace with real probes: db.query("SELECT 1"), redis.ping(), …
    database: async () => true,
  },
});

monitoring.setContext({ region: process.env.REGION ?? "eu-west", instance: process.env.HOSTNAME });

const server = http.createServer(async (req, res) => {
  const requestId = req.headers["x-request-id"]?.toString() ?? crypto.randomUUID();
  try {
    if (req.url === "/orders" && req.method === "POST") {
      const order = await placeOrder();
      monitoring.track("order.placed", { orderId: order.id }, { requestId });
      res.writeHead(201, { "content-type": "application/json" });
      return res.end(JSON.stringify(order));
    }
    res.writeHead(404).end();
  } catch (error) {
    // Reported, then handled as the application normally would.
    monitoring.captureException(error, { requestId, metadata: { path: req.url } });
    res.writeHead(500).end();
  }
});

// Per-route timings, 5xx and slow requests. No headers, bodies or query strings.
monitoring.instrumentHttp(server);

server.listen(Number(process.env.PORT ?? 3000), async () => {
  // Heartbeats every 30s, plus reporting of fatal errors (the process still
  // crashes as usual afterwards).
  monitoring.start({ captureUnhandled: true });
  // Record the deploy once per boot; Nerdstack keeps the previous version.
  await monitoring.reportRelease();
});

// Let in-flight reports go out on a planned shutdown (bounded to 2s).
process.on("SIGTERM", async () => {
  server.close();
  await monitoring.stop();
  process.exit(0);
});

async function placeOrder() {
  return { id: crypto.randomUUID(), status: "placed" };
}
