/**
 * An error the developer can act on: what went wrong in plain words, and
 * what to do about it. Anything else is a bug and is shown with --debug.
 */
export class WizardError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "WizardError";
  }
}

/** The developer pressed Ctrl+C or chose Cancel. Exits quietly. */
export class CancelledError extends WizardError {
  constructor() {
    super("Cancelled. Nothing more was changed.", undefined, 130);
    this.name = "CancelledError";
  }
}
