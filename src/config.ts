import { strings } from "./i18n";

/**
 * Genuine constants for the whole app. Tweak here, not scattered across screens.
 * Same role as birthday-quest's src/config.ts.
 *
 * v2: anything that differs between events — password, host code, room id,
 * bingo size, the quiz — is a row in the `rooms` table, fetched at boot and
 * read through src/room.ts. Only what is the same for every event stays here.
 */

// --- Feedback --------------------------------------------------------------

/**
 * Feedback goes through /api/feedback, which verifies the Turnstile token,
 * stores a copy in D1 and forwards to the Formspree endpoint in wrangler.toml
 * (`FEEDBACK_ENDPOINT`) — the email. The endpoint lives server-side so the
 * human check cannot be bypassed by posting to Formspree directly.
 */

// --- Turnstile ---------------------------------------------------------------

/**
 * Cloudflare Turnstile site key (public). Gates event creation and feedback;
 * guests never see the widget. The secret is a Pages secret, TURNSTILE_SECRET,
 * never in the repo. Empty disables the widget (local dev without a widget).
 */
export const TURNSTILE_SITE_KEY = "0x4AAAAAAEqixfct4nH0CHlH";

// --- Palette (lifted from birthday-quest — proven readable on phones) -------

export const COLORS = {
  bg: "#1a1130",
  panel: "#2a1a4a",
  accent: "#8b5cf6",
  text: "#f3e9ff",
  textMuted: "#b9a9d6",
  good: "#4ade80",
  bad: "#ff6b8a",
  gold: "#ffd166",
} as const;

// --- Sync ------------------------------------------------------------------

/**
 * Poll interval per route, in ms. These are load-bearing, not polish: the
 * Workers free tier is 100k requests/day, and 14 phones on a flat 3s interval
 * with no visibility gating comes to ~235k/day. This table plus the
 * visibility/idle gating in sync.ts lands around ~53k/day.
 *
 * If the Cloudflare dashboard looks worrying mid-weekend, raising these and
 * redeploying takes about 90 seconds.
 */
export const POLL_MS = {
  truths: 5_000, // everyone is on the same screen at the same moment
  bingo: 15_000, // runs all weekend; 15s of latency on a square is fine
  quiz: 30_000, // self-paced and solo
  home: 30_000, // status lines and standings only
  host: 5_000, // the host is watching readiness counts tick up
  superlatives: 8_000, // votes land while everyone is looking at the same screen
  wall: 20_000, // ambient; a quote can wait
  awards: 30_000, // read at the end, not raced
} as const;

/** Stop polling entirely after this long with no interaction; a button resumes. */
export const IDLE_STOP_MS = 15 * 60_000;

// --- Scoring ---------------------------------------------------------------

export const POINTS = {
  quizChoice: 100, // a correct multiple-choice answer
  quizNumberMax: 100, // a perfect numeric guess; falloff scales down from here
  truthsCorrectGuess: 10, // you spotted someone's lie
  truthsFooledEach: 10, // per person who fell for yours
  bingoDeclare: 5, // you were the one who called a square
  bingoLine: 50, // you completed a line
} as const;

// --- Activity registry -----------------------------------------------------

/**
 * The home screen renders these in order. `built: false` hides an activity
 * completely — the mechanism (lifted from birthday-quest's src/levels.ts) by
 * which an unfinished activity simply doesn't appear rather than looking broken.
 * The room config can additionally switch any of them off per event.
 */
export interface Activity {
  key: ActivityKey;
  route: string;
  emoji: string;
  title: string;
  blurb: string;
  built: boolean;
}

export type ActivityKey = "bingo" | "truths" | "quiz" | "superlatives" | "wall" | "awards";

export const ACTIVITY_KEYS: ActivityKey[] = ["bingo", "truths", "quiz", "superlatives", "wall", "awards"];

const A = strings({
  he: {
    bingoTitle: "בינגו",
    bingoBlurb: "לוח לכל אחד, משבצות משותפות — רץ כל האירוע",
    truthsTitle: "שתי אמיתות ושקר",
    truthsBlurb: "כולם שולחים שלוש, כולם מנחשים איזו מהן שקר",
    quizTitle: "החידון של הקבוצה",
    quizBlurb: "שנים של וואטסאפ, במספרים",
    superlativesTitle: "מי הכי…",
    superlativesBlurb: "שאלות שכולם מצביעים עליהן, תוצאות בזמן אמת",
    wallTitle: "קיר הציטוטים",
    wallBlurb: "מנציחים משפטים ומגיבים עליהם",
    awardsTitle: "טקס הפרסים",
    awardsBlurb: "מי הצטיין במה — מחושב מהכול",
  },
  en: {
    bingoTitle: "Bingo",
    bingoBlurb: "A board each, shared squares — runs all event long",
    truthsTitle: "Two Truths and a Lie",
    truthsBlurb: "Everyone submits three, everyone guesses the lie",
    quizTitle: "The Group Quiz",
    quizBlurb: "Years of WhatsApp, in numbers",
    superlativesTitle: "Who's Most Likely…",
    superlativesBlurb: "Questions everyone votes on, results live",
    wallTitle: "Quote Wall",
    wallBlurb: "Immortalise the one-liners and react to them",
    awardsTitle: "Awards Ceremony",
    awardsBlurb: "Who excelled at what — computed from everything",
  },
});

/** The registry, in the current language. Call it; do not cache the result. */
export function activities(): Activity[] {
  return [
    { key: "bingo", route: "#/bingo", emoji: "🎯", title: A.bingoTitle, blurb: A.bingoBlurb, built: true },
    { key: "truths", route: "#/truths", emoji: "🤥", title: A.truthsTitle, blurb: A.truthsBlurb, built: true },
    { key: "quiz", route: "#/quiz", emoji: "💬", title: A.quizTitle, blurb: A.quizBlurb, built: true },
    { key: "superlatives", route: "#/superlatives", emoji: "🏅", title: A.superlativesTitle, blurb: A.superlativesBlurb, built: true },
    { key: "wall", route: "#/wall", emoji: "💬", title: A.wallTitle, blurb: A.wallBlurb, built: true },
    { key: "awards", route: "#/awards", emoji: "🏆", title: A.awardsTitle, blurb: A.awardsBlurb, built: true },
  ];
}
