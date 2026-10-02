/** What is known about the moment an error happens, on the server and in the browser. */

export type BreadcrumbLevel = "debug" | "info" | "warning" | "error" | "fatal";

export type Breadcrumb = {
  /** ISO time; filled in when omitted. */
  timestamp?: string;
  /** "http", "navigation", "query", "default"… */
  type?: string;
  /** "console", "fetch", "http", "db"… */
  category?: string;
  level?: BreadcrumbLevel;
  message?: string;
  data?: Record<string, unknown>;
};

export type MonitoringUser = { id?: string | number; username?: string; email?: string };

export type RequestInfo = { method?: string; url?: string; route?: string; status?: number; userAgent?: string };
