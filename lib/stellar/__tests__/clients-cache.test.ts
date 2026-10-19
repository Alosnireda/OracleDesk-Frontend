import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeToScVal, SorobanDataBuilder, type rpc } from "@stellar/stellar-sdk";
import { __resetClientCaches, __specBuildCount, marketCore, options, type Signer } from "../clients";
import { CONTRACTS } from "../config";
import { read } from "../typed-call";

function makeSigner(publicKey: string) {
  const calls: string[] = [];
  const signer: Signer = {
    publicKey,
    signTransaction: vi.fn(async () => {
      calls.push(publicKey);
      return { signedTxXdr: publicKey, signerAddress: publicKey };
    }) as Signer["signTransaction"],
  };
  return { signer, calls };
}

function simulation(n: number): rpc.Api.SimulateTransactionResponse {
  return {
    _parsed: true,
    id: String(n),
    latestLedger: 100 + n,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: "0",
    result: { auth: [], retval: nativeToScVal(BigInt(n), { type: "u64" }) },
    events: [],
  } as unknown as rpc.Api.SimulateTransactionResponse;
}

describe("contract client cache", () => {
  beforeEach(() => __resetClientCaches());

  it("returns one read-only client per contract/rpc/passphrase key", () => {
    expect(marketCore()).toBe(marketCore());
    const a = marketCore(undefined, undefined, "https://rpc-a.example");
    const b = marketCore(undefined, undefined, "https://rpc-b.example");
    expect(a).not.toBe(b);
    expect(a).toBe(marketCore(undefined, undefined, "https://rpc-a.example"));
    // A timeout is part of the client options, so it must key a new instance.
    expect(marketCore(undefined, { timeoutInSeconds: 60 })).not.toBe(marketCore());
  });

  it("builds the spec once, then shares it with signer-bound clients", () => {
    expect(__specBuildCount()).toBe(0);
    const readOnly = marketCore();
    expect(__specBuildCount()).toBe(1);
    const { signer } = makeSigner("GCM7WU3RADBCIKBLGPPAEYV5WHASWMEQX6BU524QR3QFWSE7BIWCXAIF");
    const bound = marketCore(signer);
    expect(__specBuildCount()).toBe(1);
    expect(bound.spec).toBe(readOnly.spec);
    expect(bound.spec).toBe(marketCore(signer).spec);
  });

  it("never puts a signer on a cached read-only client", () => {
    expect(marketCore().options.publicKey).toBeUndefined();
    expect(marketCore().options.signTransaction).toBeUndefined();
  });

  it("keeps account-bound clients separate and preserves the signer identity", async () => {
    const a = makeSigner("GCM7WU3RADBCIKBLGPPAEYV5WHASWMEQX6BU524QR3QFWSE7BIWCXAIF");
    const b = makeSigner("GD2NB2VUME7ECMHFHQN5M3KUZLLJF3R6Z4OFCBLE4SJNHIQHITRPQGHQ");
    const clientA = marketCore(a.signer);
    const clientB = marketCore(b.signer);

    expect(clientA).not.toBe(clientB);
    expect(clientA).toBe(marketCore(a.signer));
    expect(clientA.options.publicKey).toBe(a.signer.publicKey);
    expect(clientB.options.publicKey).toBe(b.signer.publicKey);
    expect(clientA.options.signTransaction).toBe(a.signer.signTransaction);
    expect(clientB.options.signTransaction).toBe(b.signer.signTransaction);

    const signA = clientA.options.signTransaction as unknown as (
      xdr: string,
      opts: { networkPassphrase: string },
    ) => Promise<unknown>;
    const signB = clientB.options.signTransaction as unknown as (
      xdr: string,
      opts: { networkPassphrase: string },
    ) => Promise<unknown>;
    await signA("xdr-a", { networkPassphrase: "Test SDF Network ; September 2015" });
    expect(a.calls).toEqual([a.signer.publicKey]);
    await signB("xdr-b", { networkPassphrase: "Test SDF Network ; September 2015" });
    expect(b.calls).toEqual([b.signer.publicKey]);
    // Creating B did not mutate A.
    expect(marketCore(a.signer).options.publicKey).toBe(a.signer.publicKey);
  });

  it("does not carry per-call simulation state between overlapping reads", async () => {
    const client = marketCore();
    const server = client.options.server as rpc.Server;
    let call = 0;
    vi.spyOn(server, "simulateTransaction").mockImplementation(async () => {
      const n = ++call;
      // Resolve out of order: later calls finish first for some n.
      await new Promise((resolve) => setTimeout(resolve, ((n * 7) % 13)));
      return simulation(n);
    });

    const transactions = await Promise.all(Array.from({ length: 50 }, () => marketCore().market_count()));
    const values = transactions.map((tx) => read(tx));

    expect(values).toHaveLength(50);
    expect([...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(
      Array.from({ length: 50 }, (_, index) => BigInt(index + 1)),
    );
    // Reading the same transaction twice must not see another call's result.
    expect(read(transactions[10])).toBe(values[10]);
  });

  it("builds clients with the shared RPC server", () => {
    const client = marketCore();
    expect(client.options.server).toBeInstanceOf(Object);
    expect((client.options.server as rpc.Server).serverURL.toString().replace(/\/$/, "")).toBe(
      options(CONTRACTS.marketCore).rpcUrl,
    );
  });
});
