import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  Address,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  buildAuthorizationEntryPreimage,
  hash,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

/**
 * A facilitator double for @x402/core 2.26's HTTPFacilitatorClient, which
 * calls (confirmed in the pinned dist/esm source):
 *   GET  {url}/supported → { kinds: [{ x402Version, scheme, network, extra? }], extensions: [], signers: {} }
 *   POST {url}/verify    ← { x402Version, paymentPayload, paymentRequirements } → { isValid, invalidReason?, invalidMessage?, payer? }
 *   POST {url}/settle    ← same body → { success, transaction, network, payer?, errorReason? }
 * Responses are validated with zod there, so the shapes must match exactly.
 *
 * /verify really checks the payment: one SEP-41 `transfer(from, to, amount)`
 * on the expected asset to the expected payee for the expected amount, with
 * the payer's Soroban auth entry signed by the payer's ed25519 key. Nothing
 * is submitted; /settle returns a deterministic fake transaction hash.
 */

export interface ExpectedPayment {
  network: "stellar:testnet";
  asset: string;
  payTo: string;
  amount: string;
}

export interface VerifyRecord {
  payer: string | null;
  /** Human-readable reasons the payment is invalid; empty when it verifies. */
  problems: string[];
}

export interface StubFacilitator {
  url: string;
  verifications: VerifyRecord[];
  settlements: { payer: string | null; transaction: string }[];
  /** Makes /verify answer isValid: false regardless of the payment. */
  rejectVerify: boolean;
  close(): Promise<void>;
}

const PASSPHRASE = Networks.TESTNET;
export const FAKE_SETTLEMENT_TX = "f".repeat(64);

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** Checks a PaymentPayload against what the test expects. */
export function checkPayment(paymentPayload: unknown, expected: ExpectedPayment, currentLedger: number): VerifyRecord {
  const problems: string[] = [];
  const payload = paymentPayload as { x402Version?: number; accepted?: { network?: string }; payload?: { transaction?: unknown } };
  if (payload?.x402Version !== 2) problems.push(`x402Version is ${payload?.x402Version}, expected 2`);
  if (payload?.accepted?.network !== expected.network) problems.push(`network is ${payload?.accepted?.network}, expected ${expected.network}`);
  if (typeof payload?.payload?.transaction !== "string") return { payer: null, problems: [...problems, "payload.transaction is missing"] };

  const tx = TransactionBuilder.fromXDR(payload.payload.transaction, PASSPHRASE);
  if ("innerTransaction" in tx || tx.operations.length !== 1 || tx.operations[0].type !== "invokeHostFunction") {
    return { payer: null, problems: [...problems, "expected one InvokeHostFunction operation"] };
  }
  const op = tx.operations[0] as Operation.InvokeHostFunction;
  const call = op.func.invokeContract();
  const contract = Address.fromScAddress(call.contractAddress()).toString();
  const fn = call.functionName().toString();
  const [fromVal, toVal, amountVal] = call.args();
  const payer = fromVal ? Address.fromScVal(fromVal).toString() : null;
  if (contract !== expected.asset) problems.push(`asset is ${contract}, expected ${expected.asset}`);
  if (fn !== "transfer") problems.push(`function is ${fn}, expected transfer`);
  if (!toVal || Address.fromScVal(toVal).toString() !== expected.payTo) problems.push(`payTo is ${toVal ? Address.fromScVal(toVal).toString() : "missing"}, expected ${expected.payTo}`);
  const amount = amountVal ? String(scValToNative(amountVal)) : "missing";
  if (amount !== expected.amount) problems.push(`amount is ${amount}, expected ${expected.amount}`);

  const entry = (op.auth ?? []).find((auth) => {
    const credentials = auth.credentials();
    return credentials.switch() === xdr.SorobanCredentialsType.sorobanCredentialsAddress() && Address.fromScAddress(credentials.address().address()).toString() === payer;
  });
  if (!entry || !payer) return { payer, problems: [...problems, "no address auth entry for the payer"] };

  const credentials = entry.credentials().address();
  const expiration = credentials.signatureExpirationLedger();
  if (expiration <= currentLedger) problems.push(`signature expired at ledger ${expiration} (current ${currentLedger})`);
  const signatures = scValToNative(credentials.signature()) as { public_key?: Buffer; signature?: Buffer }[] | null;
  const sig = Array.isArray(signatures) ? signatures[0] : undefined;
  if (!sig?.public_key || !sig.signature) {
    problems.push("the payer's auth entry is not signed");
  } else {
    const signer = Keypair.fromPublicKey(StrKey.encodeEd25519PublicKey(Buffer.from(sig.public_key)));
    const digest = hash(buildAuthorizationEntryPreimage(entry, expiration, PASSPHRASE).toXDR());
    if (signer.publicKey() !== payer) problems.push(`auth entry signed by ${signer.publicKey()}, expected ${payer}`);
    if (!signer.verify(digest, Buffer.from(sig.signature))) problems.push("the auth entry signature doesn't verify");
  }
  return { payer, problems };
}

export async function startStubFacilitator(expected: ExpectedPayment, currentLedger: () => number): Promise<StubFacilitator> {
  const stub: Omit<StubFacilitator, "url" | "close"> = { verifications: [], settlements: [], rejectVerify: false };
  const server: Server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "GET" && req.url === "/supported") {
        send(200, {
          kinds: [{ x402Version: 2, scheme: "exact", network: expected.network, extra: { areFeesSponsored: true } }],
          extensions: [],
          signers: {},
        });
        return;
      }
      const body = (await readJson(req)) as { paymentPayload?: unknown } | null;
      if (req.method === "POST" && req.url === "/verify") {
        const record = checkPayment(body?.paymentPayload, expected, currentLedger());
        stub.verifications.push(record);
        if (stub.rejectVerify) {
          send(200, { isValid: false, invalidReason: "stub_rejected", invalidMessage: "The stub facilitator was told to reject", payer: record.payer });
        } else if (record.problems.length) {
          send(200, { isValid: false, invalidReason: "invalid_exact_stellar_payload", invalidMessage: record.problems.join("; "), payer: record.payer });
        } else {
          send(200, { isValid: true, payer: record.payer });
        }
        return;
      }
      if (req.method === "POST" && req.url === "/settle") {
        const record = checkPayment(body?.paymentPayload, expected, currentLedger());
        stub.settlements.push({ payer: record.payer, transaction: FAKE_SETTLEMENT_TX });
        send(200, { success: true, transaction: FAKE_SETTLEMENT_TX, network: expected.network, payer: record.payer });
        return;
      }
      send(404, { error: "unknown facilitator route" });
    } catch (error) {
      send(500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(stub, {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  });
}
