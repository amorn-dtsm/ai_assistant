/**
 * normalize.js – Pure ESM text normalization & fuzzy search for source viewer.
 * Zero imports, Node-runnable, no DOM/React/TypeScript.
 */

/** Minimum score threshold for fuzzyFind to return a result. */
export const MIN_MATCH_SCORE = 0.75;

/** Regex matching any codepoint in the Thai Unicode block. */
export const THAI_RANGE = /[\u0E00-\u0E7F]/;

// ── Internal constants ──────────────────────────────────────────────

/** Zero-width / invisible characters to DROP outright. */
const DROP = new Set([
  0x200b, // ZERO WIDTH SPACE
  0x200c, // ZERO WIDTH NON-JOINER
  0x00ad, // SOFT HYPHEN
  0xfeff, // BOM / ZERO WIDTH NO-BREAK SPACE
]);

/** Typographic → ASCII map (single-char → single-char or short string). */
const TYPO_MAP = new Map([
  [0x2010, "-"], // HYPHEN
  [0x2011, "-"], // NON-BREAKING HYPHEN
  [0x2012, "-"], // FIGURE DASH
  [0x2013, "-"], // EN DASH
  [0x2014, "-"], // EM DASH
  [0x2018, "'"], // LEFT SINGLE QUOTATION MARK
  [0x2019, "'"], // RIGHT SINGLE QUOTATION MARK
  [0x201a, "'"], // SINGLE LOW-9 QUOTATION MARK
  [0x201b, "'"], // SINGLE HIGH-REVERSED-9 QUOTATION MARK
  [0x201c, '"'], // LEFT DOUBLE QUOTATION MARK
  [0x201d, '"'], // RIGHT DOUBLE QUOTATION MARK
  [0x201e, '"'], // DOUBLE LOW-9 QUOTATION MARK
  [0x201f, '"'], // DOUBLE HIGH-REVERSED-9 QUOTATION MARK
  [0x00a0, " "], // NO-BREAK SPACE
  [0x00bc, "1/4"], // ¼
  [0x00bd, "1/2"], // ½
  [0x00be, "3/4"], // ¾
]);

/** Thai marks that must NEVER be stripped (vowels, tone marks, etc.). */
const THAI_MARK_RANGE_RE = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;

/** Full Thai block range for cluster detection. */
const THAI_BLOCK_RE = /[\u0E00-\u0E7F]/;

/** Unicode Mark category. */
const MARK_RE = /\p{M}/u;

/** Whitespace (all flavors). */
const WS_RE = /\s/;

// ── normalizeForMatch ───────────────────────────────────────────────

/**
 * Normalize text for matching. Produces a normalized string and a mapping
 * array where map[i] is the index in the *original* text that produced
 * the character at position i in the normalized string.
 *
 * Pipeline per codepoint:
 *   (a) DROP invisible chars (ZWSP, ZWNJ, soft-hyphen, BOM)
 *   (b) Typographic → ASCII substitution
 *   (c) NFKC normalization (ligatures, compatibility forms)
 *   (d) Diacritic strip via NFD + remove \p{M} — ONLY when the grapheme
 *       cluster contains NO Thai codepoint (Thai marks are NEVER stripped)
 *   (e) Whitespace collapse → single " " (when collapseWhitespace=true)
 *
 * Multi-char expansions (e.g. ﬁ → fi, ¼ → 1/4) all map back to the
 * same original index.
 *
 * @param {string} text
 * @param {{ collapseWhitespace?: boolean }} [opts]
 * @returns {{ norm: string, map: number[] }}
 */
export function normalizeForMatch(text, { collapseWhitespace = true } = {}) {
  const normChars = [];
  const map = [];
  let lastWasSpace = false;

  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    const charLen = cp > 0xffff ? 2 : 1;

    // (a) DROP invisible characters
    if (DROP.has(cp)) {
      i += charLen;
      continue;
    }

    // (b) Typographic substitution
    const typo = TYPO_MAP.get(cp);
    if (typo !== undefined) {
      // Multi-char expansions (e.g. "1/4") all map to same original index i
      for (const ch of typo) {
        if (collapseWhitespace && WS_RE.test(ch)) {
          if (!lastWasSpace) {
            normChars.push(" ");
            map.push(i);
            lastWasSpace = true;
          }
        } else {
          normChars.push(ch);
          map.push(i);
          lastWasSpace = false;
        }
      }
      i += charLen;
      continue;
    }

    const ch = String.fromCodePoint(cp);

    // (e) Whitespace collapse (check early so we can skip heavy steps)
    if (WS_RE.test(ch)) {
      if (collapseWhitespace) {
        if (!lastWasSpace) {
          normChars.push(" ");
          map.push(i);
          lastWasSpace = true;
        }
      } else {
        normChars.push(ch);
        map.push(i);
        lastWasSpace = false;
      }
      i += charLen;
      continue;
    }

    lastWasSpace = false;

    // (c) NFKC normalization — may expand 1 char to multiple (ﬁ → fi)
    const nfkc = ch.normalize("NFKC");

    // (d) Diacritic strip — ONLY if cluster has NO Thai codepoint
    const hasThai = clusterHasThai(nfkc);
    let final;
    if (hasThai) {
      // Keep Thai marks intact — no NFD stripping
      final = nfkc;
    } else {
      // NFD + strip combining marks → re-NFC for safety
      final = nfkc
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .normalize("NFC");
    }

    // Emit each char of the (possibly expanded) result, all mapping to i
    for (const outCh of final) {
      normChars.push(outCh);
      map.push(i);
    }

    i += charLen;
  }

  return { norm: normChars.join(""), map };
}

