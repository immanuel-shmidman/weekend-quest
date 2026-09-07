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

Sufficiency, not principle. The app has one piece of state — the folded event
log — and every screen is a function of it, re-rendered when the log changes.
Plain DOM covers that in a few hundred lines (`src/ui/dom.ts`, the `live()`
wrapper in `src/main.ts`), so no framework was added. v1 was built quickly for
a single weekend on a stack inherited from an earlier party project, and v2
extended what worked rather than porting it mid-flight.

React would have been an equally reasonable choice. Its cost in bytes is
irrelevant at this size and it is well maintained; the one thing plain DOM
makes you do by hand is keep text inputs from losing focus on re-render
(screens with inputs update only their non-input parts), which a virtual DOM
handles for you.

If you are going to add features and prefer React, porting is a few days, not
a rewrite: `sync.ts`, `store.ts` and the Functions stay as they are, and each
screen is already a render function of the world.

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
