/** The first x.y.z in a version or range ("^15.2.1", "~3.4", "15", "workspace:*" → null). */
export function minVersion(spec: string | undefined | null): [number, number, number] | null {
  if (!spec) return null;
  const match = /(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(spec);
  if (!match) return null;
  const part = (value: string | undefined) => (value === undefined || value === "x" || value === "*" ? 0 : Number(value));
  return [Number(match[1]), part(match[2]), part(match[3])];
}

export function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

export function format(version: [number, number, number]): string {
  return version.join(".");
}

/** Whether `version` is within [min, max] (either bound optional; max compares by major when given as "17"). */
export function inRange(version: [number, number, number], min?: string, max?: string): boolean {
  const lower = minVersion(min);
  if (lower && compare(version, lower) < 0) return false;
  if (max) {
    const upper = minVersion(max)!;
    const majorOnly = /^\d+$/.test(max.trim());
    if (majorOnly ? version[0] > upper[0] : compare(version, upper) > 0) return false;
  }
  return true;
}
