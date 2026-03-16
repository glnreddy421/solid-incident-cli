#!/usr/bin/env node
/**
 * Order Service - depends on auth for token validation.
 */

const log = (level, msg, extra = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    service: "order-service",
    ...extra,
  };
  console.log(JSON.stringify(entry));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  log("info", "order-service started", { port: 3002 });

  const server = require("http").createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200);
      res.end("ok");
    }
  });
  server.listen(3002, () => log("info", "listening on 3002"));

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const res = await fetch("http://auth-service:3001/health", { signal: AbortSignal.timeout(1000) });
      if (res.ok) log("info", "auth check ok");
    } catch (e) {
      const cause = e.cause || e;
      const msg = (cause.message || e.message || String(e)).toLowerCase();
      const code = cause.code || "";
      if (/refused|econnrefused|connection refused/i.test(msg) || code === "ECONNREFUSED") {
        log("error", "connection refused to auth-service", { attempt, error: "connect: connection refused" });
      } else if (/timeout|etimedout|deadline exceeded/i.test(msg) || code === "ETIMEDOUT") {
        log("warn", "timeout connecting to auth-service", { attempt });
      }
    }
    await sleep(2000);
  }
}

main().catch((e) => {
  log("critical", "order-service failed", { error: e.message });
  process.exit(1);
});
