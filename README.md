# Weekend Quest

A phone-first party app for a weekend away with friends or family: live bingo,
two truths and a lie, a quiz built from your WhatsApp group, "who is most
likely…", a quote wall and an awards ceremony. Hebrew and English. Everyone
plays from their phone through one link; the host sets it up in a six-step
wizard, no developer needed.

Live: https://weekend-quest.pages.dev

## Where to start

- **CLAUDE.md** — the architecture, the decisions and why they were made, and
  what will bite you. Read it first.
- **DEPLOY.md** — running it locally and deploying to Cloudflare Pages + D1.
- **PLAN-v2.md** — the plan that turned a one-weekend app into a self-serve one.

TypeScript + Vite + plain DOM, Cloudflare Pages Functions + D1. No framework,
no runtime dependencies.

## Why no framework

Three facts about this app point the same way: it is small, it is a favour
rather than a product, and it has to keep working on bad hotel wifi years from
now with nobody maintaining it.

- **One state, already managed.** Every screen is a pure function of a single
  folded event log and re-renders when the log changes. A framework's job is
  reconciling component state with the DOM; here the fold is the state and
  screens are `render(root)` functions of about a hundred lines.
- **Weight.** The whole app is ~39 KB gzipped, QR encoder and bilingual strings
  included. React + ReactDOM are ~45 KB before a line of app code. Phones open
  this thirty times a weekend on poor connections.
- **Longevity.** Zero runtime dependencies means no framework majors to migrate
  and no audit churn for a project that gets attention twice a year. The only
  dev dependencies are TypeScript and Vite.
- **The server and the analyzer are plain JavaScript anyway**, and the analyzer
  runs unchanged in Node and the browser.

The honest cost: screens with text inputs must update only their non-input
parts, or a re-render steals focus mid-typing — a virtual DOM gives that for
free. The form-heavy wizard and settings screens carry hand-written state that
hooks or signals would shorten. If those keep growing, Preact (~4 KB) is the
one alternative worth considering; a full port buys nothing a guest would notice.

## Adding your own feature

Every activity is a stream of events in one table and every screen is a pure
function of the fold — see "Adding an activity" in CLAUDE.md. Strings live next
to the screen that uses them, in both languages. Send a pull request, or fork
and run your own copy; either is fine.

## Privacy

WhatsApp exports are analysed in the browser and never uploaded; only counts,
names and dates reach the server. See "Guiding principles" in CLAUDE.md.

## License

MIT — see LICENSE. The license covers the code. Anything under `tools/private/`
is gitignored and never part of the repository.
