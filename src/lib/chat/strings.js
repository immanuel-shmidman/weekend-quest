/**
 * Every user-facing string the analyzer emits, in Hebrew and English.
 *
 * The Hebrew is the original wording and is byte-identical to what the first
 * weekend shipped; the English is written to read naturally, not as a gloss.
 * Numbers arrive already formatted (see text.js fmtInt); dates arrive as
 * `DD/MM/YYYY` or `MM/DD/YYYY` following the export's own convention.
 */

/** @typedef {"he" | "en"} Lang */

/**
 * @typedef {object} Strings
 * @property {string} someone
 * @property {Record<string, string>} statLabels
 * @property {Record<string, string>} weekday
 * @property {Record<string, (...args: any[]) => string>} q   question texts
 * @property {Record<string, (...args: any[]) => string>} r   reveal texts and fragments
 */

/** @type {Record<Lang, Strings>} */
export const STRINGS = {
  he: {
    someone: "מישהו",
    statLabels: {
      messages: "הודעות",
      words: "מילים",
      nightMessages: "הודעות בין 02:00 ל-05:00",
      media: "תמונות וסרטונים",
      conversationStarts: "פתיחת שיחות",
      lastWord: "המילה האחרונה",
      monologue: "הודעות ברצף",
      longestMessage: "ההודעה הארוכה ביותר",
      emojiRate: "אימוג׳י ל-100 הודעות",
      laughRate: "צחוקים ל-100 הודעות",
      questionRate: "סימני שאלה ל-100 הודעות",
      exclamationRate: "סימני קריאה ל-100 הודעות",
      exclaimShare: "אחוז ההודעות עם סימן קריאה",
      meanResponseSec: "זמן תגובה ממוצע",
    },
    weekday: { sun: "ראשון", mon: "שני", tue: "שלישי", wed: "רביעי", thu: "חמישי", fri: "שישי", sat: "שבת" },
    q: {
      who_most_messages: () => "מי שלח הכי הרבה הודעות בקבוצה?",
      who_night_owl: () => "מי שלח הכי הרבה הודעות בין שתיים לחמש לפנות בוקר?",
      who_starts: () => "מי הכי הרבה פותח שיחות אחרי שקט ארוך?",
      who_last_word: () => "למי בדרך כלל יש המילה האחרונה?",
      who_exclaims: () => "אצל מי הכי הרבה הודעות מכילות סימן קריאה?",
      who_asks: () => "מי שואל הכי הרבה שאלות (יחסית לכמות ההודעות)?",
      who_emoji: () => "מי הכי אוהב אימוג׳ים (יחסית לכמות ההודעות)?",
      who_media: () => "מי שלח הכי הרבה תמונות וסרטונים?",
      who_longest_msg: () => "מי כתב את ההודעה הארוכה ביותר שמישהו באמת כתב בעצמו?",
      who_monologue: () => "מי שלח הכי הרבה הודעות ברצף בלי שאף אחד ענה?",
      who_broke_silence: (days) => `אחרי ${days} ימים של שקט מוחלט בקבוצה — מי כתב את ההודעה שפתחה מחדש?`,
      who_funniest: () => "איזו הודעה הצחיקה את הקבוצה יותר מכל — מי כתב אותה?",
      who_fandom: (fandom) => `מי הכי מדבר על ${fandom} בקבוצה?`,
      who_mentions_most: (target) => `מי הכי מדבר על ${target}?`,
      quietest_day: () => "באיזה יום בשבוע הקבוצה הכי שקטה?",
      peak_year: () => "באיזו שנה הקבוצה הייתה הכי פעילה?",
      busiest_day: () => "באיזה תאריך נשלחו הכי הרבה הודעות ביום אחד?",
      how_many_busiest: () => "כמה הודעות נשלחו ביום הכי עמוס בהיסטוריה של הקבוצה?",
      total_messages: (sinceYear) => `כמה הודעות נשלחו בקבוצה מאז ${sinceYear}?`,
      total_words: () => "כמה מילים כתבנו יחד בקבוצה?",
      top_emoji_count: (emoji) => `כמה פעמים השתמשנו ב-${emoji} בקבוצה?`,
      longest_silence: () => "מה הפרק הכי ארוך שבו אף אחד לא כתב כלום? (בימים)",
      longest_message_words: () => "כמה מילים היו בהודעה הארוכה ביותר שמישהו באמת כתב בעצמו?",
      media_count: () => "כמה תמונות וסרטונים נשלחו בקבוצה?",
    },
    r: {
      who_most_messages: (a, n, b, m) => `${a} — ${n} הודעות. במקום השני ${b} עם ${m}.`,
      who_night_owl: (a, n) => `${a}, עם ${n} הודעות לילה.`,
      who_starts: (a, n) => `${a} — ${n} פעמים שבר את השקט.`,
      who_last_word: (a, n) => `${a} סיים ${n} שיחות.`,
      who_exclaims: (a, n, b, m) => `${a} — ${n}% מההודעות. במקום השני ${b} עם ${m}%.`,
      who_asks: (a, n) => `${a} — ${n} סימני שאלה לכל 100 הודעות.`,
      who_emoji: (a, n) => `${a} — ${n} אימוג׳ים לכל 100 הודעות.`,
      who_media: (a, n) => `${a} — ${n} קבצים.`,
      who_longest_msg: (a, n, date) => `${a}, עם ${n} מילים, ב-${date}.`,
      longest_opens_with: (excerpt) => ` היא מתחילה ב״${excerpt}״ — חפשו בקבוצה.`,
      longest_pasted_note: (n) => ` (ההודעה הארוכה בקבוצה בכלל היא ${n} מילים, אבל היא הועתקה מאיפשהו.)`,
      who_monologue: (a, n) => `${a} — ${n} הודעות ברצף.`,
      who_broke_silence: (a, date) => `${a}, ב-${date}.`,
      who_funniest: (a, date, n) => `${a}, ב-${date} — ${n} אנשים צחקו מיד אחרי.`,
      who_fandom_first: (a, n, fandom, total) =>
        `${a} — ${n} אזכורים. בסך הכול הקבוצה הזכירה את ${fandom} ${total} פעמים לאורך השנים.`,
      who_fandom: (a, n, total) => `${a} — ${n} מתוך ${total} האזכורים בקבוצה.`,
      who_mentions_most: (a, target, n, b, m) => `${a} — הזכיר את ${target} ${n} פעמים. אחריו ${b} עם ${m}.`,
      quietest_day: (day, n, max) => `${day} — רק ${n} הודעות לעומת ${max} ביום הכי עמוס.`,
      peak_year: (year, n) => `${year} — ${n} הודעות. מאז ירדנו בהרבה.`,
      busiest_day: (date, n) => `${date} — ${n} הודעות ביום אחד.`,
      how_many_busiest: (n, date) => `${n} הודעות, ב-${date}.`,
      total_messages: (n) => `${n} הודעות.`,
      total_words_intro: (n, torah) => `${n} מילים — פי ${torah} מכל התורה כולה. `,
      total_words_beat_one: (w) => `עברנו את "${w}"`,
      total_words_beat_two: (w) => ` ואת "${w}". `,
      total_words_short_of: (w) => `רק "${w}" עדיין מנצח אתכם.`,
      top_emoji_count: (n, pct) => `${n} פעמים — ${pct}% מכל האימוג׳ים בקבוצה.`,
      longest_silence: (days, date) => `${days} ימים, עד ${date}.`,
      longest_message_words: (n, a, date) => `${n} מילים, מאת ${a} ב-${date}.`,
      longest_message_words_pasted: (n) => ` (יש הודעה ארוכה יותר — ${n} מילים — אבל היא הועתקה מאיפשהו.)`,
      media_count: (n) => `${n} קבצים.`,
    },
  },

  en: {
    someone: "someone",
    statLabels: {
      messages: "Messages",
      words: "Words",
      nightMessages: "Messages between 02:00 and 05:00",
      media: "Photos and videos",
      conversationStarts: "Conversations started",
      lastWord: "Last word",
      monologue: "Messages in a row",
      longestMessage: "Longest message",
      emojiRate: "Emoji per 100 messages",
      laughRate: "Laughs per 100 messages",
      questionRate: "Question marks per 100 messages",
      exclamationRate: "Exclamation marks per 100 messages",
      exclaimShare: "Share of messages with an exclamation mark",
      meanResponseSec: "Average response time",
    },
    weekday: { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" },
    q: {
      who_most_messages: () => "Who has sent the most messages in the group?",
      who_night_owl: () => "Who has sent the most messages between 2 and 5 in the morning?",
      who_starts: () => "Who most often gets the conversation going again after a long silence?",
      who_last_word: () => "Who usually gets the last word?",
      who_exclaims: () => "Whose messages most often contain an exclamation mark?",
      who_asks: () => "Who asks the most questions (relative to how much they write)?",
      who_emoji: () => "Who loves emoji the most (relative to how much they write)?",
      who_media: () => "Who has sent the most photos and videos?",
      who_longest_msg: () => "Who wrote the longest message that somebody actually typed themselves?",
      who_monologue: () => "Who has sent the most messages in a row without anyone replying?",
      who_broke_silence: (days) => `After ${days} days of total silence in the group — who wrote the message that woke it up?`,
      who_funniest: () => "Which message made the group laugh hardest — who wrote it?",
      who_fandom: (fandom) => `Who talks about ${fandom} the most?`,
      who_mentions_most: (target) => `Who talks about ${target} the most?`,
      quietest_day: () => "On which day of the week is the group quietest?",
      peak_year: () => "In which year was the group most active?",
      busiest_day: () => "On which date were the most messages sent in a single day?",
      how_many_busiest: () => "How many messages were sent on the busiest day in the group's history?",
      total_messages: (sinceYear) => `How many messages have been sent in the group since ${sinceYear}?`,
      total_words: () => "How many words have we written together in the group?",
      top_emoji_count: (emoji) => `How many times have we used ${emoji} in the group?`,
      longest_silence: () => "What is the longest stretch in which nobody wrote anything? (in days)",
      longest_message_words: () => "How many words were in the longest message that somebody actually typed themselves?",
      media_count: () => "How many photos and videos have been sent in the group?",
    },
    r: {
      who_most_messages: (a, n, b, m) => `${a} — ${n} messages. ${b} is second with ${m}.`,
      who_night_owl: (a, n) => `${a}, with ${n} late-night messages.`,
      who_starts: (a, n) => `${a} — broke the silence ${n} times.`,
      who_last_word: (a, n) => `${a} closed ${n} conversations.`,
      who_exclaims: (a, n, b, m) => `${a} — ${n}% of their messages. ${b} is second with ${m}%.`,
      who_asks: (a, n) => `${a} — ${n} question marks per 100 messages.`,
      who_emoji: (a, n) => `${a} — ${n} emoji per 100 messages.`,
      who_media: (a, n) => `${a} — ${n} files.`,
      who_longest_msg: (a, n, date) => `${a}, with ${n} words, on ${date}.`,
      longest_opens_with: (excerpt) => ` It opens with “${excerpt}” — go and find it in the group.`,
      longest_pasted_note: (n) => ` (The longest message in the group overall is ${n} words, but it was pasted from somewhere.)`,
      who_monologue: (a, n) => `${a} — ${n} messages in a row.`,
      who_broke_silence: (a, date) => `${a}, on ${date}.`,
      who_funniest: (a, date, n) => `${a}, on ${date} — ${n} people cracked up right after.`,
      who_fandom_first: (a, n, fandom, total) =>
        `${a} — ${n} mentions. Altogether the group has brought up ${fandom} ${total} times over the years.`,
      who_fandom: (a, n, total) => `${a} — ${n} of the group's ${total} mentions.`,
      who_mentions_most: (a, target, n, b, m) => `${a} — mentioned ${target} ${n} times. Next is ${b} with ${m}.`,
      quietest_day: (day, n, max) => `${day} — only ${n} messages, against ${max} on the busiest day.`,
      peak_year: (year, n) => `${year} — ${n} messages. We have slowed down a lot since.`,
      busiest_day: (date, n) => `${date} — ${n} messages in a single day.`,
      how_many_busiest: (n, date) => `${n} messages, on ${date}.`,
      total_messages: (n) => `${n} messages.`,
      total_words_intro: (n, torah) => `${n} words — ${torah} times the entire Torah. `,
      total_words_beat_one: (w) => `We have passed "${w}"`,
      total_words_beat_two: (w) => ` and "${w}". `,
      total_words_short_of: (w) => `Only "${w}" still has you beaten.`,
      top_emoji_count: (n, pct) => `${n} times — ${pct}% of all the emoji in the group.`,
      longest_silence: (days, date) => `${days} days, until ${date}.`,
      longest_message_words: (n, a, date) => `${n} words, by ${a} on ${date}.`,
      longest_message_words_pasted: (n) => ` (There is a longer message — ${n} words — but it was pasted from somewhere.)`,
      media_count: (n) => `${n} files.`,
    },
  },
};

/**
 * @param {string} lang
 * @returns {Strings}
 */
export function stringsFor(lang) {
  return STRINGS[lang === "en" ? "en" : "he"];
}
