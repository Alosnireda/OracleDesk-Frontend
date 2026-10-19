import deployments from "@/lib/stellar/generated/deployments.testnet.json";
import { CONTRACTS, PAYMENTS_RECIPIENT } from "@/lib/stellar/config";
import { shortAddress } from "@/lib/stellar/units";

/**
 * Redaction rules shared by the debug panel's "Copy diagnostics" and any
 * future error reporting. Pure: redact() never mutates its input.
 *
 * Rules apply in order to every string, and to every value under a key that
 * looks like a credential (authorization, token, jwt, secret, password).
 */

export interface RedactionRule {
  name: string;
  pattern: RegExp;
  replace: (match: string) => string;
}

/** Public infrastructure addresses: contract ids, recipient, deployer and agent. Kept whole. */
export const PUBLIC_ADDRESSES: ReadonlySet<string> = new Set(
  [
    ...Object.values(CONTRACTS),
    PAYMENTS_RECIPIENT,
    deployments.deployer,
    deployments.agent,
    ...Object.values(deployments.contracts),
  ].filter(Boolean),
);

let warnedSeed = false;

export const REDACTION_RULES: readonly RedactionRule[] = [
  {
    name: "secret-seed",
    pattern: /\bS[A-Z2-7]{55}\b/g,
    replace: () => {
      if (!warnedSeed) {
        warnedSeed = true;
        console.warn("[diagnostics] A Stellar secret seed was found in diagnostics data and redacted. It should never be there.");
      }
      return "[secret-seed]";
    },
  },
  { name: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, replace: () => "[jwt]" },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, replace: () => "[jwt]" },
  {
    name: "url",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi,
    replace: (url) => {
      try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}${u.pathname}`;
      } catch {
        return url.split(/[?#]/)[0].replace(/\/\/[^/@]*@/, "//");
      }
    },
  },
  { name: "xdr", pattern: /[A-Za-z0-9+/]{65,}={0,2}/g, replace: (m) => `[xdr:${m.length}]` },
  {
    name: "account",
    pattern: /\b[GM][A-Z2-7]{55}(?:[A-Z2-7]{13})?\b/g,
    replace: (addr) => (PUBLIC_ADDRESSES.has(addr) ? addr : shortAddress(addr)),
  },
  // C-addresses (contracts) are public and kept whole: no rule.
];

const SENSITIVE_KEY = /^(authorization|token|jwt|access_?token|secret|password|seed|signedTxXdr|xdr)$/i;

function redactString(s: string): string {
  return REDACTION_RULES.reduce((acc, rule) => acc.replace(rule.pattern, (m) => rule.replace(m)), s);
}

/** Walks objects, arrays and strings; bigints become strings. */
export function redact(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key) && value != null && value !== "") {
    return /xdr/i.test(key) ? `[xdr:${String(value).length}]` : "[jwt]";
  }
  if (typeof value === "string") return redactString(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value instanceof Uint8Array) return `[bytes:${value.length}]`;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  return value;
}
