export type { RenderReportOptions, RenderedReport, ReportState, ReportStyle, TemplateContext } from "./types.js";
export { renderReport, heuristicKindToStyle } from "./renderReport.js";
export { resolveReportState, stateBannerTitle, stateFooterNote } from "./state/analysisState.js";
export { polishReportMarkdown } from "./nlp/cleanupText.js";
