export type ErrorCode =
  | "NO_INPUT"
  | "EMPTY_INPUT"
  | "INVALID_FILE_PATH"
  | "MALFORMED_LOG"
  | "PARSER_FAILURE"
  | "ENGINE_FAILURE"
  | "SCHEMA_FAILURE"
  | "BACKEND_UNAVAILABLE"
  | "BACKEND_MALFORMED_RESPONSE"
  | "BACKEND_TIMEOUT"
  | "INVALID_FLAGS"
  | "UNSUPPORTED_MODE_COMBINATION"
  | "TUI_INIT_FAILURE"
  | "TERMINAL_CAPABILITY_UNSUPPORTED"
  | "STREAM_INTERRUPTION";

export class SolidError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public options: {
      recoverable: boolean;
      details?: string;
      cause?: unknown;
    } = { recoverable: false }
  ) {
    super(message);
    this.name = "SolidError";
  }
}

export class InputError extends SolidError {
  constructor(code: "NO_INPUT" | "EMPTY_INPUT" | "INVALID_FILE_PATH" | "MALFORMED_LOG", message: string, details?: string) {
    super(code, message, { recoverable: true, details });
    this.name = "InputError";
  }
}

export class ModeError extends SolidError {
  constructor(code: "INVALID_FLAGS" | "UNSUPPORTED_MODE_COMBINATION", message: string, details?: string) {
    super(code, message, { recoverable: true, details });
    this.name = "ModeError";
  }
}

export class TuiInitError extends SolidError {
  constructor(message: string, details?: string, cause?: unknown) {
    super("TUI_INIT_FAILURE", message, { recoverable: true, details, cause });
    this.name = "TuiInitError";
  }
}

export class BackendUnavailableError extends SolidError {
  constructor(message: string, details?: string, cause?: unknown) {
    super("BACKEND_UNAVAILABLE", message, { recoverable: true, details, cause });
    this.name = "BackendUnavailableError";
  }
}

export class BackendMalformedResponseError extends SolidError {
  constructor(message: string, details?: string, cause?: unknown) {
    super("BACKEND_MALFORMED_RESPONSE", message, { recoverable: true, details, cause });
    this.name = "BackendMalformedResponseError";
  }
}

