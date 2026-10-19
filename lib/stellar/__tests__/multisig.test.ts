import { describe, expect, it } from "vitest";
import {
  Account,
  Address,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { marketCore } from "../clients";
import { CONTRACTS, NETWORK_PASSPHRASE } from "../config";
import {
  isMultisigAccount,
  mergeSigned,
  readAccountAuth,
  requiredThreshold,
  signatureWeight,
  stripUnknownSignatures,
} from "../multisig";

const master = Keypair.random();
const signerA = Keypair.random();
const signerB = Keypair.random();
const outsider = Keypair.random();

function accountEntryXdr(masterKp: Keypair, extra: { kp: Keypair; weight: number }[], thresholds: [number, number, number, number], seq = 5n): string {
  const signers = extra.map(
    ({ kp, weight }) =>
      new xdr.Signer({
        key: xdr.SignerKey.signerKeyTypeEd25519(kp.rawPublicKey()),
        weight,
      }),
  );
  const entry = new xdr.AccountEntry({
    accountId: masterKp.xdrPublicKey(),
    balance: xdr.Int64.fromString("100000000"),
    seqNum: xdr.Int64.fromString(seq.toString()),
    numSubEntries: 2,
    inflationDest: null,
    flags: 0,
    homeDomain: "",
    thresholds: Buffer.from(thresholds),
    signers,
    ext: new xdr.AccountEntryExt(0),
  });
  return entry.toXDR("base64");
}

function fakeServerFor(entryXdr: string) {
  const entry = xdr.AccountEntry.fromXDR(entryXdr, "base64");
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getLedgerEntries: async (..._keys: xdr.LedgerKey[]) => ({
      entries: [{ val: { account: () => entry } }],
      latestLedger: 100,
    }),
  } as unknown as import("@stellar/stellar-sdk").rpc.Server;
}

function buildBuyTx(source: string, seq = "10"): import("@stellar/stellar-sdk").Transaction {
  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(CONTRACTS.marketCore).toScAddress(),
      functionName: "buy",
      args: marketCore().spec.funcArgsToScVals("buy", {
        trader: source,
        market_id: 1n,
        outcome: { tag: "Yes", values: undefined },
        collateral_in: 10_000_000n,
        min_shares_out: 9_000_000n,
      }),
    }),
  );
  return new TransactionBuilder(new Account(source, seq), {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.invokeHostFunction({ func, auth: [] }))
    .setTimeout(3600)
    .build();
}

describe("readAccountAuth", () => {
  it("reads thresholds, signers and sequence from AccountEntry XDR", async () => {
    const entryXdr = accountEntryXdr(master, [{ kp: signerA, weight: 1 }, { kp: signerB, weight: 1 }], [1, 1, 2, 3], 42n);
    const auth = await readAccountAuth(master.publicKey(), fakeServerFor(entryXdr));
    expect(auth.masterWeight).toBe(1);
    expect(auth.low).toBe(1);
    expect(auth.med).toBe(2);
    expect(auth.high).toBe(3);
    expect(auth.sequence).toBe(42n);
    // Master + 2 extra signers.
    expect(auth.signers).toHaveLength(3);
    expect(auth.signers[0]).toMatchObject({ key: master.publicKey(), weight: 1, type: "ed25519" });
    const keys = auth.signers.map((s) => s.key);
    expect(keys).toContain(signerA.publicKey());
    expect(keys).toContain(signerB.publicKey());
  });

  it("detects multisig accounts", async () => {
    const singleXdr = accountEntryXdr(master, [], [1, 1, 1, 1], 1n);
    const single = await readAccountAuth(master.publicKey(), fakeServerFor(singleXdr));
    expect(isMultisigAccount(single)).toBe(false);
    const multiXdr = accountEntryXdr(master, [{ kp: signerA, weight: 1 }], [1, 1, 2, 2], 1n);
    const multi = await readAccountAuth(master.publicKey(), fakeServerFor(multiXdr));
    expect(isMultisigAccount(multi)).toBe(true);
  });
});

