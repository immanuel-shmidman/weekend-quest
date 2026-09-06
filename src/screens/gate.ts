/**
 * The entry gate.
 *
 * Runs once, before anything else, against markup that already exists in
 * index.html — same reasoning as birthday-quest's src/gate.ts: mobile keyboards
 * are the flakiest part of a phone web app, and a plain HTML input that exists
 * before any module parses is the most reliable way to get one.
 *
 * v2 makes it two steps. Each event has its own password, checked by the
 * server, and the event log cannot be read until it passes — so the password
 * comes first, and only then the nickname step with its "continue as…" chips
 * (which need the log). A phone that has been through both never sees either
 * again: password and unlocked-flag persist per room in localStorage.
 *
 * Every label is set from here, not baked into index.html, so the language
 * toggle at the bottom can switch the whole gate in place.
 */

import { me } from "../identity";
import * as sync from "../sync";
import { fold } from "../store";
import * as room from "../room";
import { strings, lang, setLang, LANG_LABEL } from "../i18n";

const S = strings({
  he: {
    fallbackTitle: "נופש",
    missingTitle: "לא נמצא אירוע",
    notFound: "הקישור הזה לא מוביל לאירוע קיים. ייתכן שהוא נמחק, או שהקוד שגוי.",
    offline: "אין חיבור לרשת, ואין עדיין עותק שמור של האירוע הזה בטלפון.",
    noLink: "הקישור חסר את קוד האירוע. בקשו מהמארגנים את הקישור המלא.",
    passSub: "הזינו את סיסמת האירוע",
    passPlaceholder: "סיסמת האירוע",
    passBtn: "המשך",
    passEmpty: "קודם הסיסמה!",
    passWrong: "סיסמה לא נכונה — תשאלו את המארגנים!",
    passChanged: "הסיסמה השתנתה — הזינו אותה שוב.",
    netFail: "אין חיבור לרשת. נסו שוב בעוד רגע.",
    nameSub: "בחרו כינוי",
    namePlaceholder: "הכינוי שלכם",
    nameBtn: "יאללה, פנימה!",
    nameEmpty: "קודם בוחרים כינוי!",
    adoptLabel: "כבר שיחקתם? המשיכו בתור:",
  },
  en: {
    fallbackTitle: "Weekend",
    missingTitle: "No event found",
    notFound: "This link does not lead to an existing event. It may have been deleted, or the code is wrong.",
    offline: "No network, and this phone has no saved copy of this event yet.",
    noLink: "The link is missing the event code. Ask the hosts for the full link.",
    passSub: "Enter the event password",
    passPlaceholder: "Event password",
    passBtn: "Continue",
    passEmpty: "Password first!",
    passWrong: "Wrong password — ask the hosts!",
    passChanged: "The password changed — enter it again.",
    netFail: "No network. Try again in a moment.",
    nameSub: "Pick a nickname",
    namePlaceholder: "Your nickname",
    nameBtn: "Let's go!",
    nameEmpty: "Pick a nickname first!",
    adoptLabel: "Played before? Continue as:",
  },
});

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

type Mode = { kind: "pass" } | { kind: "name" } | { kind: "missing"; reason: "no-link" | "not-found" | "offline" };
let mode: Mode = { kind: "pass" };

/** Write every label for the current mode and language. Idempotent. */
function paint(): void {
  $("gate-title").textContent =
    mode.kind === "missing" ? S.missingTitle : room.publicInfo()?.name || S.fallbackTitle;
  $("gate-sub").textContent =
    mode.kind === "missing"
      ? mode.reason === "not-found"
        ? S.notFound
        : mode.reason === "offline"
          ? S.offline
          : S.noLink
      : mode.kind === "pass"
        ? S.passSub
        : S.nameSub;
  $("gate-step-pass").classList.toggle("hidden", mode.kind !== "pass");
  $("gate-step-name").classList.toggle("hidden", mode.kind !== "name");
  $<HTMLInputElement>("gate-pass").placeholder = S.passPlaceholder;
  $("gate-pass-btn").textContent = S.passBtn;
  $<HTMLInputElement>("gate-name").placeholder = S.namePlaceholder;
  $("gate-btn").textContent = S.nameBtn;
  $("gate-adopt-label").textContent = S.adoptLabel;
  $("gate-lang").textContent = LANG_LABEL[lang() === "he" ? "en" : "he"];
}

let langWired = false;
function wireLangToggle(): void {
  if (langWired) return;
  langWired = true;
  $("gate-lang").addEventListener("click", () => {
    setLang(lang() === "he" ? "en" : "he");
    $("gate-err").textContent = "";
    paint();
  });
}

