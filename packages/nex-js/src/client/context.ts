/**
 * Where a browser error happened: browser, operating system, device and
 * page. Worked out from what the browser exposes, without fingerprinting
 * (no canvas, fonts or plugin lists) and without the query string, which can
 * carry tokens.
 */

import { truncate } from "../shared/redact";
import type { JsonObject } from "../shared/types";

type NameVersion = { name: string; version?: string };

/** Browser from the user agent. Order matters: Edge and Opera also say "Chrome". */
export function parseBrowser(ua: string): NameVersion {
  const tests: [string, RegExp][] = [
    ["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ["Opera", /(?:OPR|Opera)\/([\d.]+)/],
    ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ];
  for (const [name, pattern] of tests) {
    const match = pattern.exec(ua);
    if (match) return { name, version: match[1] };
  }
  return { name: "Unknown" };
}

export function parseOs(ua: string): NameVersion {
  let match: RegExpExecArray | null;
  if ((match = /Windows NT ([\d.]+)/.exec(ua))) return { name: "Windows", version: match[1] === "10.0" ? "10/11" : match[1] };
  if ((match = /(?:iPhone|iPad|iPod).*? OS ([\d_]+)/.exec(ua))) return { name: "iOS", version: match[1].replace(/_/g, ".") };
  if ((match = /Mac OS X ([\d_.]+)/.exec(ua))) return { name: "macOS", version: match[1].replace(/_/g, ".") };
  if ((match = /Android ([\d.]+)/.exec(ua))) return { name: "Android", version: match[1] };
  if (/CrOS/.test(ua)) return { name: "ChromeOS" };
  if (/Linux/.test(ua)) return { name: "Linux" };
  return { name: "Unknown" };
}

/** The page's address without query string or fragment. */
export function pageUrl(href: string): string {
  return truncate(href.replace(/[?#].*$/, ""), 2_000);
}

type NavigatorLike = { userAgent?: string; language?: string; onLine?: boolean; deviceMemory?: number; hardwareConcurrency?: number; connection?: { effectiveType?: string } };

export function browserContexts(): JsonObject {
  const nav = (globalThis as { navigator?: NavigatorLike }).navigator;
  const ua = nav?.userAgent ?? "";
  const screen = (globalThis as { screen?: { width?: number; height?: number } }).screen;
  const win = globalThis as { innerWidth?: number; innerHeight?: number; devicePixelRatio?: number };
  const browser = parseBrowser(ua);
  const os = parseOs(ua);
  const contexts: JsonObject = {
    runtime: { name: "browser" },
    browser: { name: browser.name, ...(browser.version ? { version: browser.version } : {}) },
    os: { name: os.name, ...(os.version ? { version: os.version } : {}) },
    device: {
      family: /Mobi|Android|iPhone|iPod/.test(ua) ? "mobile" : /iPad|Tablet/.test(ua) ? "tablet" : "desktop",
      ...(screen?.width ? { screen: `${screen.width}x${screen.height}` } : {}),
      ...(win.innerWidth ? { viewport: `${win.innerWidth}x${win.innerHeight}` } : {}),
      ...(win.devicePixelRatio ? { pixelRatio: win.devicePixelRatio } : {}),
      ...(nav?.deviceMemory ? { memoryGb: nav.deviceMemory } : {}),
      ...(nav?.hardwareConcurrency ? { cores: nav.hardwareConcurrency } : {}),
    },
  };
  const locale: JsonObject = {};
  if (nav?.language) locale.language = nav.language;
  try {
    locale.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Ignore.
  }
  if (Object.keys(locale).length) contexts.locale = locale;
  if (nav?.connection?.effectiveType || nav?.onLine === false) {
    contexts.network = { ...(nav.connection?.effectiveType ? { type: nav.connection.effectiveType } : {}), online: nav.onLine !== false };
  }
  return contexts;
}
