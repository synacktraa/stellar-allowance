/** The allowance's error discriminants, as rules a caller can branch on. */
export const RULES: Readonly<Record<number, string>> = {
  101: 'not-set-up',
  102: 'allowlist',
  103: 'malformed',
  104: 'wrong-asset',
  105: 'not-a-transfer',
  106: 'window',
  107: 'stopped',
  108: 'invalid-amount',
  109: 'name-too-long',
};

/** The allowance refused to pay. `rule` names which rule; `detail` is what the host said. */
export class AllowanceRefused extends Error {
  readonly code: number;
  readonly rule: string;
  readonly detail: string;

  constructor(code: number, detail: string) {
    // The discriminant stays in the message because `@x402/fetch` rethrows a plain Error
    // carrying only this string, and `refusalFrom` has to rebuild the refusal from it.
    super(`allowance refused the payment: ${RULES[code]}, Error(Contract, #${code})`);
    this.name = 'AllowanceRefused';
    this.code = code;
    this.rule = RULES[code];
    this.detail = detail;
  }
}

const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/;

/**
 * Reads a refusal out of a host error message.
 *
 * Returns undefined for anything the allowance did not raise, including the token's own
 * discriminants, which share the message format and start at 1.
 */
export function refusalFrom(detail: string): AllowanceRefused | undefined {
  const match = CONTRACT_ERROR.exec(detail);
  if (!match) return undefined;
  const code = Number(match[1]);
  return code in RULES ? new AllowanceRefused(code, detail) : undefined;
}
