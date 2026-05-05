// Table-driven tick scheduler for matchLoop sub-systems.
// Each entry fires at a fixed interval (in master ticks). Counter state lives
// in WorldMatchState.tickCounters so it survives Goja state round-trips.

export interface TickHandler {
  interval: number;
  handler: () => void;
}

export interface TickCounters {
  [name: string]: number;
}

export function runScheduledTicks(
  counters: TickCounters,
  table: Record<string, TickHandler>,
): TickCounters {
  const updated: TickCounters = { ...counters };
  for (const name of Object.keys(table)) {
    const entry = table[name]!;
    const prev = updated[name] ?? 0;
    const next = prev + 1;
    if (next >= entry.interval) {
      entry.handler();
      updated[name] = 0;
    } else {
      updated[name] = next;
    }
  }
  return updated;
}
