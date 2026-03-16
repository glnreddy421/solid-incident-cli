export interface TimestampParseResult {
  timestamp: string;
  timestampSource: string;
  timezoneAssumed?: string;
  timestampInferred?: boolean;
}

const ISO_REGEX = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/;
const BRACKETED_ISO_REGEX = /^\[(\d{4}-\d{2}-\d{2}[T ][^\]]+)\]/;
const SYSLOG_TS_REGEX = /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})$/;

function normalizeIso(value: string): TimestampParseResult {
  const t = value.replace(" ", "T");
  if (/Z|[+-]\d{2}:?\d{2}$/.test(t)) {
    return {
      timestamp: t,
      timestampSource: "iso8601",
      timestampInferred: false,
    };
  }
  return {
    timestamp: `${t}Z`,
    timestampSource: "iso8601",
    timezoneAssumed: "UTC",
    timestampInferred: true,
  };
}

export function parseTimestamp(value?: string): TimestampParseResult | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  const bracketedIso = raw.match(BRACKETED_ISO_REGEX);
  if (bracketedIso?.[1]) return normalizeIso(bracketedIso[1]);

  const isoMatch = raw.match(ISO_REGEX);
  if (isoMatch?.[1]) return normalizeIso(isoMatch[1]);

  if (/^\d{10}$/.test(raw)) {
    const ms = Number(raw) * 1000;
    const d = new Date(ms);
    if (Number.isFinite(d.getTime())) {
      return {
        timestamp: d.toISOString(),
        timestampSource: "epoch_seconds",
        timezoneAssumed: "UTC",
      };
    }
  }

  if (/^\d{13}$/.test(raw)) {
    const ms = Number(raw);
    const d = new Date(ms);
    if (Number.isFinite(d.getTime())) {
      return {
        timestamp: d.toISOString(),
        timestampSource: "epoch_milliseconds",
        timezoneAssumed: "UTC",
      };
    }
  }

  const syslogMatch = raw.match(SYSLOG_TS_REGEX);
  if (syslogMatch?.[1]) {
    const currentYear = new Date().getUTCFullYear();
    const parsed = new Date(`${syslogMatch[1]} ${currentYear}`);
    if (Number.isFinite(parsed.getTime())) {
      return {
        timestamp: parsed.toISOString(),
        timestampSource: "syslog-rfc3164",
        timezoneAssumed: "local->UTC",
        timestampInferred: true,
      };
    }
  }

  return null;
}

