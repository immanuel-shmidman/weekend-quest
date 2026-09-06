/**
 * The current folded world, kept in one place so screens can read it
 * synchronously without each re-folding the log.
 *
 * sync.ts owns the events; this owns the derived view and the "something
 * changed" broadcast.
 */

import * as sync from "./sync";
import { fold, type World } from "./store";

let world: World = fold([]);
const listeners = new Set<(w: World) => void>();

export function getWorld(): World {
  return world;
}

/** Subscribe to world changes. Returns an unsubscribe function for teardown. */
export function onWorld(cb: (w: World) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function startWorld(): void {
  sync.start((events) => {
    world = fold(events);
    for (const cb of listeners) cb(world);
  });
}
