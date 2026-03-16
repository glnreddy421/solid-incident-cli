#!/usr/bin/env node
/**
 * Auth Service - dependency that will fail/crash to trigger cascade.
 */

const log = (level, msg, extra = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    service: "auth-service",
    ...extra,
  };
  console.log(JSON.stringify(entry));
};

const CRASH_AFTER_MS = Number(process.env.CRASH_AFTER_MS || 3000);

async function main() {
  log("info", "auth-service started", { port: 3001 });

  const server = require("http").createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200);
      res.end("ok");
    }
  });
  server.listen(3001, () => log("info", "listening on 3001"));

  if (CRASH_AFTER_MS > 0) {
    setTimeout(() => {
      log("critical", "auth-service crashloop: intentional failure for demo", { reason: "back-off" });
      log("error", "fatal: shutting down");
      process.exit(1);
    }, CRASH_AFTER_MS);
  }
}

main().catch((e) => {
  log("critical", "auth-service panic", { error: e.message });
  process.exit(1);
});
