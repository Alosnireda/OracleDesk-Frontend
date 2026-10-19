import { Errors as MarketCoreErrors } from "./generated/market-core";
import { Errors as TreasuryErrors } from "./generated/treasury";
import { Errors as ResolverErrors } from "./generated/resolver";
import { Errors as ReasoningRegistryErrors } from "./generated/reasoning-registry";

export type ContractName = "marketCore" | "treasury" | "resolver" | "reasoningRegistry";

const TABLES: Record<ContractName, Record<number, { message: string }>> = {
  marketCore: MarketCoreErrors,
  treasury: TreasuryErrors,
  resolver: ResolverErrors,
  reasoningRegistry: ReasoningRegistryErrors,
};

/**
 * Per-contract overrides for error names whose meaning differs by contract
 * (e.g. "MarketNotOpen" means "not open for trading" in market-core but
 * "no open exposure" in treasury; "NotInitialized" means something different
 * in each contract). Checked before the shared FRIENDLY map.
 */
const CONTRACT_FRIENDLY: Partial<Record<ContractName, Record<string, string>>> = {
  treasury: {
    NotInitialized: "The treasury isn't set up yet.",
    InvalidConfig: "The treasury's risk settings are invalid.",
    MarketNotOpen: "The treasury has no open exposure in this market.",
  },
  resolver: {
    NotSigner: "Your wallet isn't one of this market's signers.",
    AlreadyAttested: "You've already attested this outcome for this market.",
    ThresholdNotReached: "Not enough signers have attested this outcome yet.",
    DisputeActive: "A dispute is active for this market's resolution.",
    NoProposal: "There's no resolution proposal for this market yet.",
    AlreadyFinalized: "This market has already been finalized.",
    MarketNotClosed: "This market hasn't closed yet.",
    WrongMode: "This action doesn't match this market's resolution mode.",
    StalePrice: "The price feed is too stale to resolve this market.",
    PriceUnavailable: "No price is available to resolve this market yet.",
  },
};

/** Plain-language messages for contract error names, from the user's point of view. */
export const FRIENDLY: Record<string, string> = {
  // market-core
  Paused: "Trading is paused right now. Try again later.",
  InvalidAmount: "Enter an amount greater than zero.",
  MarketNotFound: "This market doesn't exist on-chain.",
  MarketNotOpen: "This market is no longer open for trading.",
  MarketClosed: "This market has closed. Trading has stopped.",
  NotClosedYet: "This market hasn't closed yet.",
  NotFinal: "This market hasn't been resolved yet.",
  SlippageExceeded: "The price moved before your trade went through. Try again or allow more slippage.",
  InsufficientShares: "You don't have enough shares for this sale.",
  InsufficientLiquidity: "There isn't enough liquidity in this market for that amount.",
  MarketTooLarge: "This trade would take the market past its size limit.",
  NothingToRedeem: "You have nothing to redeem in this market.",
  AlreadyClaimed: "This has already been claimed.",
  Overflow: "That amount is too large.",
  // treasury
  TradeCapExceeded: "This trade is above the treasury's per-trade limit.",
  MarketCapExceeded: "The treasury has reached its limit for this market.",
  DailyCapExceeded: "The treasury has reached its daily limit.",
  InsufficientBalance: "You don't have enough USDC for this.",
  // resolver
  MarketNotConfigured: "This market's resolution rule hasn't been revealed yet.",
  SpecHashMismatch: "That resolution rule doesn't match what this market committed to.",
  DisputeWindowOpen: "The dispute window is still open.",
  // reasoning-registry
  TraceNotFound: "This reasoning trace isn't on-chain.",
  AgentAlreadyRegistered: "This agent is already registered.",
  AgentNotRegistered: "This agent isn't registered.",
  EmptyAction: "The trace action can't be empty.",
  EmptyCid: "The trace needs an IPFS CID.",
  Unauthorized: "Your wallet isn't allowed to do this.",
  // shared across contracts
  NotInitialized: "This contract hasn't been initialized yet.",
  InvalidFee: "Fees can be at most 10% (1000 bps).",
};

import type { rpc } from "@stellar/stellar-sdk";

export interface DescribedError {
  kind:
    | "stale-sequence"
    | "low-reserve"
    | "rejected"
    | "insufficient-balance"
    | "insufficient-xlm"
    | "account-not-found"
    | "no-trustline"
    | "contract"
    | "wrong-network"
    | "disconnected"
    | "network"
    | "submission"
    | "expired"
    | "bad-auth"
    | "unknown";
  message: string;
  action?: "enable-usdc";
  /** Contract error name, e.g. "SlippageExceeded", or tx result code when known. */
  code?: string;
}

export interface TxDescribedError extends DescribedError {
  submission?: "try-again-later" | "duplicate" | "rejected-by-network" | "failed-on-chain" | "not-found-after-timeout";
  resultCode?: string; // e.g. "txBadSeq", "txInsufficientFee", "txFailed"
}

