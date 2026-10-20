/**
 * Contract tests between the frontend x402 client (lib/x402/client.ts) and
 * the contracts repo's trace service (pinned submodule, real createTraceApi),
 * fully offline. Run: npm run e2e:x402 (see CONTRIBUTING.md).
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Keypair, hash } from "@stellar/stellar-sdk";
import { canonicalize } from "../../contracts/oracledesk-stellar/agents/core/trace.ts";
import {
  createPaymentHeader,
  deliverWithPayment,
  requestRequirements,
  selectRequirement,
  type X402Signer,
  type X402Transport,
} from "@/lib/x402/client";
import {
  FAKE_LEDGER,
  FIXTURE_USDC,
  PRICE_ATOMIC,
  TRACE_IDS,
  installNetworkGuard,
  loadTraceService,
  startX402Harness,
  type NetworkGuard,
  type X402Harness,
} from "./harness";
import { FAKE_SETTLEMENT_TX } from "./stub-facilitator";

/** @x402/stellar 2.26 estimates ledger close time from Horizon; the guard refuses it and the scheme falls back to 5 s. */
const KNOWN_REFUSED_PROBES = new Set(["horizon-testnet.stellar.org"]);

/** A test wallet: signs Soroban auth-entry preimages like a SEP-43 wallet (signature over sha256(preimage)). */
function keypairSigner(keypair = Keypair.random()): X402Signer {
  return {
    address: keypair.publicKey(),
    signAuthEntry: async (preimageXdr) => ({
      signedAuthEntry: keypair.sign(hash(Buffer.from(preimageXdr, "base64"))).toString("base64"),
      signerAddress: keypair.publicKey(),
    }),
  };
}

let guard: NetworkGuard;
let harness: X402Harness;
let transport: X402Transport;

/** Asks for the trace, builds and signs the payment, and returns the signed header. */
async function signedPayment(onChainTraceId: string) {
  const first = await requestRequirements(onChainTraceId, transport);
  if (first.status !== "payment-required") throw new Error(`expected 402 for trace ${onChainTraceId}, got 200`);
  const requirement = selectRequirement(first.paymentRequired, "stellar:testnet");
  return createPaymentHeader(first.paymentRequired, requirement, keypairSigner(), harness.rpcUrl);
}

beforeAll(async () => {
  guard = installNetworkGuard();
  harness = await startX402Harness();
  transport = { baseUrl: harness.baseUrl, network: "stellar:testnet" };
});

afterAll(async () => {
  await harness?.close();
  guard?.restore();
});

