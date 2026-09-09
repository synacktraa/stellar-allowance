import { LEDGERS_PER_HOUR } from '../demo/params';

// Everything the table shows about one allowance, read from its instance entry.
export interface Summary {
  id: string;
  index: number;
  name: string;
  owner: string;
  token: string;
  cap: bigint;
  windowLedgers: number;
  windowHours: number;
  allowlist: string[];
  enabled: boolean;
}

interface Rules {
  allowlist: string[];
  window_cap: bigint;
  window_ledgers: number;
}

// `Disabled` is written only when an owner pauses, so its absence is the healthy case.
export function summarize(id: string, index: number, storage: Record<string, unknown>): Summary {
  const rules = storage.Rules as Rules;
  return {
    id,
    index,
    name: String(storage.Name ?? ''),
    owner: String(storage.Owner ?? ''),
    token: String(storage.Token ?? ''),
    cap: rules.window_cap,
    windowLedgers: rules.window_ledgers,
    windowHours: Math.round((rules.window_ledgers / LEDGERS_PER_HOUR) * 10) / 10,
    allowlist: [...rules.allowlist],
    enabled: storage.Disabled !== true,
  };
}

/** What is left of the cap. A cap lowered under what is already spent leaves nothing. */
export const remaining = (cap: bigint, spent: bigint) => (cap > spent ? cap - spent : 0n);

export const PAGE_SIZE = 15;

export const pageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

export const page = <T>(rows: T[], number: number): T[] =>
  rows.slice((number - 1) * PAGE_SIZE, number * PAGE_SIZE);
