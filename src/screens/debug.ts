import { h, bdi } from "../ui/dom";
import * as sync from "../sync";
import { me } from "../identity";
import { getWorld } from "../world";
import { strings } from "../i18n";

const S = strings({
  he: {
    refresh: "רענון",
  },
  en: {
    refresh: "Refresh",
  },
});

/**
 * Raw event dump. Not linked from anywhere — reach it at #/debug.
 *
 * Fifteen minutes of work that pays for itself the first time two phones
 * disagree about something: you can see exactly which events each one has.
 */
export function debugScreen(root: HTMLElement): void {
  const events = sync.events();
  const w = getWorld();

  root.append(
    h(
      "div.screen-head",
      null,
      h("h1", null, "Debug"),
      h("button.btn.btn-sm", { onclick: () => sync.pokeNow() }, S.refresh)
    )
  );

  root.append(
    h(
      "div.panel",
      null,
      row("me", me.id || "(none)"),
      row("name", me.name || "(none)"),
      row("host", String(me.isHost)),
      row("sync", sync.status()),
      row("pending", String(sync.pendingCount())),
      row("events", String(events.length)),
      row("players", String(w.players.size)),
      row("bingo phase", w.bingoPhase),
      row("freeze id", w.freeze ? String(w.freeze.id) : "(not frozen)"),
      row("pool size", String(w.freeze?.poolIds.length ?? 0)),
      row("truths phase", w.truthsPhase)
    )
  );

  const list = h("div.panel");
  for (const e of events.slice(-60).reverse()) {
    list.append(
      h(
        "div.row",
        null,
        h(
          "div.row-main",
          null,
          h("div", null, bdi(e.id), " ", h("span.pill", null, e.kind)),
          h("div.row-sub", { dir: "ltr", style: "word-break:break-all" }, JSON.stringify(e.payload)),
          h("div.row-sub", { dir: "auto" }, w.players.get(e.player)?.name ?? e.player.slice(0, 8))
        )
      )
    );
  }
  root.append(list);
}

function row(label: string, value: string): HTMLElement {
  return h(
    "div.row",
    null,
    h("div.row-main", null, h("span.muted", null, label)),
    h("div", { dir: "ltr", style: "word-break:break-all;font-size:13px" }, value)
  );
}