/**
 * Check if a string segment contains any Thai-block codepoint.
 * @param {string} s
 * @returns {boolean}
 */
function clusterHasThai(s) {
  return THAI_BLOCK_RE.test(s);
}

// ── flexFind ────────────────────────────────────────────────────────

/**
 * Flexible exact-ish find: split needle on whitespace, regex-escape each
 * token, join with `[ ]?` (optional single space), exec once.
 *
 * Returns {start, end} character offsets in haystack, or null.
 *
 * @param {string} haystackNorm  – already-normalized haystack
 * @param {string} needleNorm    – already-normalized needle
 * @returns {{ start: number, end: number } | null}
 */
export function flexFind(haystackNorm, needleNorm) {
  if (!needleNorm || !needleNorm.trim()) return null;

  // Truncate absurdly long needles to prevent regex backtracking / memory
  // blow-up. 1500 chars is well beyond any realistic citation snippet
  // (typical source citations are <500 chars). Longer needles would also
  // produce regex patterns that V8 compiles slowly.
  let needle = needleNorm;
  if (needle.length > 1500) {
    needle = needle.slice(0, 1500);
  }

  const tokens = needle.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const pattern = tokens.map(escapeRegex).join("[ ]?");

  let re;
  try {
    re = new RegExp(pattern, "u");
  } catch {
    return null;
  }

  const m = re.exec(haystackNorm);
  if (!m) return null;

  return { start: m.index, end: m.index + m[0].length };
}

/**
 * Escape a string for safe use inside a RegExp.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── fuzzyFind ───────────────────────────────────────────────────────

/**
 * Fuzzy find: locate best-matching region in haystack for needle.
 *
 * Latin mode (default): sliding window over space-delimited tokens.
 *   - Score = |intersection of token sets| / |needle token set|
 *   - Window size = needle token count, step ≈ max(1, ⌊count/4⌋)
 *   - Maps back to character offsets via precomputed token-offset array.
 *
 * Thai mode (thai=true): character 3-gram Dice coefficient over sliding
 *   character windows of needle-char-length. Spaces stripped for gram
 *   generation but offset map maintained.
 *   - Step = max(1, ⌊needleLen/4⌋)
 *
 * Returns best match iff score ≥ MIN_MATCH_SCORE, else null.
 * Early-exits on perfect score (1.0).
 *
 * Practical for haystacks up to ~500KB (linear scan, no regex).
 *
 * @param {string} haystackNorm
 * @param {string} needleNorm
 * @param {{ thai?: boolean }} [opts]
 * @returns {{ start: number, end: number, score: number } | null}
 */
export function fuzzyFind(haystackNorm, needleNorm, { thai = false } = {}) {
  if (!needleNorm || !needleNorm.trim()) return null;
  if (!haystackNorm) return null;

  return thai
    ? fuzzyFindThai(haystackNorm, needleNorm)
    : fuzzyFindLatin(haystackNorm, needleNorm);
}

/**
 * Latin-mode fuzzy: token-set sliding window.
 */
function fuzzyFindLatin(haystack, needle) {
  const hTokens = tokenize(haystack);
  const nTokens = tokenize(needle);
  if (nTokens.length === 0 || hTokens.length === 0) return null;

  const needleSet = new Set(nTokens.map((t) => t.text));
  const windowSize = nTokens.length;
  if (hTokens.length < windowSize) return null;

  const step = Math.max(1, Math.floor(windowSize / 4));
  let best = null;

  for (let wi = 0; wi <= hTokens.length - windowSize; wi += step) {
    const windowTokens = hTokens.slice(wi, wi + windowSize);
    const windowSet = new Set(windowTokens.map((t) => t.text));

    let inter = 0;
    for (const t of needleSet) {
      if (windowSet.has(t)) inter++;
    }

    const score = inter / needleSet.size;

    if (best === null || score > best.score) {
      const start = windowTokens[0].start;
      const last = windowTokens[windowTokens.length - 1];
      const end = last.start + last.text.length;
      best = { start, end, score };
      if (score >= 1.0) return best; // early exit on perfect
    }
  }

  // Check last window if step skipped it
  if ((hTokens.length - windowSize) % step !== 0) {
    const wi = hTokens.length - windowSize;
    const windowTokens = hTokens.slice(wi, wi + windowSize);
    const windowSet = new Set(windowTokens.map((t) => t.text));
    let inter = 0;
    for (const t of needleSet) {
      if (windowSet.has(t)) inter++;
    }
    const score = inter / needleSet.size;
    if (best === null || score > best.score) {
      const start = windowTokens[0].start;
      const last = windowTokens[windowTokens.length - 1];
      const end = last.start + last.text.length;
      best = { start, end, score };
    }
  }

  return best && best.score >= MIN_MATCH_SCORE ? best : null;
}