describe("x402 contract: frontend client ↔ contracts trace service", () => {
  it("still exports the service API the harness uses", async () => {
    const service = await loadTraceService();
    expect(typeof service.createTraceApi, "contracts/x402 API changed: update e2e/x402/harness.ts and the frontend client").toBe("function");
    expect(typeof service.MapTraceRepository, "contracts/x402 API changed: update e2e/x402/harness.ts and the frontend client").toBe("function");
  });

  it("returns 402 with an exact stellar:testnet requirement for an unpaid request", async () => {
    const res = await fetch(`${harness.baseUrl}/traces/${TRACE_IDS.verified}`, { headers: { Accept: "application/json" } });
    expect(res.status).toBe(402);
    const header = res.headers.get("PAYMENT-REQUIRED");
    expect(header, "v2 sends the requirements in the PAYMENT-REQUIRED header").toBeTruthy();
    const paymentRequired = JSON.parse(Buffer.from(header as string, "base64").toString("utf8"));
    expect(paymentRequired.x402Version).toBe(2);
    expect(paymentRequired.accepts).toEqual([
      expect.objectContaining({ scheme: "exact", network: "stellar:testnet", amount: PRICE_ATOMIC, asset: FIXTURE_USDC, payTo: harness.payTo }),
    ]);
  });

  it("client parses the requirement into PaymentRequirementLike", async () => {
    const result = await requestRequirements(TRACE_IDS.verified, transport);
    expect(result.status).toBe("payment-required");
    if (result.status !== "payment-required") return;
    expect(selectRequirement(result.paymentRequired, "stellar:testnet")).toEqual({
      scheme: "exact",
      network: "stellar:testnet",
      amount: PRICE_ATOMIC,
      asset: FIXTURE_USDC,
      payTo: harness.payTo,
      maxTimeoutSeconds: 300,
      extra: { areFeesSponsored: true },
    });
  });

  it("client builds a payment the stub facilitator verifies", async () => {
    const before = harness.facilitator.verifications.length;
    const header = await signedPayment(TRACE_IDS.verified);
    const delivery = await deliverWithPayment(TRACE_IDS.verified, header, transport);
    const verification = harness.facilitator.verifications[before];
    expect(verification, `the service never asked the facilitator to verify; it answered ${JSON.stringify(delivery)}`).toBeDefined();
    expect(verification.problems, "the stub facilitator rejected the payment payload").toEqual([]);
  });

  it("retry with the payment header returns traceId, traceHash and content, and settles once", async () => {
    const settledBefore = harness.facilitator.settlements.length;
    const delivery = await deliverWithPayment(TRACE_IDS.verified, await signedPayment(TRACE_IDS.verified), transport);
    expect(delivery.kind).toBe("delivered");
    if (delivery.kind !== "delivered") return;
    expect(delivery.trace).toMatchObject({ traceId: TRACE_IDS.verified, traceHash: harness.fixture.traceHash });
    expect(delivery.settlement).toMatchObject({ success: true, transaction: FAKE_SETTLEMENT_TX, network: "stellar:testnet" });
    expect(harness.facilitator.settlements.length).toBe(settledBefore + 1);
  });

  it("returned content hashes to the recorded traceHash", async () => {
    const delivery = await deliverWithPayment(TRACE_IDS.verified, await signedPayment(TRACE_IDS.verified), transport);
    if (delivery.kind !== "delivered") throw new Error(`expected delivered, got ${delivery.kind}`);
    // The fixture is the contracts repo's canonical encoding, so re-canonicalizing the parsed content gives the same bytes.
    expect(canonicalize(JSON.parse(harness.fixture.text))).toBe(harness.fixture.text);
    expect(createHash("sha256").update(canonicalize(delivery.trace.content)).digest("hex")).toBe(harness.fixture.traceHash);
  });

  it("tampered gateway bytes produce 502, no content, and no settlement", async () => {
    const settledBefore = harness.facilitator.settlements.length;
    const delivery = await deliverWithPayment(TRACE_IDS.tampered, await signedPayment(TRACE_IDS.tampered), transport);
    expect(delivery).toMatchObject({ kind: "server-error", httpStatus: 502 });
    expect(delivery.kind === "server-error" && delivery.reason).toContain("failed on-chain hash verification");
    // @x402/express 2.26 settles after the handler and cancels on status >= 400: the payer is not charged.
    expect(harness.facilitator.settlements.length).toBe(settledBefore);
  });

  it("a gateway failure produces 502 without content or settlement", async () => {
    const settledBefore = harness.facilitator.settlements.length;
    const delivery = await deliverWithPayment(TRACE_IDS.gatewayDown, await signedPayment(TRACE_IDS.gatewayDown), transport);
    expect(delivery).toMatchObject({ kind: "server-error", httpStatus: 502, reason: "IPFS gateway returned HTTP 404" });
    expect(harness.facilitator.settlements.length).toBe(settledBefore);
  });

  it("an unknown trace id asks for payment first, then answers 404 without settling", async () => {
    // Pins the current middleware order: the route is priced before the handler checks the id.
    const unpaid = await requestRequirements(TRACE_IDS.unknown, transport);
    expect(unpaid.status).toBe("payment-required");
    const settledBefore = harness.facilitator.settlements.length;
    const delivery = await deliverWithPayment(TRACE_IDS.unknown, await signedPayment(TRACE_IDS.unknown), transport);
    expect(delivery).toMatchObject({ kind: "client-error", httpStatus: 404 });
    expect(harness.facilitator.settlements.length).toBe(settledBefore);
  });

  it("a facilitator verify failure results in 402, not content", async () => {
    harness.facilitator.rejectVerify = true;
    try {
      const delivery = await deliverWithPayment(TRACE_IDS.verified, await signedPayment(TRACE_IDS.verified), transport);
      expect(delivery.kind).toBe("rejected");
    } finally {
      harness.facilitator.rejectVerify = false;
    }
  });

  it("signs an expiration ledger in the future of the RPC's latest ledger", async () => {
    const before = harness.facilitator.verifications.length;
    await deliverWithPayment(TRACE_IDS.verified, await signedPayment(TRACE_IDS.verified), transport);
    expect(harness.facilitator.verifications[before].problems.filter((p) => p.includes("expired"))).toEqual([]);
    expect(FAKE_LEDGER).toBeGreaterThan(0);
  });

  it("made no request outside loopback", () => {
    const unexpected = guard.blocked.filter((host) => !KNOWN_REFUSED_PROBES.has(host));
    expect(unexpected, "a request tried to leave 127.0.0.1").toEqual([]);
  });
});
