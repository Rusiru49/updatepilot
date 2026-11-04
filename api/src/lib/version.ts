// Compares software version strings the way people expect:
//   1.10 > 1.9      (numbers, not text)
//   1.0 == 1.0.0    (missing parts count as 0)
//   1.0.0 > 1.0.0-beta   (a release is newer than its pre-release)
//   18.6-5, 24.003.20112, 26260.1717.5229.7049  (real WinGet versions)
// Returns 1 if a > b, -1 if a < b, 0 if equal, or null if it can't be compared
// safely (e.g. "> 3.14.7", "Unknown") — callers must treat null as "unknown".

type Token = number | string;

const UNCERTAIN = /^\s*$|^[<>]|^unknown$/i;

function tokenize(version: string): Token[] | null {
  const v = version.trim().replace(/^v(?=\d)/i, ""); // "v1.2" → "1.2"
  if (UNCERTAIN.test(v)) return null;
  const tokens = v.match(/\d+|[a-z]+/gi);
  if (!tokens || !/^\d/.test(tokens[0])) return null; // must start with a number
  return tokens.map((t) => (/^\d+$/.test(t) ? Number(t) : t.toLowerCase()));
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta || !tb) return null;

  const length = Math.max(ta.length, tb.length);
  for (let i = 0; i < length; i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === y) continue;

    // One side has run out of parts: a missing number counts as 0,
    // and a missing word means "release", which beats "beta" (1.0 > 1.0-beta)
    if (x === undefined) {
      if (typeof y === "string") return 1;
      if (y === 0) continue;
      return -1;
    }
    if (y === undefined) {
      if (typeof x === "string") return -1;
      if (x === 0) continue;
      return 1;
    }

    // Number vs word: the number is newer (1.0.1 > 1.0.beta)
    if (typeof x === "number" && typeof y === "string") return 1;
    if (typeof x === "string" && typeof y === "number") return -1;

    // Both numbers or both words
    return x < y ? -1 : 1;
  }
  return 0;
}

// Is `available` really newer than `installed`?
export function isNewer(available: string, installed: string): boolean | null {
  const c = compareVersions(available, installed);
  return c === null ? null : c === 1;
}

// First number of the version, e.g. 24 for "24.22.1"
export function majorVersion(version: string): number | null {
  const t = tokenize(version);
  return t && typeof t[0] === "number" ? t[0] : null;
}