import type { EnrichmentStyle } from "../types.js";

export const STYLE_INSTRUCTIONS: Record<EnrichmentStyle, string> = {
  briefing: [
    "**Operator briefing (interpretation only):** The structured JSON payload is the source of truth — already analyzed by the engine.",
    "Write for a tired on-call engineer: what happened, why it matters, what to do next, and what to verify.",
    "Use short paragraphs and bullet lists; conversational tone (Slack / pager handoff).",
    "Do NOT output a formal report title like 'Root Cause Analysis (RCA) Report' or ASCII section dividers (e.g. 'Summary ------------').",
    "Do NOT paste the full hypothesis list as prose — summarize the top 1–2 themes; stay concise.",
    "Explicit sections to cover (plain headings ok): What we know · What probably broke · Next steps · Questions to close gaps.",
  ].join(" "),
  rca: [
    "**Formal RCA memo (explicit style request only):** Still grounded only in the payload.",
    "Output sections: Root Cause Hypotheses, Supporting Evidence, Caveats, Next Checks.",
    "Number Next Checks sequentially (1, 2, 3…) with no duplicates.",
  ].join(" "),
  executive: [
    "Produce an executive summary focused on impact, risk, confidence, and immediate actions.",
    "Output sections: Incident Summary, Business Impact, Risk and Confidence, Recommended Actions.",
  ].join(" "),
  runbook: [
    "Produce an actionable runbook grounded only in supplied evidence.",
    "Output sections: Preconditions, Immediate Actions, Verification Steps, Rollback/Fallback.",
  ].join(" "),
  star: [
    "Produce a STAR interview narrative (Situation, Task, Action, Result).",
    "Each section must reference payload evidence and confidence limits.",
  ].join(" "),
  car: [
    "Produce a CAR interview narrative (Context, Action, Result).",
    "Each section must reference payload evidence and confidence limits.",
  ].join(" "),
  debug: [
    "Produce a technical debugging breakdown with hypothesis-driven reasoning.",
    "Output sections: Observations, Working Hypotheses, Discriminating Checks, Debug Plan.",
  ].join(" "),
  questions: [
    "Produce follow-up investigation questions only.",
    "Output sections: Questions to Validate Hypothesis, Missing Data, Logs/Metrics to Collect Next.",
  ].join(" "),
};