/**
 * Show the gate's terminal state when there is no usable event: bad link,
 * unknown id, or no network and nothing cached. Nothing else renders.
 */
export function showMissing(reason: "no-link" | "not-found" | "offline"): void {
  mode = { kind: "missing", reason };
  $("gate").classList.remove("hidden");
  wireLangToggle();
  paint();
}

/**
 * Take the phone through password and nickname, then resolve. `startSync` is
 * called the moment the password is accepted — sync needs it for every request
 * and the name step needs sync for its chips.
 */
export function passGate(startSync: () => void): Promise<void> {
  const gate = $("gate");
  const passInput = $<HTMLInputElement>("gate-pass");
  const passBtn = $("gate-pass-btn");
  const nameInput = $<HTMLInputElement>("gate-name");
  const nameBtn = $("gate-btn");
  const err = $("gate-err");
  const adoptWrap = $("gate-adopt");
  const adoptList = $("gate-adopt-list");

  // Testing escape hatch: ?reset wipes this phone's identity for this room.
  if (location.search.includes("reset")) me.forget();

  wireLangToggle();

  return new Promise((resolve) => {
    let started = false;
    let stopWatching: (() => void) | null = null;

    const begin = () => {
      if (started) return;
      started = true;
      startSync();
    };

    function finish(): void {
      stopWatching?.();
      gate.classList.add("hidden");
      resolve();
    }

    // --- step 1: password -----------------------------------------------

    function showPassStep(message = ""): void {
      mode = { kind: "pass" };
      paint();
      err.textContent = message;
      passInput.focus();
    }

    let busy = false;
    async function submitPass(): Promise<void> {
      if (busy) return;
      const pass = passInput.value.trim();
      if (!pass) {
        err.textContent = S.passEmpty;
        passInput.focus();
        return;
      }
      busy = true;
      err.textContent = "";
      passBtn.setAttribute("disabled", "");
      const result = await room.unlock(pass);
      passBtn.removeAttribute("disabled");
      busy = false;

      if (result === "forbidden") {
        err.textContent = S.passWrong;
        passInput.value = "";
        passInput.focus();
        return;
      }
      if (result === "offline") {
        err.textContent = S.netFail;
        return;
      }
      if (result === "not-found") {
        showMissing("not-found");
        return;
      }
      begin();
      showNameStep();
    }

    // --- step 2: nickname (or adopt an existing player) -------------------

    function showNameStep(): void {
      mode = { kind: "name" };
      paint();
      err.textContent = "";
      if (me.name) nameInput.value = me.name;

      // Once the log arrives, offer the identities already in it. This is the
      // whole recovery story for "I cleared my browser" and "I want to use my
      // laptop too": adopting a playerId restores that player's board, score
      // and submissions, because everything is folded from the log by player.
      stopWatching ??= watchForNames((names) => {
        if (!names.length) return;
        adoptList.replaceChildren();
        for (const p of names) {
          const chip = document.createElement("button");
          chip.className = "chip";
          chip.dir = "auto";
          chip.textContent = p.name;
          chip.addEventListener("click", () => {
            me.adopt(p.id, p.name);
            finish();
          });
          adoptList.append(chip);
        }
        adoptWrap.classList.remove("hidden");
      });
      nameInput.focus();
    }

    function submitName(): void {
      const name = nameInput.value.trim();
      if (!name) {
        err.textContent = S.nameEmpty;
        nameInput.focus();
        return;
      }
      me.signIn(name);
      sync.post("join", { name: me.name });
      finish();
    }

    passBtn.addEventListener("click", () => void submitPass());
    passInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void submitPass();
    });
    nameBtn.addEventListener("click", submitName);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitName();
    });

    // --- entry ------------------------------------------------------------

    void (async () => {
      if (!room.hasPassword()) {
        showPassStep();
        return;
      }
      // Returning phone: re-fetch the room (config or quiz may have changed),
      // falling back to the cached copy when offline.
      const result = await room.loadFull();
      if (result === "forbidden") {
        showPassStep(S.passChanged);
        return;
      }
      if (result === "not-found") {
        showMissing("not-found");
        return;
      }
      if (result === "offline" && !room.isLoaded()) {
        showMissing("offline");
        return;
      }
      begin();
      if (me.known) finish();
      else showNameStep();
    })();
  });
}

/** Poll the folded world for known players until the caller stops caring. */
function watchForNames(cb: (players: { id: string; name: string }[]) => void): () => void {
  let stopped = false;
  const check = () => {
    if (stopped) return;
    const world = fold(sync.events());
    cb([...world.players.values()].map((p) => ({ id: p.id, name: p.name })));
  };
  const t = setInterval(check, 1500);
  check();
  return () => {
    stopped = true;
    clearInterval(t);
  };
}
