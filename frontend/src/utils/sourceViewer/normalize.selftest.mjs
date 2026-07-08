/**
 * normalize.selftest.mjs – Self-test for normalize.js
 * Run: node frontend/src/utils/sourceViewer/normalize.selftest.mjs
 * Exit 1 on any failure, print "ALL PASS (N assertions)" on success.
 */

import {
  normalizeForMatch,
  flexFind,
  fuzzyFind,
  prepareSearchKey,
  MIN_MATCH_SCORE,
  THAI_RANGE,
} from "./normalize.js";

let count = 0;

function assert(cond, msg) {
  count++;
  if (!cond) {
    console.error(`FAIL [#${count}]: ${msg}`);
    process.exit(1);
  }
}

// ── 1. Ligature: ﬁnal ↔ final via flexFind ─────────────────────────
{
  const hay = normalizeForMatch("ﬁnal report ready").norm;
  const nee = normalizeForMatch("final report ready").norm;
  const hit = flexFind(hay, nee);
  assert(hit !== null, "flexFind: ligature fi in 'ﬁnal' should match 'final'");
  assert(hit.start === 0, "flexFind ligature match starts at 0");
}

// ── 2. Smart quotes: \u201Chello\u201D ↔ "hello" ───────────────────────────
{
  const hay = normalizeForMatch("\u201Chello world\u201D").norm;
  const nee = normalizeForMatch('"hello world"').norm;
  assert(hay === nee, `smart-quote norm: "${hay}" should equal "${nee}"`);
}

// ── 3. Thai marks preserved in norm("เพิ่มข้อมูล") ─────────────────
{
  const { norm } = normalizeForMatch("เพิ่มข้อมูล");
  const thaiMarkRe = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;
  assert(thaiMarkRe.test(norm), "Thai marks must be preserved in normalized output");
}

// ── 4. SARA AM: ทำ norm-equal both compositions + match ─────────────
{
  // Precomposed SARA AM: U+0E17 U+0E33
  const precomposed = "\u0E17\u0E33";
  // Decomposed SARA AM: U+0E17 U+0E4D U+0E32
  const decomposed = "\u0E17\u0E4D\u0E32";
  const normPre = normalizeForMatch(precomposed).norm;
  const normDec = normalizeForMatch(decomposed).norm;
  assert(normPre === normDec, `SARA AM: precomposed "${normPre}" should equal decomposed "${normDec}"`);
  // flexFind should match
  const hit = flexFind(normPre, normDec);
  assert(hit !== null, "SARA AM: flexFind should match both compositions");
}

// ── 5. ZWSP: "ภาษา\u200Bไทย" ↔ "ภาษาไทย" ──────────────────────────
{
  const withZwsp = normalizeForMatch("ภาษา\u200Bไทย").norm;
  const without = normalizeForMatch("ภาษาไทย").norm;
  assert(withZwsp === without, `ZWSP: "${withZwsp}" should equal "${without}"`);
}

// ── 6. flexFind across newline: "brown fox" in "quick brown\nfox" ───
{
  const hay = normalizeForMatch("quick brown\nfox jumps").norm;
  const nee = normalizeForMatch("brown fox").norm;
  const hit = flexFind(hay, nee);
  assert(hit !== null, "flexFind should match across collapsed whitespace (newline)");
}

// ── 7. fuzzyFind latin: 20-word needle, 1 substituted → score ≥ 0.75
{
  const words = "the quick brown fox jumps over the lazy dog near the river bank under the bright sun in the open field".split(" ");
  const haystack = words.join(" ");
  // Substitute 1 word
  const needleWords = [...words];
  needleWords[5] = "REPLACED";
  const needle = needleWords.join(" ");

  const hNorm = normalizeForMatch(haystack).norm;
  const nNorm = normalizeForMatch(needle).norm;
  const hit = fuzzyFind(hNorm, nNorm);
  assert(hit !== null, "fuzzyFind latin: 1-word substitution in 20-word needle should match");
  assert(hit.score >= MIN_MATCH_SCORE, `fuzzyFind latin score ${hit.score} should be >= ${MIN_MATCH_SCORE}`);
}

