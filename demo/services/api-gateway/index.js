#!/usr/bin/env node
/**
 * API Gateway - routes requests to auth, order, payment services.
 * Logs in JSON format for solidx parser.
 */

const log = (level, msg, extra = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    service: "api-gateway",
    ...extra,
  };
  console.log(JSON.stringify(entry));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callService(name, port) {
  try {
    const res = await fetch(`http://${name}:${port}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch (e) {
    throw e;
  }
}

async function main() {
  log("info", "api-gateway started", { port: 3000 });

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await callService("auth-service", 3001);
      log("info", "auth check ok");
    } catch (e) {
      const cause = e.cause || e;
      const msg = (cause.message || e.message || String(e)).toLowerCase();
      const code = cause.code || "";
      if (/refused|econnrefused|connection refused/i.test(msg) || code === "ECONNREFUSED") {
        log("error", "connection refused to auth-service:3001", { attempt, error: "connect: connection refused" });
      } else if (/timeout|etimedout|deadline exceeded/i.test(msg) || code === "ETIMEDOUT") {
        log("error", "timeout connecting to auth-service", { attempt, error: "deadline exceeded" });
      } else {
        log("error", `failed to reach auth-service: connect: connection refused`, { attempt });
      }
    }

    try {
      await callService("order-service", 3002);
      log("info", "order-service check ok");
    } catch (e) {
      const msg = e.message || String(e);
      if (/refused|ECONNREFUSED/i.test(msg)) {
        log("warn", "connection refused to order-service:3002", { attempt });
      } else {
        log("warn", "order-service unreachable", { error: msg });
      }
    }

    try {
      await callService("payment-service", 3003);
      log("info", "payment-service check ok");
    } catch (e) {
      const msg = e.message || String(e);
      if (/refused|ECONNREFUSED/i.test(msg)) {
        log("warn", "connection refused to payment-service:3003", { attempt });
      }
    }

    await sleep(1500);
  }
}

main().catch((e) => {
  log("critical", "api-gateway crashed", { error: e.message });
  process.exit(1);
});