describe("requiredThreshold", () => {
  it("returns the medium threshold for invokeHostFunction source auth", async () => {
    const entryXdr = accountEntryXdr(master, [{ kp: signerA, weight: 1 }], [2, 1, 2, 3], 1n);
    const auth = await readAccountAuth(master.publicKey(), fakeServerFor(entryXdr));
    const tx = buildBuyTx(master.publicKey());
    // Medium threshold governs both the invokeHostFunction source and
    // Soroban address-credential auth on a classic account.
    expect(requiredThreshold(tx, auth)).toBe(auth.med);
    expect(requiredThreshold(tx, auth)).toBe(2);
  });
});

describe("signatureWeight", () => {
  it("counts each valid ed25519 signature once and reports unknown", async () => {
    const entryXdr = accountEntryXdr(master, [{ kp: signerA, weight: 1 }, { kp: signerB, weight: 1 }], [1, 1, 2, 3], 1n);
    const auth = await readAccountAuth(master.publicKey(), fakeServerFor(entryXdr));
    const tx = buildBuyTx(master.publicKey());
    // No signatures yet.
    expect(signatureWeight(tx, auth, NETWORK_PASSPHRASE)).toMatchObject({ weight: 0, unknown: 0 });

    tx.sign(master);
    let res = signatureWeight(tx, auth, NETWORK_PASSPHRASE);
    expect(res.weight).toBe(1);
    expect(res.signedBy).toEqual([master.publicKey()]);

    // Duplicate signatures never double-count.
    tx.sign(master);
    res = signatureWeight(tx, auth, NETWORK_PASSPHRASE);
    expect(res.weight).toBe(1);
    expect(res.signedBy).toHaveLength(1);

    tx.sign(signerA);
    res = signatureWeight(tx, auth, NETWORK_PASSPHRASE);
    expect(res.weight).toBe(2);
    expect(new Set(res.signedBy).size).toBe(2);

    // An outsider signature is invalid for this account and reported as unknown.
    const before = res.weight;
    tx.sign(outsider);
    res = signatureWeight(tx, auth, NETWORK_PASSPHRASE);
    expect(res.weight).toBe(before);
    expect(res.unknown).toBeGreaterThanOrEqual(1);
  });

  it("ignores invalid signatures and can strip them", async () => {
    const entryXdr = accountEntryXdr(master, [{ kp: signerA, weight: 1 }], [1, 1, 2, 2], 1n);
    const auth = await readAccountAuth(master.publicKey(), fakeServerFor(entryXdr));
    const tx = buildBuyTx(master.publicKey());
    tx.sign(master);
    tx.sign(outsider);
    const weighed = signatureWeight(tx, auth, NETWORK_PASSPHRASE);
    expect(weighed.weight).toBe(1);
    expect(weighed.unknown).toBe(1);
    stripUnknownSignatures(tx, auth, NETWORK_PASSPHRASE);
    const after = signatureWeight(tx, auth, NETWORK_PASSPHRASE);
    expect(after.unknown).toBe(0);
    expect(after.weight).toBe(1);
  });

  it("reaches threshold only when summed weights meet med", async () => {
    const entryXdr = accountEntryXdr(master, [{ kp: signerA, weight: 1 }, { kp: signerB, weight: 1 }], [1, 1, 2, 3], 1n);
    const auth = await readAccountAuth(master.publicKey(), fakeServerFor(entryXdr));
    const tx = buildBuyTx(master.publicKey());
    tx.sign(master);
    expect(signatureWeight(tx, auth, NETWORK_PASSPHRASE).weight).toBeLessThan(requiredThreshold(tx, auth));
    tx.sign(signerA);
    expect(signatureWeight(tx, auth, NETWORK_PASSPHRASE).weight).toBeGreaterThanOrEqual(requiredThreshold(tx, auth));
  });
});