/**
 * Thai-mode fuzzy: char 3-gram Dice over sliding char windows.
 */
function fuzzyFindThai(haystack, needle) {
  // Build char array + offset map (strip spaces for gram generation)
  const { chars: hChars, offsets: hOffsets } = charsNoSpaces(haystack);
  const { chars: nChars } = charsNoSpaces(needle);

  if (nChars.length < 3 || hChars.length < 3) {
    // Fall back to flexFind-like behavior for very short strings
    return null;
  }

  const needleGrams = charNGrams(nChars, 3);
  if (needleGrams.size === 0) return null;

  const winLen = nChars.length;
  if (hChars.length < winLen) return null;

  const step = Math.max(1, Math.floor(winLen / 4));
  let best = null;

  for (let wi = 0; wi <= hChars.length - winLen; wi += step) {
    const windowChars = hChars.slice(wi, wi + winLen);
    const windowGrams = charNGrams(windowChars, 3);
    const score = diceCoefficient(needleGrams, windowGrams);

    if (best === null || score > best.score) {
      const start = hOffsets[wi];
      const end = hOffsets[Math.min(wi + winLen - 1, hOffsets.length - 1)] + 1;
      best = { start, end, score };
      if (score >= 1.0) return best;
    }
  }

  // Check last window if step skipped it
  if ((hChars.length - winLen) % step !== 0) {
    const wi = hChars.length - winLen;
    const windowChars = hChars.slice(wi, wi + winLen);
    const windowGrams = charNGrams(windowChars, 3);
    const score = diceCoefficient(needleGrams, windowGrams);
    if (best === null || score > best.score) {
      const start = hOffsets[wi];
      const end = hOffsets[Math.min(wi + winLen - 1, hOffsets.length - 1)] + 1;
      best = { start, end, score };
    }
  }

  return best && best.score >= MIN_MATCH_SCORE ? best : null;
}

/**
 * Tokenize a string into {text, start} tokens split on whitespace.
 */
function tokenize(s) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    tokens.push({ text: m[0], start: m.index });
  }
  return tokens;
}

/**
 * Strip spaces from a string, returning char array + original-offset map.
 */
function charsNoSpaces(s) {
  const chars = [];
  const offsets = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== " ") {
      chars.push(s[i]);
      offsets.push(i);
    }
  }
  return { chars, offsets };
}

/**
 * Generate a set of character n-grams from a char array.
 */
function charNGrams(chars, n) {
  const grams = new Map();
  for (let i = 0; i <= chars.length - n; i++) {
    const gram = chars.slice(i, i + n).join("");
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }
  return grams;
}

/**
 * Dice coefficient between two gram frequency maps.
 */
function diceCoefficient(a, b) {
  let intersection = 0;
  for (const [gram, countA] of a) {
    const countB = b.get(gram) || 0;
    intersection += Math.min(countA, countB);
  }
  const totalA = sumValues(a);
  const totalB = sumValues(b);
  if (totalA + totalB === 0) return 0;
  return (2 * intersection) / (totalA + totalB);
}

function sumValues(map) {
  let s = 0;
  for (const v of map.values()) s += v;
  return s;
}

// ── prepareSearchKey ────────────────────────────────────────────────

/** Metadata header pattern at start of source text. */
const METADATA_RE = /^<document_metadata>[\s\S]*?<\/document_metadata>\s*/;

/** Continuation sentinel at end of source text. */
const SENTINEL = "...continued on in source document...";

/**
 * Prepare a source text for search: strip metadata header and trailing
 * continuation sentinel, then normalize.
 *
 * @param {string} sourceText
 * @returns {{ norm: string, map: number[], raw: string }}
 */
export function prepareSearchKey(sourceText) {
  let raw = sourceText;

  // Strip leading metadata header
  const headerMatch = METADATA_RE.exec(raw);
  if (headerMatch) {
    raw = raw.slice(headerMatch[0].length);
  }

  // Strip trailing sentinel (with optional trailing whitespace)
  const sentinelRe = new RegExp(
    escapeRegex(SENTINEL) + "\\s*$"
  );
  raw = raw.replace(sentinelRe, "");

  const { norm, map } = normalizeForMatch(raw);
  return { norm, map, raw };
}
