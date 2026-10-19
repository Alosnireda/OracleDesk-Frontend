import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { activateDailyPass, getPaymentEvents } from "@/lib/api/traces";
import { savePending, type PendingPayment } from "../pending";
import { RETRY_DELAYS_MS, verifyPendingPayment } from "../verify";

vi.mock("@/lib/api/traces", () => ({
  activateDailyPass: vi.fn(),
  getPaymentEvents: vi.fn(),
}));

const activate = vi.mocked(activateDailyPass);
const events = vi.mocked(getPaymentEvents);

const apiError = (code: string, status: number) => new ApiError({ code, message: code }, status);
const instantSleep = async () => {};

const payment: PendingPayment = {
  txHash: "d".repeat(64),
  kind: "DAILY_PASS",
  amountRaw: "5000000",
  from: "GWALLET",
  recipient: "GRECIPIENT",
  networkPassphrase: "Test",
  createdAt: Date.now(),
  attempts: 0,
  state: "submitted",
};

beforeEach(() => {
  vi.clearAllMocks();
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  savePending(payment);
});

describe("verifyPendingPayment", () => {
  it("retries a not-yet-indexed payment until it verifies", async () => {
    activate
      .mockRejectedValueOnce(apiError("PAYMENT_NOT_FOUND", 402))
      .mockRejectedValueOnce(apiError("PAYMENT_NOT_FOUND", 402))
      .mockResolvedValueOnce({ subscription: {}, trace: null });

    const result = await verifyPendingPayment(payment, { sleep: instantSleep });

    expect(result).toBe("verified");
    expect(activate).toHaveBeenCalledTimes(3);
  });

  it("stops at a terminal error without retrying", async () => {
    activate.mockRejectedValueOnce(apiError("PAYMENT_WRONG_RECIPIENT", 402));

    const result = await verifyPendingPayment(payment, { sleep: instantSleep });

    expect(result).toBe("failed-terminal");
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("asks to sign in once, then resumes", async () => {
    activate.mockRejectedValueOnce(apiError("TOKEN_EXPIRED", 401)).mockResolvedValueOnce({ subscription: {}, trace: null });
    const signIn = vi.fn().mockResolvedValue(true);

    const result = await verifyPendingPayment(payment, { signIn, sleep: instantSleep });

    expect(result).toBe("verified");
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("leaves the payment resumable after the foreground retries run out", async () => {
    activate.mockRejectedValue(apiError("CHAIN_READ_FAILED", 502));

    const result = await verifyPendingPayment(payment, { sleep: instantSleep });

    expect(result).toBe("submitted");
    expect(activate).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
  });

  it("shares one run between concurrent calls for the same hash", () => {
    activate.mockResolvedValue({ subscription: {}, trace: null });

    const first = verifyPendingPayment(payment, { sleep: instantSleep });
    const second = verifyPendingPayment(payment, { sleep: instantSleep });

    expect(second).toBe(first);
  });

  it("treats an already-used hash as verified when this account confirmed it", async () => {
    activate.mockRejectedValueOnce(apiError("PAYMENT_ALREADY_USED", 409));
    events.mockResolvedValueOnce([
      { id: "1", txHash: "d".repeat(64), type: "DAILY_PASS", amountRaw: "5000000", status: "CONFIRMED", createdAt: "", confirmedAt: null },
    ]);

    const result = await verifyPendingPayment(payment, { sleep: instantSleep });

    expect(result).toBe("verified");
  });

  it("reports another account's use of the hash as terminal", async () => {
    activate.mockRejectedValueOnce(apiError("PAYMENT_ALREADY_USED", 409));
    events.mockResolvedValueOnce([]);

    const result = await verifyPendingPayment(payment, { sleep: instantSleep });

    expect(result).toBe("failed-terminal");
  });
});
