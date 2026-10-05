/** Structured AXI error. Rendered to stdout; exit code 1 (runtime) or 2 (usage). */
export class AxiError extends Error {
  readonly code: string;
  readonly help: string[];
  readonly exitCode: number;
  constructor(message: string, code = "ERROR", help: string[] = [], exitCode = 1) {
    super(message);
    this.code = code;
    this.help = help;
    this.exitCode = exitCode;
  }
}

/** Unknown command, unknown flag, unknown field, missing flag value: exit 2. */
export class UsageError extends AxiError {
  constructor(message: string, help: string[] = [], code = "USAGE") {
    super(message, code, help, 2);
  }
}
