import "./ui/styles.css";

import { POLL_MS } from "./config";
import { me } from "./identity";
import * as room from "./room";
import { applyDocumentLang } from "./i18n";
import * as sync from "./sync";
import { startWorld, onWorld } from "./world";
import { passGate, showMissing } from "./screens/gate";
import { landingScreen } from "./screens/landing";
import { wizardScreen } from "./screens/wizard";
import { settingsScreen } from "./screens/settings";
import { feedbackScreen } from "./screens/feedback";
import { homeScreen } from "./screens/home";
import { scoresScreen } from "./screens/scores";
import { bingoScreen } from "./screens/bingo";
import { hostScreen } from "./screens/host";
import { truthsScreen } from "./screens/truths";
import { superlativesScreen } from "./screens/superlatives";
import { wallScreen } from "./screens/wall";
import { awardsScreen } from "./screens/awards";
import { quizScreen } from "./screens/quiz";
import { debugScreen } from "./screens/debug";
import { mountScorebar, updateScorebar } from "./ui/scorebar";
import { watchInstallPrompt } from "./ui/install";
import * as router from "./router";
import { getWorld } from "./world";
import type { Screen } from "./router";

/**
 * Wrap a screen so it re-renders whenever the world changes.
 *
 * Only for screens with no text inputs — a full re-render would steal focus
 * mid-typing. Screens that take input subscribe to onWorld themselves and
 * update just the parts that need it.
 */
function live(render: (root: HTMLElement) => void): Screen {
  return (root) => {
    render(root);
    return onWorld(() => {
      root.replaceChildren();
      render(root);
    });
  };
}

/**
 * Screens that exist before there is an event: the landing page and the setup
 * wizard. They render without a room, a password or sync.
 */
function bootRoomless(): void {
  applyDocumentLang();
  document.title = "Weekend Quest";
  document.getElementById("gate")?.classList.add("hidden");
  router.register("/", landingScreen, null);
  router.register("/start", landingScreen, null);
  router.register("/new", wizardScreen, null);
  router.start(document.getElementById("app")!);
}

async function boot(): Promise<void> {
  watchInstallPrompt();

  // The wizard and landing page come before "which event?": #/new must work
  // from inside an event too (make another one), and with no event at all.
  const p = router.path();
  if (p === "/new" || p === "/start") {
    bootRoomless();
    return;
  }

  // Which event? From the link, else the last one this phone opened. Nothing
  // else can happen until this is known: every request carries the room id,
  // and every screen reads its config. With neither, the landing page.
  if (!room.resolveRoomId()) {
    bootRoomless();
    return;
  }
  const found = await room.loadPublic();
  if (found === "not-found") {
    showMissing("not-found");
    return;
  }
  if (found === "offline" && !room.isLoaded()) {
    showMissing("offline");
    return;
  }

  // Direction and language follow the event (or this phone's choice) from
  // here on; the gate is the first thing rendered with them.
  applyDocumentLang();

  onWorld(() => {
    const w = getWorld();
    // The log is the truth about names: if the host fixed a typo in yours,
    // this phone adopts it, so the scorebar, the home greeting and any later
    // re-announce all carry the corrected name.
    const mine = w.players.get(me.id);
    if (mine && me.known && mine.name !== me.name) me.rename(mine.name);
    updateScorebar(w);
  });

  // The gate starts sync itself, the moment the password is accepted — sync
  // needs it for every request, and the gate's "continue as…" chips need sync.
  await passGate(startWorld);

  // Set the tab/app title to the event, now that it is known.
  if (room.getRoom().name) document.title = room.getRoom().name;

  // A returning player skips the gate entirely, so re-announce the name here:
  // cheap, idempotent under last-write-wins, and it heals a join event that was
  // lost to a dead connection on the first visit.
  if (me.known && !getWorld().players.has(me.id)) {
    sync.post("join", { name: me.name });
  }

  mountScorebar();
  updateScorebar(getWorld());

  router.register("/", live(homeScreen), POLL_MS.home);
  router.register("/scores", live(scoresScreen), POLL_MS.home);
  router.register("/bingo", bingoScreen, POLL_MS.bingo);
  router.register("/truths", truthsScreen, POLL_MS.truths);
  router.register("/quiz", quizScreen, POLL_MS.quiz);
  router.register("/superlatives", superlativesScreen, POLL_MS.superlatives);
  router.register("/wall", wallScreen, POLL_MS.wall);
  router.register("/awards", awardsScreen, POLL_MS.awards);
  router.register("/host", hostScreen, POLL_MS.host);
  router.register("/settings", settingsScreen, null);
  router.register("/feedback", feedbackScreen, null);
  router.register("/new", wizardScreen, null);
  router.register("/start", landingScreen, null);
  router.register("/debug", live(debugScreen), POLL_MS.home);

  router.start(document.getElementById("app")!);
}

void boot();
