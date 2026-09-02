import type { RunEvent } from "../src/types";

/**
 * Narrowing helpers for `RunEvent`, which is a discriminated union.
 *
 * A plain `events.filter((e) => e.kind === "x")` predicate does not narrow the
 * result type, so every later `event.id` is a type error even though the check
 * is correct at run time. These return type predicates instead, so the union is
 * narrowed once and the assertions keep their real types.
 */
export type EventOfKind<K extends RunEvent["kind"]> = Extract<RunEvent, { kind: K }>;

export function isKind<K extends RunEvent["kind"]>(kind: K) {
  return (event: RunEvent): event is EventOfKind<K> => event.kind === kind;
}

export function eventsOfKind<K extends RunEvent["kind"]>(
  events: readonly RunEvent[],
  kind: K,
): EventOfKind<K>[] {
  return events.filter(isKind(kind));
}

export function firstOfKind<K extends RunEvent["kind"]>(
  events: readonly RunEvent[],
  kind: K,
): EventOfKind<K> | undefined {
  return events.find(isKind(kind));
}

export function lastOfKind<K extends RunEvent["kind"]>(
  events: readonly RunEvent[],
  kind: K,
): EventOfKind<K> | undefined {
  const matching = eventsOfKind(events, kind);
  return matching.length > 0 ? matching[matching.length - 1] : undefined;
}
