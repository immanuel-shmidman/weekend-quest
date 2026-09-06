import { h, bdi } from "../ui/dom";
import { go } from "../router";
import { getWorld } from "../world";
import { standings } from "../store";
import { me } from "../identity";
import * as sync from "../sync";
import { strings } from "../i18n";

const S = strings({
  he: {
    title: "טבלת האירוע",
    back: "חזרה",
    empty: "עוד אף אחד לא נרשם.",
    pts: " נק׳",
    offline: "אין חיבור כרגע — הטבלה עשויה להיות לא מעודכנת.",
    refresh: "רענון",
    home: "למסך הראשי",
  },
  en: {
    title: "Standings",
    back: "Back",
    empty: "Nobody has joined yet.",
    pts: " pts",
    offline: "No connection right now — the table may be out of date.",
    refresh: "Refresh",
    home: "Home",
  },
});

/** The full standings, reachable from the bar at the bottom of every screen. */
export function scoresScreen(root: HTMLElement): void {
  const w = getWorld();
  const rows = standings(w);

  root.append(
    h(
      "div.screen-head",
      null,
      h("h1", null, S.title),
      h("button.btn.btn-sm", { onclick: () => history.back() }, S.back)
    )
  );

  if (!rows.length) {
    root.append(h("div.panel.center", null, h("p", null, S.empty)));
    return;
  }

  const table = h("table.standings");
  for (const r of rows) {
    const tr = h("tr", { class: r.id === me.id ? "me" : "" });
    tr.append(
      h("td.col-rank", null, bdi(r.rank)),
      h("td", { dir: "auto" }, r.name),
      h("td.col-score", null, bdi(r.score), S.pts)
    );
    table.append(tr);
  }
  root.append(h("div.panel", null, table));

  if (sync.status() !== "live") {
    root.append(
      h(
        "div.center",
        null,
        h("div.muted", null, S.offline),
        h(
          "button.btn.btn-sm",
          { onclick: () => sync.pokeNow(), style: "margin-block-start:8px" },
          S.refresh
        )
      )
    );
  }

  root.append(
    h(
      "button.btn.btn-block",
      { onclick: () => go("#/"), style: "margin-block-start:12px" },
      S.home
    )
  );
}