describe("mergeSigned", () => {
  it("merges signatures from two imports", async () => {
    const entryXdr = accountEntryXdr(master, [{ kp: signerA, weight: 1 }], [1, 1, 2, 2], 1n);
    const auth = await readAccountAuth(master.publicKey(), fakeServerFor(entryXdr));
    void auth;
    const built = buildBuyTx(master.publicKey());

    const first = TransactionBuilder.cloneFrom(built, { fee: built.fee, networkPassphrase: NETWORK_PASSPHRASE });
    const firstTx = first.build();
    firstTx.sign(master);
    const firstXdr = firstTx.toEnvelope().toXDR("base64");

    const second = TransactionBuilder.cloneFrom(built, { fee: built.fee, networkPassphrase: NETWORK_PASSPHRASE });
    const secondTx = second.build();
    secondTx.sign(signerA);
    const secondXdr = secondTx.toEnvelope().toXDR("base64");

    mergeSigned(built, firstXdr, NETWORK_PASSPHRASE);
    mergeSigned(built, secondXdr, NETWORK_PASSPHRASE);
    const weighed = signatureWeight(built, await readAccountAuth(master.publicKey(), fakeServerFor(entryXdr)), NETWORK_PASSPHRASE);
    expect(weighed.weight).toBe(2);
    expect(built.signatures).toHaveLength(2);
  });

  it("rejects imported XDR with a different hash", () => {
    const built = buildBuyTx(master.publicKey());
    const other = buildBuyTx(signerA.publicKey());
    other.sign(signerA);
    const otherXdr = other.toEnvelope().toXDR("base64");
    expect(() => mergeSigned(built, otherXdr, NETWORK_PASSPHRASE)).toThrow(/does not match/i);
  });

  it("rejects fee-bump envelopes", () => {
    const built = buildBuyTx(master.publicKey());
    const inner = buildBuyTx(master.publicKey());
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(master, "200", inner, NETWORK_PASSPHRASE);
    const feeBumpXdr = feeBump.toEnvelope().toXDR("base64");
    expect(() => mergeSigned(built, feeBumpXdr, NETWORK_PASSPHRASE)).toThrow(/fee-bump/i);
  });

  it("rejects changed auth entries", () => {
    const built = buildBuyTx(master.publicKey());
    const func = xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(CONTRACTS.marketCore).toScAddress(),
        functionName: "buy",
        args: marketCore().spec.funcArgsToScVals("buy", {
          trader: master.publicKey(),
          market_id: 1n,
          outcome: { tag: "Yes", values: undefined },
          collateral_in: 10_000_000n,
          min_shares_out: 9_000_000n,
        }),
      }),
    );
    // A different root invocation (different min_shares_out) must be rejected.
    const tamperedArgs = marketCore().spec.funcArgsToScVals("buy", {
      trader: master.publicKey(),
      market_id: 1n,
      outcome: { tag: "Yes", values: undefined },
      collateral_in: 10_000_000n,
      min_shares_out: 1n,
    });
    const tamperedFunc = xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(CONTRACTS.marketCore).toScAddress(),
        functionName: "buy",
        args: tamperedArgs,
      }),
    );
    void func;
    const tampered = new TransactionBuilder(new Account(master.publicKey(), "10"), {
      fee: built.fee,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.invokeHostFunction({ func: tamperedFunc, auth: [] }))
      .setTimeout(3600)
      .build();
    tampered.sign(master);
    const tamperedXdr = tampered.toEnvelope().toXDR("base64");
    expect(() => mergeSigned(built, tamperedXdr, NETWORK_PASSPHRASE)).toThrow(/does not match/i);
  });
});

describe("non-source auth entries", () => {
  it("is empty for trader-as-source buy (market-core spec, simulate:false path)", () => {
    // Built exactly like the multisig prepare path: trader is the source,
    // single invokeHostFunction, no extra auth entries.
    const source = master.publicKey();
    const func = xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(CONTRACTS.marketCore).toScAddress(),
        functionName: "buy",
        args: marketCore().spec.funcArgsToScVals("buy", {
          trader: source,
          market_id: 7n,
          outcome: { tag: "No", values: undefined },
          collateral_in: 5_000_000n,
          min_shares_out: 4_000_000n,
        }),
      }),
    );
    const built = new TransactionBuilder(new Account(source, "20"), {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.invokeHostFunction({ func, auth: [] }))
      .setTimeout(3600)
      .build();
    const envelopeXdr = built.toEnvelope().toXDR("base64");
    const assembled = AssembledTransaction.fromXDR(
      {
        contractId: CONTRACTS.marketCore,
        networkPassphrase: NETWORK_PASSPHRASE,
        rpcUrl: "https://soroban-testnet.stellar.org",
      },
      envelopeXdr,
      marketCore().spec,
    );
    // Document the expected empty case: trader/holder/from is the source,
    // so no other address must sign auth entries.
    expect(assembled.needsNonInvokerSigningBy()).toEqual([]);
    void StrKey;
  });
});
