/**
 * `@nerdstackgrp/nex-js/react` -- report React render errors to Nex.
 *
 * ```tsx
 * <ErrorBoundary fallback={({ reset }) => <button onClick={reset}>Try again</button>}>
 *   <App />
 * </ErrorBoundary>
 * ```
 *
 * React 19 can also report every error at the root:
 * `createRoot(el, { onUncaughtError: reactErrorHandler(), onCaughtError: reactErrorHandler() })`.
 *
 * Needs `init()` from `@nerdstackgrp/nex-js/client` first.
 */

import { Component, createElement, type ErrorInfo, type ReactNode } from "react";
import { captureException } from "../client/index";

export type FallbackProps = { error: unknown; reset: () => void };

export type ErrorBoundaryProps = {
  children?: ReactNode;
  /** What to show instead of the crashed tree. */
  fallback?: ReactNode | ((props: FallbackProps) => ReactNode);
  /** Tags on the reported error, e.g. `{ section: "checkout" }`. */
  tags?: Record<string, string | number | boolean>;
  onError?: (error: unknown, info: ErrorInfo) => void;
};

type State = { error: unknown; failed: boolean };

/** The component stack, minus the noise of very deep trees. */
function componentStack(info: { componentStack?: string | null }): string | undefined {
  return info.componentStack ? info.componentStack.trim().split("\n").slice(0, 30).join("\n") : undefined;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const stack = componentStack(info);
    captureException(error, { mechanism: "react.errorBoundary", handled: true, tags: this.props.tags, extra: stack ? { componentStack: stack } : undefined });
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null, failed: false });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children ?? null;
    const { fallback } = this.props;
    if (typeof fallback === "function") return fallback({ error: this.state.error, reset: this.reset });
    return fallback ?? createElement("div", { role: "alert" }, "Something went wrong.");
  }
}

/** For React 19 root options: `onUncaughtError`, `onCaughtError`, `onRecoverableError`. */
export function reactErrorHandler(callback?: (error: unknown, info: { componentStack?: string }) => void) {
  return (error: unknown, info: { componentStack?: string }) => {
    const stack = componentStack(info);
    captureException(error, { mechanism: "react.root", handled: false, extra: stack ? { componentStack: stack } : undefined });
    callback?.(error, info);
  };
}
