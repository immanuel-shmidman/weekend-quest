/**
 * The scoreboard bar pinned to the bottom of every screen.
 *
 * Requirement: the live score is always visible, and the full standings are
 * never more than one tap away. So this lives outside the router's mount point
 * and survives every navigation — it is created once and updated in place on
 * each world change.
 */

import { h, bdi, clear } from "./dom";
import { me } from "../identity";
import * as sync from "../sync";
import { standings, type World } from "../store";
import { go } from "../router";
import { strings } from "../i18n";

const S = strings({
  he: { aria: "טבלת הניקוד", rank: "מקום ", guest: "אורח", pts: " נק׳", open: "טבלה ›" },
  en: { aria: "Standings", rank: "#", guest: "Guest", pts: " pts", open: "Table ›" },
});

let bar: HTMLElement | null = null;

export function mountScorebar(): void {
  if (bar) return;
  bar = h("div.scorebar", {
    onclick: () => go("#/scores"),
    role: "button",
    "aria-label": S.aria,
  });
  document.body.append(bar);
}

export function updateScorebar(world: World): void {
  if (!bar) return;

  const rows = standings(world);
  const mine = rows.find((r) => r.id === me.id);
  const state = sync.status();

  clear(bar);
  bar.append(
    h("span.sync-dot", { class: state === "live" ? "" : state }),
    mine
      ? h("span.scorebar-rank", null, S.rank, bdi(mine.rank))
      : h("span.scorebar-rank", null, "—"),
    h("span.scorebar-name", { dir: "auto" }, me.name || S.guest),
    h("span.scorebar-spacer"),
    h("span.scorebar-score", null, bdi(mine?.score ?? 0), S.pts),
    h("span.scorebar-open", null, S.open)
  );
}

export function hideScorebar(hidden: boolean): void {
  bar?.classList.toggle("hidden", hidden);
}
