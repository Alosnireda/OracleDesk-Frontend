import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isUnfinishedPayment, listPending, removePending, savePending, updatePending, type PendingPayment } from "../pending";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const payment = (overrides: Partial<PendingPayment> = {}): PendingPayment => ({
  txHash: "A".repeat(64),
  kind: "DAILY_PASS",
  amountRaw: "5000000",
  from: "GWALLET",
  recipient: "GRECIPIENT",
  networkPassphrase: "Test SDF Network ; September 2015",
  createdAt: Date.now(),
  attempts: 0,
  state: "submitted",
  ...overrides,
});

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pending payments", () => {
  it("stores the hash in lowercase and lists only the matching wallet and network", () => {
    savePending(payment());
    savePending(payment({ txHash: "b".repeat(64), from: "GOTHER" }));
    savePending(payment({ txHash: "c".repeat(64), networkPassphrase: "Public" }));

    const listed = listPending("GWALLET", "Test SDF Network ; September 2015");
    expect(listed.map((entry) => entry.txHash)).toEqual(["a".repeat(64)]);
  });

  it("updates and removes entries by hash", () => {
    savePending(payment());
    updatePending("A".repeat(64), { state: "verified", attempts: 2 });

    const [updated] = listPending("GWALLET", "Test SDF Network ; September 2015");
    expect(updated.state).toBe("verified");
    expect(updated.attempts).toBe(2);

    removePending("a".repeat(64));
    expect(listPending("GWALLET", "Test SDF Network ; September 2015")).toEqual([]);
  });

  it("ignores corrupted stored JSON", () => {
    storage.setItem("oracledesk_pending_payments_v1", "{not json");
    expect(listPending("GWALLET", "Test SDF Network ; September 2015")).toEqual([]);
  });

  it("survives storage that throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("quota");
        },
      },
    });

    expect(listPending("GWALLET", "Test SDF Network ; September 2015")).toEqual([]);
    expect(savePending(payment())).toBe(false);
  });

  it("treats verified and failed-terminal entries as finished", () => {
    expect(isUnfinishedPayment(payment({ state: "submitted" }))).toBe(true);
    expect(isUnfinishedPayment(payment({ state: "needs-auth" }))).toBe(true);
    expect(isUnfinishedPayment(payment({ state: "verified" }))).toBe(false);
    expect(isUnfinishedPayment(payment({ state: "failed-terminal" }))).toBe(false);
  });
});
