#!/usr/bin/env node
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { runProgram } from "./cli/commands.js";

function resolveCliVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = resolve(here, "../package.json");
    const packageJsonRaw = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(packageJsonRaw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const VERSION = resolveCliVersion();

const exitCode = await runProgram(VERSION);
if (exitCode !== 0) {
  process.exit(exitCode);
}