function textOf(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return `${err.message} ${(err as Error & { cause?: unknown }).cause ?? ""}`;
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    // Stellar Wallets Kit errors are { code, message }; SDK Err is { error: { message } }.
    return [o.message, (o.error as { message?: string } | undefined)?.message, safeJson(err)].filter(Boolean).join(" ");
  }
  return String(err);
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

/** Turns anything thrown by the SDK, a binding or a wallet into a message for the user. */
export function describeError(err: unknown, contract: ContractName = "marketCore"): DescribedError {
  const text = textOf(err);

  if (classifySequenceError(err)) {
    return {
      kind: "stale-sequence",
      code: "txBadSeq",
      message: "Another transaction from this account changed the sequence. Prepare it again with a fresh quote.",
    };
  }
  // Multisig: threshold not met at submission. Check the longer `_extra`
  // variant first so it isn't swallowed by the `_auth` branch.
  if (/tx_bad_auth_extra|txBadAuthExtra/i.test(text)) {
    return {
      kind: "bad-auth",
      code: "tx_bad_auth_extra",
      message: "This transaction has extra signatures the network doesn't expect. Remove unknown signatures and try again.",
    };
  }
  if (/tx_bad_auth|txBadAuth/i.test(text)) {
    return {
      kind: "bad-auth",
      code: "tx_bad_auth",
      message: "This account needs more signatures to meet its threshold. Collect the remaining signatures before submitting.",
    };
  }
  if (/tx_too_late|txTooLate/i.test(text)) {
    return {
      kind: "expired",
      code: "tx_too_late",
      message: "This transaction expired before it was submitted. Prepare it again with a fresh quote.",
    };
  }
  if (/archived|restore|expired.*footprint|footprint.*expired/i.test(text)) {
    return {
      kind: "expired",
      code: "archived-entry",
      message: "The transaction simulation is stale (archived entries or changed footprint). Prepare it again with a fresh quote.",
    };
  }
  if (/user (rejected|declined|denied)|rejected by (the )?user|request (was )?rejected|declined|cancell?ed by user|user closed/i.test(text)) {
    return { kind: "rejected", message: "You cancelled the request in your wallet." };
  }
  // The kit throws this after a reload when the phone's WalletConnect session has ended.
  if (/No WalletConnect session found/i.test(text)) {
    return { kind: "disconnected", message: "Your mobile wallet session ended. Connect your mobile wallet again." };
  }
  // The SDK throws this when the source account has no ledger entry (never funded).
  if (/Account not found|op_no_source_account|tx_no_source_account|txNoAccount/i.test(text)) {
    return { kind: "account-not-found", message: "Your Stellar account isn't activated yet. Fund it with XLM first." };
  }
  if (/trustline entry is missing|TrustlineMissing|trustline.*(missing|not found)|op_no_trust/i.test(text)) {
    return {
      kind: "no-trustline",
      message: "Your account has no USDC trustline. Add the USDC asset in your wallet first.",
      action: "enable-usdc",
    };
  }
  if (/op_low_reserve|opLowReserve|txInsufficientBalance|tx_insufficient_balance/i.test(text)) {
    return { kind: "insufficient-xlm", message: "Your account needs more spendable XLM to add the USDC trustline." };
  }
  if (/balance is not sufficient|resulting balance is not within the allowed range|insufficient (balance|funds)|BalanceError|op_underfunded/i.test(text)) {
    return { kind: "insufficient-balance", message: "You don't have enough USDC for this." };
  }
  if (/op_low_reserve|txInsufficientBalance|tx_insufficient_balance/i.test(text)) {
    return { kind: "insufficient-xlm", message: "You don't have enough spendable XLM to pay the network fee." };
  }
  if (/wrong network|network mismatch/i.test(text)) {
    return { kind: "wrong-network", message: "Switch your wallet to Stellar Testnet and try again." };
  }
  // Admin-gated contract calls (e.g. market-core's require_admin) fail auth
  // for any non-admin signer; name this distinctly from a wallet rejection.
  if (/Error\(Auth, InvalidAction\)|HostError: Error\(Auth/i.test(text)) {
    return {
      kind: "contract",
      code: "NotAdmin",
      message: "Only the contract admin can do this. Your wallet isn't the admin.",
    };
  }

  const code = /Error\(Contract, #(\d+)\)/.exec(text);
  if (code) {
    const name = TABLES[contract][Number(code[1])]?.message;
    if (name) {
      const message = CONTRACT_FRIENDLY[contract]?.[name] ?? FRIENDLY[name] ?? `The contract rejected this (${name}).`;
      return { kind: "contract", code: name, message };
    }
    return { kind: "contract", message: `The contract rejected this (error ${code[1]}).` };
  }
  // A binding Err may carry just the name.
  const named = Object.keys(FRIENDLY).find((n) => new RegExp(`\\b${n}\\b`).test(text));
  if (named) return { kind: "contract", code: named, message: FRIENDLY[named] };

  if (/\b429\b|too many requests|rate.?limit/i.test(text)) {
    return { kind: "network", code: "rate-limited", message: "The Stellar network is busy right now. Try again in a moment." };
  }
  if (/Failed to fetch|NetworkError|ECONNREFUSED|timed? ?out|ETIMEDOUT/i.test(text)) {
    return { kind: "network", message: "Couldn't reach the Stellar network. Check your connection and try again." };
  }
  return { kind: "unknown", message: "Something went wrong. Please try again." };
}

/**
 * Maps an rpc.Api.SendTransactionResponse to a TxDescribedError.
 */
export function describeSubmission(
  response: rpc.Api.SendTransactionResponse,
  contract: ContractName = "marketCore",
): TxDescribedError {
  if (response.status === "TRY_AGAIN_LATER") {
    return {
      kind: "submission",
      submission: "try-again-later",
      message: "The network is busy. Please try again in a moment.",
    };
  }
  if (response.status === "DUPLICATE") {
    return {
      kind: "submission",
      submission: "duplicate",
      message: "This transaction is already in flight.",
    };
  }

  // ERROR case
  let resultCode: string | undefined;
  try {
    resultCode = response.errorResult?.result().switch().name;
  } catch {
    // ignore
  }

  if (resultCode === "txBadSeq") {
    return {
      kind: "stale-sequence",
      code: "txBadSeq",
      submission: "rejected-by-network",
      resultCode,
      message: "Another transaction from this account changed the sequence. Prepare it again with a fresh quote.",
    };
  }
  if (resultCode === "txBadAuth") {
    return {
      kind: "bad-auth",
      code: "tx_bad_auth",
      submission: "rejected-by-network",
      resultCode,
      message: "This account needs more signatures to meet its threshold. Collect the remaining signatures before submitting.",
    };
  }
  if (resultCode === "txBadAuthExtra") {
    return {
      kind: "bad-auth",
      code: "tx_bad_auth_extra",
      submission: "rejected-by-network",
      resultCode,
      message: "This transaction has extra signatures the network doesn't expect. Remove unknown signatures and try again.",
    };
  }
  if (resultCode === "txInsufficientFee") {
    return {
      kind: "submission",
      submission: "rejected-by-network",
      resultCode,
      message: "The network fee bid was too low. Please try again with a higher fee.",
    };
  }
  if (resultCode === "txTooLate") {
    return {
      kind: "expired",
      code: "tx_too_late",
      submission: "rejected-by-network",
      resultCode,
      message: "This transaction expired before it was submitted. Prepare it again with a fresh quote.",
    };
  }
  if (resultCode === "txInsufficientBalance") {
    return {
      kind: "insufficient-xlm",
      submission: "rejected-by-network",
      resultCode,
      message: "You don't have enough spendable XLM to pay the network fee.",
    };
  }

  // For txFailed on an InvokeHostFunction, fall through to describeError with the contract name
  // so Error(Contract, #N) still maps via TABLES.
  const diagText = response.diagnosticEvents
    ? response.diagnosticEvents
        .map((e) => {
          try {
            return typeof (e as unknown as { toXDR?: (f: string) => string }).toXDR === "function"
              ? (e as unknown as { toXDR: (format: string) => string }).toXDR("base64")
              : String(e);
          } catch {
            return String(e);
          }
        })
        .join(" ")
    : "";
  const fullText = `${textOf(response)} ${diagText}`;
  const described = describeError(fullText, contract);
  if (described.kind !== "unknown") {
    return {
      ...described,
      submission: "rejected-by-network",
      resultCode: resultCode ?? "txFailed",
    };
  }

  return {
    kind: "submission",
    submission: "rejected-by-network",
    resultCode: resultCode ?? "txFailed",
    message: resultCode
      ? `Transaction was rejected by the network (${resultCode}).`
      : "Transaction was rejected by the network. Please try again.",
  };
}

/** Thrown by write hooks so callers get a readable message in `error.message`. */
export class UserFacingError extends Error {
  constructor(public readonly described: DescribedError, public readonly original?: unknown) {
    super(described.message);
    this.name = "UserFacingError";
  }
}

export function classifySequenceError(error: unknown): boolean {
  if (/tx_bad_seq|txBadSeq|bad sequence/i.test(textOf(error))) return true;
  if (!error || typeof error !== "object") return false;
  const response = error as { errorResult?: { result(): { switch(): { name: string } } }; sendTransactionResponse?: unknown };
  if (response.sendTransactionResponse) return classifySequenceError(response.sendTransactionResponse);
  try { return response.errorResult?.result().switch().name === "txBadSeq"; } catch { return false; }
}
