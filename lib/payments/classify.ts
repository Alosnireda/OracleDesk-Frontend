import { ApiError } from "@/lib/api/client";

export type Verdict = "retry" | "terminal" | "needs-auth";

const RETRY_CODES = new Set(["PAYMENT_NOT_FOUND", "CHAIN_READ_FAILED", "BACKEND_UNREACHABLE"]);
const AUTH_CODES = new Set(["TOKEN_EXPIRED", "INVALID_TOKEN", "UNAUTHORIZED"]);

const TERMINAL_MESSAGES: Record<string, string> = {
  PAYMENT_FAILED: "The transaction failed on-chain, so no access was granted. Check the transaction on the explorer.",
  PAYMENT_WRONG_TOKEN: "The transaction did not transfer USDC. No access was granted.",
  PAYMENT_WRONG_SENDER: "The transaction was sent from a different account than the one you are signed in with. No access was granted.",
  PAYMENT_WRONG_RECIPIENT: "The transaction paid a different recipient than OracleDesk's payment address. No access was granted.",
  PAYMENT_INSUFFICIENT: "The transaction paid less than the daily pass price. No access was granted.",
  PAYMENT_ALREADY_USED: "This transaction was already used to unlock access for another account. No access was granted to you.",
  ALLOWANCE_DAILY_LIMIT: "Your daily spending limit blocks this purchase. No access was granted.",
  VALIDATION_ERROR: "The server rejected the payment details. No access was granted.",
};

export function classifyUnlockError(err: unknown): Verdict {
  if (err instanceof ApiError) {
    if (AUTH_CODES.has(err.code) || err.status === 401) return "needs-auth";
    if (RETRY_CODES.has(err.code) || err.status >= 500) return "retry";
    return "terminal";
  }
  return "retry";
}

/** The explanation shown for a terminal failure; falls back to the server's own message. */
export function terminalMessage(code: string, fallback?: string): string {
  return TERMINAL_MESSAGES[code] ?? fallback ?? "Access was not granted. Contact support with the transaction details.";
}
