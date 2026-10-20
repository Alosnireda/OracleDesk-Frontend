import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { unlockTrace, type PolicyEvaluator } from "../client";
import {
  JournalUnavailableError,
  checkSettlement,
  createJournal,
  inspectPaymentHeader,
  paymentEvidence,
  type JournalEntry,
} from "../recovery";
import { PAYER, fakeChain, fakeDeps, requirementFor, signedHeader } from "./fakes";

const allow: PolicyEvaluator = () => ({ allow: true });
const TRACE = "7";

describe("x402 payment journal", () => {
  it("persists the signed entry before the paid request leaves the browser", async () => {
    const { deps, service } = fakeDeps();
    let journaledAtSend: JournalEntry | undefined;
    service.onPaidRequest = async () => {
      journaledAtSend = await deps.journal!.findOpen(PAYER, "stellar:testnet", TRACE);
    };

    const result = await unlockTrace({ onChainTraceId: TRACE, wallet: PAYER, evaluate: allow }, deps);

    expect(journaledAtSend).toBeDefined();
    expect(journaledAtSend?.paymentHeader).toBe(service.requests[1].paymentHeader);
    expect(journaledAtSend?.nonce).toBe("1");
    expect(result).toMatchObject({ status: "unlocked", paidRaw: 100_000n, settlementTxHash: `tx-${TRACE}` });
    const stored = await deps.journal!.findOpen(PAYER, "stellar:testnet", TRACE);
    expect(stored).toMatchObject({ state: "delivered", contentHash: "a".repeat(64), settlementTxHash: `tx-${TRACE}` });
  });

  it("redelivers the stored header after a reload and never signs again", async () => {
    const factory = new IDBFactory();
    const first = fakeDeps({ journal: createJournal(factory) });
    first.service.paid.push("network", "network", "network", "network");
    const interrupted = await unlockTrace({ onChainTraceId: TRACE, wallet: PAYER, evaluate: allow }, first.deps);
    expect(interrupted.status).toBe("retryable");
    expect(first.signs).toHaveLength(1);
    const header = first.service.requests[1].paymentHeader;

    // A reload: new journal handle on the same database, new signer.
    const reloaded = fakeDeps({ journal: createJournal(factory), service: first.service, chain: first.chain });
    const result = await unlockTrace({ onChainTraceId: TRACE, wallet: PAYER, evaluate: allow }, reloaded.deps);

    expect(result.status).toBe("unlocked");
    expect(reloaded.signs).toHaveLength(0);
    expect(first.service.requests.at(-1)?.paymentHeader).toBe(header);
  });

  it("marks failed-retryable on 502 and retries with 1 s, 3 s, 10 s backoff", async () => {
    const { deps, service, sleeps } = fakeDeps();
    service.paid.push("502", "502", "502", "502");

    const result = await unlockTrace({ onChainTraceId: TRACE, wallet: PAYER, evaluate: allow }, deps);

    expect(result.status).toBe("retryable");
    expect(sleeps).toEqual([1_000, 3_000, 10_000]);
    const entry = await deps.journal!.findOpen(PAYER, "stellar:testnet", TRACE);
    expect(entry).toMatchObject({ state: "failed-retryable", attempts: 4 });
    expect(entry?.lastError).toContain("502");
  });

  it("marks settled-undelivered when a rejected redelivery turns out to have settled", async () => {
    const { deps, service, chain } = fakeDeps();
    service.paid.push("reject");
    chain.transfersList.push({ txHash: "settled-tx", amount: 100_000n });
    chain.txs.set("settled-tx", { status: "SUCCESS", signatures: [{ address: PAYER, nonce: "1", expirationLedger: 1_060 }] });

    const result = await unlockTrace({ onChainTraceId: TRACE, wallet: PAYER, evaluate: allow }, deps);

    expect(result).toMatchObject({ status: "settled-undelivered" });
    const entry = await deps.journal!.findOpen(PAYER, "stellar:testnet", TRACE);
    expect(entry).toMatchObject({ state: "settled-undelivered", settlementTxHash: "settled-tx" });

    // Opening the trace again never offers a new payment.
    const again = await unlockTrace({ onChainTraceId: TRACE, wallet: PAYER, evaluate: allow }, deps);
    expect(again.status).toBe("settled-undelivered");
  });

  it("marks a tampered 200 after payment as settled-undelivered, not unlocked", async () => {
    const { deps, service } = fakeDeps();
    service.paid.push("tampered");
    const result = await unlockTrace({ onChainTraceId: TRACE, wallet: PAYER, evaluate: allow }, deps);
    expect(result).toMatchObject({ status: "settled-undelivered", reason: "hash-mismatch" });
  });

  it("allows a new payment only after the expiration ledger passes unsettled", async () => {
    const { deps, service, chain, signs } = fakeDeps();
    service.paid.push("reject");
    const rejected = await unlockTrace({ onChainTraceId: TRACE, wallet: PAYER, evaluate: allow }, deps);
    // Not settled, but it still can until ledger 1060: keep it, don't pay again.
    expect(rejected.status).toBe("retryable");

    chain.ledger = 1_061;
    const expired = await unlockTrace({ onChainTraceId: TRACE, wallet: PAYER, evaluate: allow }, deps);
    expect(expired.status).toBe("expired");
    expect(signs).toHaveLength(1);

    const repaid = await unlockTrace({ onChainTraceId: TRACE, wallet: PAYER, evaluate: allow, payAgainIfExpired: true }, deps);
    expect(repaid.status).toBe("unlocked");
    expect(signs).toHaveLength(2);
  });

  it("isolates entries by wallet and network", async () => {
    const journal = createJournal(new IDBFactory());
    const base = {
      onChainTraceId: TRACE,
      x402Origin: "http://x402.test",
      requirement: requirementFor("1"),
      amountRaw: "1",
      paymentHeader: "h",
      state: "sent" as const,
      attempts: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    await journal.put({ ...base, id: "a", wallet: PAYER, network: "stellar:testnet" });
    await journal.put({ ...base, id: "b", wallet: "GOTHER", network: "stellar:testnet" });
    await journal.put({ ...base, id: "c", wallet: PAYER, network: "stellar:pubnet" });

    expect((await journal.findOpen(PAYER, "stellar:testnet", TRACE))?.id).toBe("a");
    expect((await journal.findOpen(PAYER, "stellar:pubnet", TRACE))?.id).toBe("c");
    expect((await journal.list("GOTHER", "stellar:testnet")).map((e) => e.id)).toEqual(["b"]);
    expect(await journal.findOpen("GNOBODY", "stellar:testnet", TRACE)).toBeUndefined();
  });

  it("refuses to sign when IndexedDB is unavailable", async () => {
    expect(() => createJournal(undefined)).toThrow(JournalUnavailableError);
    const { deps, signs } = fakeDeps({ journal: null });
    await expect(unlockTrace({ onChainTraceId: TRACE, wallet: PAYER, evaluate: allow }, deps)).rejects.toBeInstanceOf(JournalUnavailableError);
    expect(signs).toHaveLength(0);
  });

  it("does not sign when the policy denies", async () => {
    const { deps, signs } = fakeDeps();
    const result = await unlockTrace(
      { onChainTraceId: TRACE, wallet: PAYER, evaluate: () => ({ allow: false, reason: "over-daily" }) },
      deps,
    );
    expect(result).toEqual({ status: "denied", reason: "over-daily", message: undefined });
    expect(signs).toHaveLength(0);
  });
});

describe("settlement check", () => {
  const requirement = requirementFor("100000");
  const header = signedHeader(requirement, 42n, 2_000);
  const entry: JournalEntry = {
    id: "e",
    wallet: PAYER,
    network: "stellar:testnet",
    x402Origin: "http://x402.test",
    onChainTraceId: TRACE,
    requirement,
    amountRaw: "100000",
    paymentHeader: header,
    ...inspectPaymentHeader(header, PAYER),
    state: "sent",
    attempts: 1,
    createdAt: 1,
    updatedAt: 1,
  };

  it("reads nonce and expiration ledger from the signed header", () => {
    expect(inspectPaymentHeader(header, PAYER)).toEqual({ nonce: "42", expirationLedger: 2_000 });
    expect(inspectPaymentHeader("not-base64-json", PAYER)).toEqual({});
  });

  it("ignores a same-amount transfer carrying another payment's nonce", async () => {
    const chain = fakeChain(2_001);
    chain.transfersList.push({ txHash: "other", amount: 100_000n });
    chain.txs.set("other", { status: "SUCCESS", signatures: [{ address: PAYER, nonce: "41", expirationLedger: 2_000 }] });
    expect(await checkSettlement(entry, chain)).toEqual({ status: "not-settled", final: true });

    chain.transfersList.push({ txHash: "mine", amount: 100_000n });
    chain.txs.set("mine", { status: "SUCCESS", signatures: [{ address: PAYER, nonce: "42", expirationLedger: 2_000 }] });
    expect(await checkSettlement(entry, chain)).toEqual({ status: "settled", txHash: "mine" });
  });

  it("is not final before the expiration ledger and unknown when events are incomplete", async () => {
    const chain = fakeChain(1_999);
    expect(await checkSettlement(entry, chain)).toEqual({ status: "not-settled", final: false });
    chain.transfers = async () => ({ transfers: [], complete: false });
    expect((await checkSettlement(entry, chain)).status).toBe("unknown");
  });

  it("keeps the payment header out of support evidence", () => {
    expect(paymentEvidence(entry)).not.toHaveProperty("paymentHeader");
    expect(JSON.stringify(paymentEvidence(entry))).not.toContain(header);
  });
});
