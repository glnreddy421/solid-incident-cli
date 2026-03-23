import type { AnalysisResult } from "../../contracts/index.js";
import { timelineIntro, stateFooterNote } from "../state/analysisState.js";
import type { TemplateContext } from "../types.js";

export function buildTimelineSections(result: AnalysisResult, ctx: TemplateContext): Record<string, string> {
  const st = ctx.state;
  const sections: Record<string, string> = {};
  const sorted = [...result.timeline].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const lines: string[] = [];

  const verb = (sev: string) =>
    st === "final" ? (sev === "error" || sev === "critical" ? "reported" : "logged") : "appears to show";

  let prevTs = "";
  for (const e of sorted.slice(0, 40)) {
    const t = e.timestamp;
    const timeRef =
      st === "final"
        ? t === prevTs
          ? "Shortly afterward,"
          : `At **${t}**,`
        : t === prevTs
          ? "Shortly afterward,"
          : `At **${t}**,`;
    prevTs = t;
    lines.push(`${timeRef} **${e.service}** ${verb(e.severity)}: ${e.message.slice(0, 200)}${e.message.length > 200 ? "…" : ""}`);
  }

  sections.narrative = [
    `**${timelineIntro(st)}**`,
    "",
    lines.length ? lines.join("\n\n") : "—",
  ].join("\n");

  const foot = stateFooterNote(st);
  if (foot) sections.footer = foot;

  return sections;
}
