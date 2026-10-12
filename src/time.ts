/** Time helpers. The card works in UTC epoch milliseconds and only needs the time zone for "midnight". */

export const PART_MS = 5 * 60_000;
export const SLOT_MS = 15 * 60_000;
export const SLOTS = 96;
export const WINDOW_MS = SLOTS * SLOT_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(key, f);
  }
  return f;
}

/** Wall-clock reading of `ts` in the zone, as a UTC timestamp: the zone's offset is `result - ts`. */
function wallClockAsUtc(ts: number, timeZone: string | undefined): number {
  const v: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(ts)) {
    if (p.type !== "literal") v[p.type] = Number(p.value);
  }
  const whole = Math.floor(ts / 1000) * 1000;
  return (
    Date.UTC(v.year ?? 1970, (v.month ?? 1) - 1, v.day ?? 1, v.hour ?? 0, v.minute ?? 0, v.second ?? 0) -
    whole +
    ts
  );
}

/** UTC timestamp of local midnight of the day containing `ts`. `undefined` zone = the browser's zone. */
export function startOfDay(ts: number, timeZone?: string): number {
  const wall = wallClockAsUtc(ts, timeZone);
  const midnightWall = Math.floor(wall / 86_400_000) * 86_400_000;
  // The zone's offset at midnight can differ from the offset at `ts` on a DST day: look it up at the first guess.
  let guess = midnightWall - (wall - ts);
  guess = midnightWall - (wallClockAsUtc(guess, timeZone) - guess);
  return guess;
}

/** Start of the quarter hour that contains `ts`. */
export function floorToSlot(ts: number): number {
  return ts - (((ts % SLOT_MS) + SLOT_MS) % SLOT_MS);
}
