/**
 * Word counts for the "you have written as much as X" comparison.
 *
 * Biased toward texts this group will actually feel something about — the
 * Hebrew and Jewish works are the load-bearing ones; the novels are flavour.
 *
 * `lang` is the language the count was taken in. Hebrew fuses ו/ה/ב/ל/מ/ש/כ
 * prefixes and drops most copulas, so a Hebrew word count runs roughly 25-35%
 * below an English translation of the same content. Comparisons against `en`
 * works therefore scale the group's Hebrew total by HEBREW_DENSITY first;
 * comparisons against `he` works use it as-is.
 *
 * `confidence`:
 *   high   - a figure I would defend
 *   medium - widely cited, essentially one source lineage
 *   low    - ballpark; use only in "more than" phrasings where 10% doesn't show
 */

export const HEBREW_DENSITY = 1.35;

export const WORKS = [
  // --- Hebrew / Jewish -----------------------------------------------------
  { he: "התקווה", en: "Hatikvah", words: 44, lang: "he", confidence: "high" },
  { he: "עשרת הדיברות", en: "Ten Commandments", words: 172, lang: "he", confidence: "medium" },
  { he: "מגילת העצמאות", en: "Declaration of Independence", words: 670, lang: "he", confidence: "medium" },
  { he: "מגילת אסתר", en: "Book of Esther", words: 3044, lang: "he", confidence: "medium" },
  { he: "ספר בראשית", en: "Book of Genesis", words: 20613, lang: "he", confidence: "high" },
  { he: "התורה כולה", en: "The Torah", words: 79847, lang: "he", confidence: "high" },
  { he: "המשנה", en: "The Mishnah", words: 180000, lang: "he", confidence: "low" },
  { he: "התנ״ך כולו", en: "The Tanakh", words: 305490, lang: "he", confidence: "medium" },
  { he: "התלמוד הבבלי", en: "Babylonian Talmud", words: 1860000, lang: "he", confidence: "low" },

  // --- Novels --------------------------------------------------------------
  { he: "הנסיך הקטן", en: "The Little Prince", words: 16500, lang: "en", confidence: "medium" },
  { he: "הארי פוטר ואבן החכמים", en: "Harry Potter 1", words: 76944, lang: "en", confidence: "high" },
  { he: "1984", en: "1984", words: 88942, lang: "en", confidence: "high" },
  { he: "ההוביט", en: "The Hobbit", words: 95356, lang: "en", confidence: "high" },
  { he: "מובי דיק", en: "Moby-Dick", words: 206052, lang: "en", confidence: "high" },
  { he: "יוליסס", en: "Ulysses", words: 264858, lang: "en", confidence: "high" },
  { he: "אנה קרנינה", en: "Anna Karenina", words: 349736, lang: "en", confidence: "medium" },
  { he: "שר הטבעות (שלושת הכרכים)", en: "The Lord of the Rings", words: 481103, lang: "en", confidence: "high" },
  { he: "מרד הנפילים", en: "Atlas Shrugged", words: 561996, lang: "en", confidence: "high" },
  { he: "מלחמה ושלום", en: "War and Peace", words: 587287, lang: "en", confidence: "high" },
  { he: "התנ״ך באנגלית (KJV)", en: "The Bible (KJV)", words: 783137, lang: "en", confidence: "high" },
  { he: "כל סדרת הארי פוטר", en: "Harry Potter, all seven", words: 1084170, lang: "en", confidence: "high" },
  { he: "שיר של אש ושל קרח (5 ספרים)", en: "A Song of Ice and Fire 1-5", words: 1770000, lang: "en", confidence: "low" },
];

/**
 * Compare a Hebrew word total against the table.
 *
 * Ranked by |log(ratio)| rather than absolute difference, so "1.03x War and
 * Peace" correctly beats "1.9x The Lord of the Rings" regardless of scale.
 */
export function compareToWorks(totalWords) {
  const scored = WORKS.map((w) => {
    const effective = w.lang === "he" ? totalWords : totalWords * HEBREW_DENSITY;
    return { ...w, effective, ratio: effective / w.words };
  });

  const nearest = scored
    .slice()
    .sort((a, b) => Math.abs(Math.log(a.ratio)) - Math.abs(Math.log(b.ratio)))[0];

  // Works already passed, MOST IMPRESSIVE FIRST. Ascending ratio puts the
  // ratio closest to 1 first, which is the biggest work just cleared —
  // "we passed War and Peace" lands; "we passed Hatikvah (44 words)" does not.
  const beaten = scored.filter((w) => w.ratio > 1).sort((a, b) => a.ratio - b.ratio);
  const ahead = scored.filter((w) => w.ratio < 1).sort((a, b) => b.ratio - a.ratio);
  const torah = scored.find((w) => w.en === "The Torah");

  return {
    totalWords,
    hebrewDensityFactor: HEBREW_DENSITY,
    torahMultiple: Number(torah.ratio.toFixed(2)),
    nearest: { he: nearest.he, en: nearest.en, words: nearest.words, ratio: Number(nearest.ratio.toFixed(3)) },
    beats: beaten.slice(0, 6).map((w) => ({ he: w.he, words: w.words, ratio: Number(w.ratio.toFixed(2)) })),
    shortOf: ahead.slice(0, 4).map((w) => ({ he: w.he, words: w.words, ratio: Number(w.ratio.toFixed(2)) })),
  };
}