// ── 8. fuzzyFind latin: absent needle → null ────────────────────────
{
  const hay = normalizeForMatch("the quick brown fox jumps over the lazy dog").norm;
  const nee = normalizeForMatch("completely unrelated xyzzy plugh content here now today").norm;
  const hit = fuzzyFind(hay, nee);
  assert(hit === null, "fuzzyFind latin: absent needle should return null");
}

// ── 9. fuzzyFind thai: 1-2 char perturbation found ──────────────────
{
  const thaiText = "ประเทศไทยมีความสวยงามมาก";
  const thaiNeedle = "ประเทศไทยมีความสวยงามนาก"; // last char changed
  const hNorm = normalizeForMatch(thaiText).norm;
  const nNorm = normalizeForMatch(thaiNeedle).norm;
  const hit = fuzzyFind(hNorm, nNorm, { thai: true });
  assert(hit !== null, "fuzzyFind thai: 1-char perturbation should match");
  assert(hit.score >= MIN_MATCH_SCORE, `fuzzyFind thai score ${hit.score} should be >= ${MIN_MATCH_SCORE}`);
}

// ── 10. fuzzyFind thai: absent → null ───────────────────────────────
{
  const hay = normalizeForMatch("ประเทศไทยมีความสวยงามมาก").norm;
  const nee = normalizeForMatch("ฉันชอบกินข้าวผัดกระเพรา").norm;
  const hit = fuzzyFind(hay, nee, { thai: true });
  assert(hit === null, "fuzzyFind thai: completely different text should return null");
}

// ── 11. prepareSearchKey strips header AND sentinel ─────────────────
{
  const src =
    '<document_metadata>\ntitle: Test\n</document_metadata>\nHello world...continued on in source document...';
  const { raw, norm } = prepareSearchKey(src);
  assert(!raw.includes("<document_metadata>"), "prepareSearchKey: header should be stripped from raw");
  assert(!raw.includes("...continued on in source document..."), "prepareSearchKey: sentinel should be stripped from raw");
  assert(raw.trim() === "Hello world", `prepareSearchKey raw should be "Hello world", got "${raw.trim()}"`);
}

// ── 12. map round-trip: map[start]/map[end-1] valid ─────────────────
{
  const original = "The café is great";
  const { norm, map } = normalizeForMatch(original);
  // flexFind "cafe" in normalized
  const nNorm = normalizeForMatch("cafe").norm;
  const hit = flexFind(norm, nNorm);
  assert(hit !== null, "map round-trip: should find 'cafe' in 'café'");
  assert(map[hit.start] !== undefined, "map[start] should be defined");
  assert(map[hit.end - 1] !== undefined, "map[end-1] should be defined");
  const origSlice = original.slice(map[hit.start], map[hit.end - 1] + 1);
  assert(origSlice.includes("café") || origSlice.includes("cafe"),
    `map round-trip: original slice "${origSlice}" should contain needle core`);
}

// ── 13. café ↔ cafe ─────────────────────────────────────────────────
{
  const a = normalizeForMatch("café").norm;
  const b = normalizeForMatch("cafe").norm;
  assert(a === b, `diacritic strip: "${a}" should equal "${b}"`);
}

// ── 14. flexFind absent-needle vs Thai haystack → null ──────────────
{
  const hay = normalizeForMatch("สวัสดีครับ ยินดีต้อนรับ").norm;
  const nee = normalizeForMatch("xyzzy plugh nothing").norm;
  const hit = flexFind(hay, nee);
  assert(hit === null, "flexFind: absent Latin needle vs Thai haystack should return null");
}

// ── 15. THAI_RANGE constant works ───────────────────────────────────
{
  assert(THAI_RANGE.test("ก"), "THAI_RANGE should match Thai character");
  assert(!THAI_RANGE.test("a"), "THAI_RANGE should not match Latin character");
}

// ── 16. MIN_MATCH_SCORE constant ────────────────────────────────────
{
  assert(MIN_MATCH_SCORE === 0.75, `MIN_MATCH_SCORE should be 0.75, got ${MIN_MATCH_SCORE}`);
}

console.log(`ALL PASS (${count} assertions)`);
