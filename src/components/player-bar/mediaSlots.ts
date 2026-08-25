import { useSyncExternalStore } from "react";

/**
 * Registry for the two portal slots a live <video> element may occupy
 * (DESIGN §4.9): the Now Playing artwork frame (primary) and the global
 * PlayerBar thumb (secondary). React portals preserve DOM identity, so
 * reparenting between slots never interrupts playback.
 */

type Slots = {
  primary: HTMLDivElement | null;
  secondary: HTMLDivElement | null;
};

const els: Slots = { primary: null, secondary: null };
const subs = new Set<() => void>();

function notify() {
  subs.forEach((f) => f());
}

export function setPrimarySlot(el: HTMLDivElement | null) {
  if (els.primary !== el) {
    els.primary = el;
    notify();
  }
}

export function setSecondarySlot(el: HTMLDivElement | null) {
  if (els.secondary !== el) {
    els.secondary = el;
    notify();
  }
}

export function subscribeSlots(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** Snapshot is a primitive so useSyncExternalStore can diff it. */
export function slotsSnapshot(): string {
  return `${els.primary ? "P" : "p"}${els.secondary ? "S" : "s"}`;
}

export function useSlotEls(): Slots {
  useSyncExternalStore(subscribeSlots, slotsSnapshot);
  return els;
}
