import { ApiError } from "@/lib/api/client";
import { activateDailyPass, getPaymentEvents } from "@/lib/api/traces";
import { classifyUnlockError } from "./classify";
import { updatePending, type PendingPayment, type PendingState } from "./pending";

/** Waits before each foreground retry. Anything still pending after these stays resumable on the next visit. */
export const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

export type VerifyResult = "verified" | "submitted" | "needs-auth" | "failed-terminal";

interface VerifyOptions {
  /** Opens the wallet sign-in. Omit it to stop at "needs-auth" instead of prompting (used on page load). */
  signIn?: () => Promise<boolean>;
  onUpdate?: () => void;
  sleep?: (ms: number) => Promise<void>;
}

const inFlight = new Map<string, Promise<VerifyResult>>();

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function hasConfirmedPayment(txHash: string): Promise<boolean> {
  const events = await getPaymentEvents();
  return events.some((event) => event.txHash.toLowerCase() === txHash && event.status === "CONFIRMED");
}

/**
 * Asks the backend to activate a pass for a payment that is already on-chain.
 * Never sends USDC; re-running it for the same hash is safe because the backend
 * returns the existing subscription. Concurrent calls for one hash share a promise.
 */
export function verifyPendingPayment(payment: PendingPayment, options: VerifyOptions = {}): Promise<VerifyResult> {
  const txHash = payment.txHash.toLowerCase();
  const running = inFlight.get(txHash);
  if (running) return running;

  const run = runVerification({ ...payment, txHash }, options).finally(() => inFlight.delete(txHash));
  inFlight.set(txHash, run);
  return run;
}

async function runVerification(payment: PendingPayment, options: VerifyOptions): Promise<VerifyResult> {
  const sleep = options.sleep ?? wait;
  const { txHash, amountRaw } = payment;
  let attempts = payment.attempts;
  let signInTried = false;

  const finish = (state: PendingState, lastError?: { code: string; status: number }): VerifyResult => {
    updatePending(txHash, { state, lastError });
    options.onUpdate?.();
    return state === "verified" || state === "failed-terminal" || state === "needs-auth" ? state : "submitted";
  };

  for (let retry = 0; ; retry++) {
    attempts += 1;
    updatePending(txHash, { state: "verifying", attempts });
    options.onUpdate?.();

    try {
      await activateDailyPass(txHash, amountRaw);
      return finish("verified");
    } catch (error) {
      const lastError = {
        code: error instanceof ApiError ? error.code : "UNKNOWN",
        status: error instanceof ApiError ? error.status : 0,
      };
      const verdict = classifyUnlockError(error);

      if (verdict === "needs-auth") {
        if (!signInTried && options.signIn) {
          signInTried = true;
          if (await options.signIn()) continue;
        }
        return finish("needs-auth", lastError);
      }

      if (verdict === "retry") {
        if (retry >= RETRY_DELAYS_MS.length) return finish("submitted", lastError);
        updatePending(txHash, { lastError });
        options.onUpdate?.();
        await sleep(RETRY_DELAYS_MS[retry]);
        continue;
      }

      if (lastError.code === "PAYMENT_ALREADY_USED" && (await hasConfirmedPayment(txHash).catch(() => false))) {
        return finish("verified");
      }
      return finish("failed-terminal", lastError);
    }
  }
}
