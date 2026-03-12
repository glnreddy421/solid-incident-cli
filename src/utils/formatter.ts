/**
 * Terminal formatters: headers, timeline, signals, summary.
 * Uses chalk when colors enabled; plain text when --no-color.
 */

import chalk from "chalk";
import type { ParsedEvent, Signal, IncidentSummary, Severity } from "./types.js";
import { formatTimestampForDisplay } from "./parser.js";

export type ColorMode = "on" | "off";

function severityColor(severity: Severity, colors: ColorMode): (s: string) => string {
  if (colors === "off") return (s) => s;
  switch (severity) {
    case "critical":
      return chalk.red;
    case "error":
      return chalk.red;
    case "warning":
      return chalk.yellow;
    case "info":
      return chalk.cyan;
    case "debug":
      return chalk.gray;
    default:
      return (s) => s;
  }
}

export function formatHeader(title: string, colors: ColorMode): string {
  if (colors === "off") return `\n${title}\n${"=".repeat(50)}\n`;
  return `\n${chalk.bold(title)}\n${chalk.gray("=".repeat(50))}\n`;
}

export function formatSubHeader(title: string, colors: ColorMode): string {
  if (colors === "off") return `\n${title}\n${"-".repeat(50)}\n`;
  return `\n${chalk.bold(title)}\n${chalk.gray("-".repeat(50))}\n`;
}

export function formatTimelineRow(event: ParsedEvent, colors: ColorMode): string {
  const time = formatTimestampForDisplay(event.timestamp);
  const colorFn = severityColor(event.severity, colors);
  const service = event.component ? `${event.service}/${event.component}` : event.service;
  const timePart = colors === "on" ? chalk.gray(time) : time;
  const servicePart = colors === "on" ? chalk.blue(service) : service;
  const sevPart = colorFn(`[${event.severity}]`);
  return `${timePart}  ${servicePart.padEnd(24)} ${sevPart.padEnd(10)} ${event.message}`;
}

export function formatSignal(signal: Signal, colors: ColorMode): string {
  const icon = signal.severity === "critical" || signal.severity === "error" ? "⚠" : "•";
  const colorFn = severityColor(signal.severity, colors);
  const head = colorFn(`${icon} ${signal.label}`);
  const desc = signal.description ? `\n  ${signal.description}` : "";
  const count = signal.count != null ? ` (${signal.count}x)` : "";
  return `${head}${count}${desc}`;
}

export function formatSummaryBlock(summary: IncidentSummary, colors: ColorMode): string {
  const lines: string[] = [];
  lines.push(summary.whatHappened);
  lines.push("");
  lines.push(`Confidence: ${summary.confidence}%`);
  return lines.join("\n");
}

export function formatRootCause(summary: IncidentSummary, colors: ColorMode): string {
  const text = summary.likelyRootCause;
  const confidence = colors === "on" ? chalk.gray(`Confidence: ${summary.confidence}%`) : `Confidence: ${summary.confidence}%`;
  return `${text}\n\n${confidence}`;
}

export function formatImpactedServices(services: string[], colors: ColorMode): string {
  return services.map((s) => `- ${colors === "on" ? chalk.blue(s) : s}`).join("\n");
}

export function formatNextSteps(steps: string[]): string {
  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

export function formatSuccess(message: string, colors: ColorMode): string {
  if (colors === "off") return `✔ ${message}`;
  return chalk.green("✔") + " " + message;
}

export function formatError(message: string, colors: ColorMode): string {
  if (colors === "off") return `✖ ${message}`;
  return chalk.red("✖") + " " + message;
}

export function formatInfo(message: string, colors: ColorMode): string {
  if (colors === "off") return message;
  return chalk.cyan(message);
}

export function formatPrivacy(colors: ColorMode): string {
  const text = "Logs are processed ephemerally in this CLI prototype. No persistence enabled.";
  if (colors === "off") return text;
  return chalk.gray(text);
}

export function formatBanner(colors: ColorMode): string {
  const title = "SOLID CLI";
  const tagline = "Turn messy logs into incident timelines.";
  if (colors === "off") return `\n${title}\n${tagline}\n`;
  return `\n${chalk.bold(title)}\n${chalk.gray(tagline)}\n`;
}
