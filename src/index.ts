#!/usr/bin/env node
/**
 * solid-incident-cli — Turn messy logs into incident timelines.
 * Copyright (c) 2025 glnreddy421. MIT License.
 * Commands: analyze, stream, report.
 * Future commands (not implemented): replay, explain, export.
 */

import { Command } from "commander";
import { VERSION, CLI_NAME, CLI_DESCRIPTION } from "./utils/constants.js";
import { registerAnalyze } from "./commands/analyze.js";
import { registerStream } from "./commands/stream.js";
import { registerReport } from "./commands/report.js";
import { formatBanner } from "./utils/formatter.js";

const program = new Command();

program
  .name(CLI_NAME)
  .description(CLI_DESCRIPTION)
  .version(VERSION, "-V, --version", "Display version")
  .helpOption("-h, --help", "Display help")
  .option("--no-color", "Disable colored output globally")
  .addHelpText("after", `
Examples:
  solid analyze logs.txt
  solid analyze logs.txt --open-web
  solid analyze api.log worker.log redis.log db.log
  kubectl logs pod | solid analyze --open-web
  solid analyze ./samples/payment.log
  kubectl logs -f payment-service | solid stream
  solid analyze logs.txt --report
  solid analyze logs.txt --report markdown
  cat logs.txt | solid analyze --report json
  solid report logs.txt --output rca.md
  solid report logs.txt --json --output report.json

Future commands (not yet implemented):
  solid replay    Replay or re-analyze from a saved session
  solid explain    Explain a specific log line or pattern
  solid export     Export to external formats or systems
`);

registerAnalyze(program, { noColor: false });
registerStream(program, { noColor: false });
registerReport(program, { noColor: false });

program.parse();

if (process.argv.length <= 2) {
  const noColor = program.opts().color === false;
  const colorMode = noColor ? "off" : "on";
  console.log(formatBanner(colorMode));
  program.outputHelp();
}
