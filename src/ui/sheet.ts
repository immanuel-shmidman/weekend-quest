/**
 * Bottom sheet.
 *
 * Used wherever a tap needs a confirmation or more room than a grid cell can
 * give. Phone-shaped: rises from the bottom edge, dismisses on backdrop tap or
 * Escape, and respects the home-indicator safe area.
 */

import { h } from "./dom";
import { strings } from "../i18n";

const S = strings({
  he: { cancel: "ביטול" },
  en: { cancel: "Cancel" },
});

export interface SheetOptions {
  /** Rendered into the sheet body. */
  content: (close: () => void) => Node[];
}

export function openSheet(opts: SheetOptions): () => void {
  const sheet = h("div.sheet");
  const backdrop = h("div.sheet-backdrop", null, sheet);

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);

  sheet.append(...opts.content(close));
  document.body.append(backdrop);
  return close;
}

/**
 * A two-step confirm. The primary action is deliberately not armed on first
 * tap: marking a bingo square is global and everyone sees it, and phone
 * fat-fingers are real.
 */
export function confirmSheet(opts: {
  title: string;
  body?: Node | string;
  confirmLabel: string;
  armedLabel: string;
  onConfirm: () => void;
  extra?: (close: () => void) => Node | null;
}): void {
  openSheet({
    content: (close) => {
      let armed = false;
      const btn = h("button.btn.btn-primary.btn-block", {
        onclick: () => {
          if (!armed) {
            armed = true;
            btn.textContent = opts.armedLabel;
            btn.classList.add("btn-good");
            return;
          }
          opts.onConfirm();
          close();
        },
      });
      btn.textContent = opts.confirmLabel;

      const nodes: Node[] = [h("div.sheet-text", { dir: "auto" }, opts.title)];
      if (opts.body) {
        nodes.push(typeof opts.body === "string" ? h("div.muted", null, opts.body) : opts.body);
      }
      nodes.push(h("div", { style: "margin-block-start:14px" }, btn));

      const extra = opts.extra?.(close);
      if (extra) nodes.push(h("div", { style: "margin-block-start:8px" }, extra));

      nodes.push(
        h(
          "button.btn.btn-sm.btn-block",
          { onclick: close, style: "margin-block-start:8px;background:transparent" },
          S.cancel
        )
      );
      return nodes;
    },
  });
}
