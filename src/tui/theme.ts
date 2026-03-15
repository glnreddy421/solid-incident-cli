export interface TuiTheme {
  enabled: boolean;
  reset: string;
  bold: string;
  dim: string;
  muted: string;
  primary: string;
  accent: string;
  amber: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  trigger: string;
  panelActive: string;
}

function supportsColor(): boolean {
  if (process.env.NO_COLOR === "1") return false;
  if (process.env.FORCE_COLOR === "1") return true;
  if (process.stdout.isTTY !== true) return false;
  const term = process.env.TERM ?? "";
  return term !== "" && term !== "dumb";
}

export function createTheme(): TuiTheme {
  const enabled = supportsColor();
  const esc = (code: string) => (enabled ? `\u001b[${code}m` : "");
  return {
    enabled,
    reset: esc("0"),
    bold: esc("1"),
    dim: esc("2"),
    muted: esc("90"),
    primary: esc("36"),
    accent: esc("35"),
    amber: esc("38;5;214"),
    success: esc("32"),
    warning: esc("33"),
    danger: esc("31"),
    info: esc("34"),
    trigger: esc("96"),
    panelActive: esc("30;46"),
  };
}

export function paint(theme: TuiTheme, text: string, ...styles: string[]): string {
  if (!theme.enabled || styles.length === 0) return text;
  return `${styles.join("")}${text}${theme.reset}`;
}

