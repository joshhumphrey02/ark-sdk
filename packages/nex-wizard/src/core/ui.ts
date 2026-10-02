import * as clack from "@clack/prompts";
import pc from "picocolors";
import { CancelledError } from "./errors";

export type Choice<T> = { value: T; label: string; hint?: string };

/**
 * Everything the wizard says and asks goes through this, so commands are
 * testable with a scripted UI and output stays consistent.
 */
export interface UI {
  readonly interactive: boolean;
  intro(title: string): void;
  outro(message: string): void;
  step(message: string): void;
  success(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  note(body: string, title?: string): void;
  spinner(message: string): Spinner;
  select<T>(message: string, choices: Choice<T>[], initial?: T): Promise<T>;
  search<T>(message: string, choices: Choice<T>[]): Promise<T>;
  confirm(message: string, initial?: boolean): Promise<boolean>;
  text(message: string, options?: { initial?: string; placeholder?: string; validate?: (value: string) => string | undefined }): Promise<string>;
}

export type Spinner = { stop(message: string): void; fail(message: string): void; message(text: string): void };

function unwrap<T>(value: T): Exclude<T, symbol> {
  if (clack.isCancel(value)) throw new CancelledError();
  return value as Exclude<T, symbol>;
}

export function terminalUI(options: { interactive: boolean; debug?: boolean }): UI {
  return {
    interactive: options.interactive,
    intro: (title) => clack.intro(pc.bgCyan(pc.black(` ${title} `))),
    outro: (message) => clack.outro(message),
    step: (message) => clack.log.step(message),
    success: (message) => clack.log.success(message),
    info: (message) => clack.log.info(message),
    warn: (message) => clack.log.warn(message),
    error: (message) => clack.log.error(message),
    note: (body, title) => clack.note(body, title),
    spinner(message) {
      const s = clack.spinner();
      s.start(message);
      return { stop: (m) => s.stop(m), fail: (m) => s.error(m), message: (m) => s.message(m) };
    },
    async select<T>(message: string, choices: Choice<T>[], initial?: T): Promise<T> {
      return unwrap(await clack.select<T>({ message, options: choices as never, initialValue: initial })) as T;
    },
    async search(message, choices) {
      if (choices.length <= 10) return this.select(message, choices);
      return unwrap(await clack.autocomplete({ message, options: choices as never, maxItems: 10 })) as never;
    },
    async confirm(message, initial = true) {
      return unwrap(await clack.confirm({ message, initialValue: initial }));
    },
    async text(message, opts = {}) {
      return unwrap(
        await clack.text({
          message,
          initialValue: opts.initial,
          placeholder: opts.placeholder,
          validate: opts.validate ? (value) => opts.validate!(value ?? "") : undefined,
        }),
      );
    },
  };
}

export const color = pc;
