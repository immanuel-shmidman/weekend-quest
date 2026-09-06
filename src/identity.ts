/**
 * Who this phone is.
 *
 * Deliberately localStorage, NOT sessionStorage. birthday-quest used
 * sessionStorage (src/state/GameState.ts) because it was a one-run, 90-minute
 * game; sessionStorage is scoped to the tab and dies on browser restart. This
 * app has to remember someone across a whole weekend of phone locks, reboots
 * and accidental tab closes, so that reopening the link drops them straight
 * back into their board, their score and their answered questions.
 *
 * Progress itself is never stored here — it lives in the shared event log and
 * is folded per playerId (see store.ts). That means "load my progress" and
 * "know who I am" are the same problem, and solving identity solves both.
 *
 * v2: the id and nickname are global to the phone — you are the same person at
 * every event — but "has passed the gate" and "is host" are per room, because
 * each event has its own password and host code. Those live in room.ts.
 */

import { roomKey, hasPassword, hostCode, forgetPassword, forgetHost, forgetLastRoom } from "./room";
import { strings } from "./i18n";

const S = strings({
  he: { guest: "אורח" },
  en: { guest: "Guest" },
});

const K_ID = "wq-id";
const K_NAME = "wq-name";
const K_UNLOCKED = "wq-unlocked"; // suffixed with the room id, see roomKey()

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return ""; // private mode, or storage disabled
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* nothing we can do; the session still works, it just won't persist */
  }
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "p-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
}

class Identity {
  get id(): string {
    return read(K_ID);
  }

  get name(): string {
    return read(K_NAME);
  }

  /** Unlocked #/host for THIS room. The code itself is held by room.ts. */
  get isHost(): boolean {
    return hostCode().length > 0;
  }

  /**
   * True once this phone has passed the gate for this room. The whole point of
   * persisting this: a returning player never sees the password screen again.
   */
  get known(): boolean {
    return Boolean(this.id && this.name && hasPassword() && read(roomKey(K_UNLOCKED)) === "1");
  }

  /** First sign-in: mint a fresh playerId and remember the nickname. */
  signIn(name: string): void {
    if (!this.id) write(K_ID, newId());
    write(K_NAME, name.trim().slice(0, 20) || S.guest);
    write(roomKey(K_UNLOCKED), "1");
  }

  /**
   * Take over an identity already present in the event log — used when someone
   * cleared their browser, or wants to play from a second device. They get
   * their board, score and submissions back, because everything is folded from
   * the log by playerId.
   */
  adopt(playerId: string, name: string): void {
    write(K_ID, playerId);
    write(K_NAME, name.trim().slice(0, 20) || S.guest);
    write(roomKey(K_UNLOCKED), "1");
  }

  rename(name: string): void {
    write(K_NAME, name.trim().slice(0, 20) || S.guest);
  }

  /**
   * Leave the current event, keeping who you are.
   *
   * Clears only the per-room pieces — unlocked flag, password, host code, the
   * "open this room by default" memory — and keeps the player id and nickname.
   * Rejoining with the code then shows the gate with the name prefilled, and
   * signing in reuses the same id, so the board, score and answers are back.
   */
  leaveRoom(): void {
    try {
      localStorage.removeItem(roomKey(K_UNLOCKED));
    } catch {
      /* ignore */
    }
    forgetPassword();
    forgetHost();
    forgetLastRoom();
  }

  /** Escape hatch for testing: ?reset in the URL wipes this phone for this room. */
  forget(): void {
    for (const k of [K_ID, K_NAME, roomKey(K_UNLOCKED)]) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    }
    forgetPassword();
    forgetHost();
  }
}

export const me = new Identity();
