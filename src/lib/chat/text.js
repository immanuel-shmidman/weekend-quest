/**
 * Text utilities shared by the parser, the statistics and the question
 * generator. Environment-free: runs in Node and in the browser.
 *
 * Everything here is plain string work. The two non-obvious pieces are the
 * bidi-control regex (see BIDI_RE) and grapheme-aware emoji extraction.
 */

/**
 * Bidi and zero-width controls to strip: U+200B, U+200E, U+200F,
 * U+202A..U+202E, U+2066..U+2069.
 *
 * CRITICAL: this deliberately EXCLUDES U+200D (zero-width joiner). A long
 * Hebrew export contains thousands of them and they are what glue compound
 * emoji together (👨‍👩‍👦, 🤦‍♀️). Strip ZWJ and every family and gendered emoji
 * shatters into its components, which then show up in the "top emoji" table
 * as things like ♀ and 🏻 — neither of which is an emoji anyone typed.
 */
export const BIDI_RE = /[​‎‏‪-‮⁦-⁩]/g;

/** @type {Record<string, string>} */
const ENTITIES = { "&gt;": ">", "&lt;": "<", "&amp;": "&", "&quot;": '"', "&#39;": "'" };
/** @param {string} s */
export const decodeEntities = (s) => s.replace(/&(gt|lt|amp|quot|#39);/g, (m) => ENTITIES[m]);

/** Grapheme-aware emoji extraction. Intl.Segmenter is core in Node 18+ and every current browser. */
const segmenter = new Intl.Segmenter("he", { granularity: "grapheme" });
const EMOJI_RE = /\p{Extended_Pictographic}/u;

/**
 * Every emoji grapheme in a text, compound emoji kept whole.
 * @param {string} text
 * @returns {string[]}
 */
export function emojiOf(text) {
  /** @type {string[]} */
  const out = [];
  if (!EMOJI_RE.test(text)) return out;
  for (const { segment } of segmenter.segment(text)) {
    if (EMOJI_RE.test(segment)) out.push(segment);
  }
  return out;
}

/**
 * Iterate the grapheme clusters of a text.
 * @param {string} text
 */
export function graphemes(text) {
  return segmenter.segment(text);
}

/** Hebrew laughter: חח / חחח / ההה / כככ, standing alone. */
export const LAUGH_RE = /(?<![א-ת])[חהכ]?[חהכ]{2,}[חהכאxX]*(?![א-ת])/gu;

/** Hebrew exclamations of approval. Trailing letters are often repeated. */
export const EXCLAIM_RE =
  /(?<![א-ת])(ענקק*|גדולל*|אדירר*|מושלםם*|פצצהה*|סחתייןן*|מדהיםם*|הזוי+|מגניבב*|קורעע*|אלוףף*|גאוןן*|חזקק*|מטריףף*|נהדרר*|וואלה+|איזה גזע|לא נורמלי|מת עליך|בכיתי)(?![א-ת])/gu;

/**
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/**
 * The opening words of a message, for pasting into WhatsApp search.
 *
 * NOTE: this is the ONE way real message text can reach the generated stats
 * (`group.longestMessage.excerpt`, `funniestMessage.excerpt|fullText`, and the
 * reveal text that quotes them). Everything else in that output is counts,
 * names and dates. `analyzeExport` only calls this when `excerpts: true`.
 *
 * @param {string} text
 * @param {number} [n]
 * @param {number} [maxChars]
 */
export function firstWords(text, n = 8, maxChars = 70) {
  const flat = text.replace(/\s+/g, " ").trim();
  // Drop punctuation-only tokens: a message can open with a divider line of
  // dashes, and those burn the character budget without helping anyone find it.
  const tokens = flat.split(" ").filter((t) => !/^[-–—_=.*~•+#|]+$/.test(t));
  const words = tokens.slice(0, n).join(" ");
  const cut = words.length > maxChars ? words.slice(0, maxChars).trim() : words;
  return cut + (cut.length < flat.length ? "…" : "");
}

/**
 * Render an ISO day (`YYYY-MM-DD...`) the way the export wrote it.
 * @param {string} iso
 * @param {"dmy" | "mdy"} [order]
 */
export function formatDay(iso, order = "dmy") {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return order === "mdy" ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
}

/**
 * Thousands-grouped integer, locale-pinned so the output is byte-stable
 * regardless of the machine or browser it was generated on.
 * @param {number} n
 */
export function fmtInt(n) {
  return n.toLocaleString("en-US");
}

/** @param {number} n */
export const pad2 = (n) => String(n).padStart(2, "0");
