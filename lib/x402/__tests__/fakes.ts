import { Account, Address, Keypair, Networks, Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { IDBFactory } from "fake-indexeddb";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { createJournal, type AuthSignature, type SettlementChain } from "../recovery";
import type { UnlockDeps, VerifiedContent } from "../client";

/** Test doubles for the x402 flows. Wire format comes from the pinned @x402/core encoders. */

export const PAYER = Keypair.random().publicKey();
export const PAY_TO = Keypair.random().publicKey();
export const OTHER_PAY_TO = Keypair.random().publicKey();
/** Circle testnet USDC SAC, the asset @x402/stellar prices "0.01" in. */
export const ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const TRACE_HASH = "a".repeat(64);
export const BASE_URL = "http://x402.test";

export function requirementFor(amount: string, payTo = PAY_TO): PaymentRequirements {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    asset: ASSET,
    amount,
    payTo,
    maxTimeoutSeconds: 300,
    extra: { areFeesSponsored: true },
  };
}

/** A real PAYMENT-SIGNATURE value: a transaction carrying the payer's address auth entry. */
export function signedHeader(requirement: PaymentRequirements, nonce: bigint, expirationLedger: number, payer = PAYER): string {
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(payer).toScAddress(),
        nonce: xdr.Int64.fromString(nonce.toString()),
        signatureExpirationLedger: expirationLedger,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: Address.fromString(ASSET).toScAddress(), functionName: "transfer", args: [] }),
      ),
      subInvocations: [],
    }),
  });
  const tx = new TransactionBuilder(new Account(Keypair.random().publicKey(), "0"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeContractFunction({ contract: ASSET, function: "transfer", args: [], auth: [entry] }))
    .setTimeout(0)
    .build();
  return encodePaymentSignatureHeader({
    x402Version: 2,
    resource: { url: `${BASE_URL}/traces/1` },
    accepted: requirement,
    payload: { transaction: tx.toXDR() },
  });
}

export type PaidBehaviour = "ok" | "502" | "reject" | "network" | "tampered";

export interface FakeService {
  fetch: typeof fetch;
  /** Every request: trace id and the payment header it carried (null when unpaid). */
  requests: { onChainTraceId: string; paymentHeader: string | null }[];
  setPrice(onChainTraceId: string, amount: string, payTo?: string): void;
  setFree(onChainTraceId: string, free: boolean): void;
  /** Queue of outcomes for paid requests; "ok" when empty. */
  paid: PaidBehaviour[];
  onPaidRequest?: (onChainTraceId: string, header: string) => void | Promise<void>;
}

export function fakeService(): FakeService {
  const prices = new Map<string, { amount: string; payTo: string }>();
  const free = new Set<string>();
  const service: FakeService = {
    requests: [],
    paid: [],
    setPrice: (id, amount, payTo = PAY_TO) => void prices.set(id, { amount, payTo }),
    setFree: (id, value) => void (value ? free.add(id) : free.delete(id)),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const onChainTraceId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const header = new Headers(init?.headers).get("PAYMENT-SIGNATURE");
      service.requests.push({ onChainTraceId, paymentHeader: header });
      const body = { traceId: onChainTraceId, traceHash: TRACE_HASH, content: { reasoning: "ok" } };
      const json = (status: number, payload: unknown, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", ...headers } });
      const price = prices.get(onChainTraceId) ?? { amount: "100000", payTo: PAY_TO };
      const paymentRequired = (error?: string): PaymentRequired => ({
        x402Version: 2,
        error,
        resource: { url: url.toString() },
        accepts: [requirementFor(price.amount, price.payTo)],
      });

      if (!header) {
        if (free.has(onChainTraceId)) return json(200, body);
        return json(402, {}, { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired()) });
      }
      await service.onPaidRequest?.(onChainTraceId, header);
      const behaviour = service.paid.shift() ?? "ok";
      switch (behaviour) {
        case "network":
          throw new TypeError("fetch failed");
        case "502":
          return json(502, { error: "IPFS gateway returned HTTP 504" });
        case "reject":
          return json(402, {}, { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired("invalid_exact_stellar_payload_nonce_used")) });
        case "tampered":
          return json(200, { ...body, traceHash: "b".repeat(64) });
        case "ok":
          return json(200, body, {
            "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: `tx-${onChainTraceId}`, network: "stellar:testnet" }),
          });
      }
    }) as typeof fetch,
  };
  return service;
}

export interface FakeChain extends SettlementChain {
  ledger: number;
  transfersList: { txHash: string; amount: bigint }[];
  txs: Map<string, { status: "SUCCESS" | "FAILED" | "NOT_FOUND"; signatures: AuthSignature[] }>;
}

export function fakeChain(ledger = 1_000): FakeChain {
  const chain: FakeChain = {
    ledger,
    transfersList: [],
    txs: new Map(),
    latestLedger: async () => chain.ledger,
    transfers: async () => ({ transfers: chain.transfersList, complete: true }),
    transaction: async (hash) => chain.txs.get(hash) ?? { status: "NOT_FOUND", signatures: [] },
  };
  return chain;
}

export const verified = async (): Promise<VerifiedContent> => ({
  onChainHash: TRACE_HASH,
  check: { status: "verified", content: { reasoning: "ok" }, computedHash: TRACE_HASH },
});

/** Unlock deps over the fakes; `sign` produces real headers with increasing nonces. */
export function fakeDeps(overrides: Partial<UnlockDeps> & { service?: FakeService; chain?: FakeChain } = {}) {
  const service = overrides.service ?? fakeService();
  const chain = overrides.chain ?? fakeChain();
  let nonce = 1n;
  const signs: PaymentRequirements[] = [];
  const sleeps: number[] = [];
  const deps: UnlockDeps = {
    journal: createJournal(new IDBFactory()),
    chain,
    verify: verified,
    sign: async (_paymentRequired, requirement) => {
      signs.push(requirement);
      return signedHeader(requirement, nonce++, chain.ledger + 60);
    },
    transport: { baseUrl: BASE_URL, network: "stellar:testnet", fetchImpl: service.fetch },
    sleep: async (ms) => void sleeps.push(ms),
    ...overrides,
  };
  return { deps, service, chain, signs, sleeps };
}
