import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { Spec } from "@stellar/stellar-sdk/contract";
import type { ResolutionSpec as BackendResolutionSpec } from "@/lib/api/markets";
import type { PriceConfig, SignerConfig } from "./generated/resolver";
import { sha256Hex } from "./trace";
import { normalizeHash } from "./trace-core";
import { formatHashHex, isZeroOrEmptyHash } from "./market-question";

export type ResolutionSpecInput =
  | BackendResolutionSpec
  | { kind: "signers"; config: SignerConfig }
  | { kind: "price"; config: PriceConfig };

export interface ResolutionVerificationResult {
  status: "verified" | "mismatch" | "unconfigured" | "no-spec";
  computedHash: string | null;
  onChainHash: string | null;
  reason?: string;
  formattedSpec: string;
}

function specUdt(name: string) {
  return xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name }));
}

/**
 * Builds the Soroban ScVal for SignerConfig struct:
 * Map of [dispute_window, signers, threshold] sorted lexicographically.
 */
export function buildSignerConfigScVal(config: {
  dispute_window: bigint | number;
  signers: readonly string[];
  threshold: number;
}, resolverSpec?: Spec): xdr.ScVal {
  if (resolverSpec && typeof (resolverSpec as { nativeToScVal?: unknown }).nativeToScVal === "function") {
    try {
      return resolverSpec.nativeToScVal(
        {
          dispute_window: BigInt(config.dispute_window),
          signers: [...config.signers],
          threshold: Number(config.threshold),
        },
        specUdt("SignerConfig"),
      );
    } catch {
      // Fallback to manual encoding below
    }
  }

  const disputeWindowVal = nativeToScVal(BigInt(config.dispute_window), { type: "u64" });
  const signersVal = xdr.ScVal.scvVec(config.signers.map((s) => new Address(s).toScVal()));
  const thresholdVal = nativeToScVal(Number(config.threshold), { type: "u32" });

  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("dispute_window"), val: disputeWindowVal }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("signers"), val: signersVal }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("threshold"), val: thresholdVal }),
  ]);
}

/**
 * Builds the Soroban ScVal for PriceConfig struct:
 * Map of [asset, direction, max_staleness, reflector, threshold] sorted lexicographically.
 */
export function buildPriceConfigScVal(config: {
  asset: { kind: "stellar"; address: string } | { kind: "other"; symbol: string } | PriceConfig["asset"];
  direction: "Above" | "AtOrAbove" | "Below" | "AtOrBelow";
  max_staleness: bigint | number;
  reflector: string;
  threshold: bigint | string | number;
}, resolverSpec?: Spec): xdr.ScVal {
  // Normalize asset ScVal
  let assetVal: xdr.ScVal;
  if ("kind" in config.asset) {
    if (config.asset.kind === "stellar") {
      assetVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Stellar"), new Address(config.asset.address).toScVal()]);
    } else {
      assetVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Other"), xdr.ScVal.scvSymbol(config.asset.symbol)]);
    }
  } else if (config.asset.tag === "Stellar") {
    assetVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Stellar"), new Address(config.asset.values[0]).toScVal()]);
  } else {
    assetVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Other"), xdr.ScVal.scvSymbol(config.asset.values[0])]);
  }

  const directionVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(config.direction)]);
  const maxStalenessVal = nativeToScVal(BigInt(config.max_staleness), { type: "u64" });
  const reflectorVal = new Address(config.reflector).toScVal();
  const thresholdVal = nativeToScVal(BigInt(config.threshold), { type: "i128" });

  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("asset"), val: assetVal }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("direction"), val: directionVal }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("max_staleness"), val: maxStalenessVal }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("reflector"), val: reflectorVal }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("threshold"), val: thresholdVal }),
  ]);
}

/**
 * Encodes the ResolutionSpec enum into an ScVal:
 * ResolutionSpec::Price(PriceConfig) -> Vec[Symbol("Price"), PriceConfig]
 * ResolutionSpec::Signers(SignerConfig) -> Vec[Symbol("Signers"), SignerConfig]
 */
export function resolutionSpecToScVal(spec: ResolutionSpecInput, resolverSpec?: Spec): xdr.ScVal {
  if (spec.kind === "signers") {
    const config = "config" in spec ? spec.config : {
      dispute_window: spec.disputeWindow,
      signers: spec.signers,
      threshold: spec.threshold,
    };
    const configScVal = buildSignerConfigScVal(config, resolverSpec);
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Signers"), configScVal]);
  }

  if (spec.kind === "price") {
    const config = "config" in spec ? {
      asset: spec.config.asset,
      direction: spec.config.direction.tag as "Above" | "AtOrAbove" | "Below" | "AtOrBelow",
      max_staleness: spec.config.max_staleness,
      reflector: spec.config.reflector,
      threshold: spec.config.threshold,
    } : {
      asset: spec.asset,
      direction: spec.direction,
      max_staleness: spec.maxStaleness,
      reflector: spec.reflector,
      threshold: spec.threshold,
    };
    const configScVal = buildPriceConfigScVal(config, resolverSpec);
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Price"), configScVal]);
  }

  throw new Error(`Unsupported resolution spec kind: ${(spec as { kind: string }).kind}`);
}

/**
 * Recomputes the ADR 0001 resolution commitment hash:
 * sha256(ResolutionSpec ScVal encoded as XDR)
 */
export async function computeResolutionHash(spec: ResolutionSpecInput, resolverSpec?: Spec): Promise<string> {
  const scVal = resolutionSpecToScVal(spec, resolverSpec);
  const xdrBytes = scVal.toXDR();
  return sha256Hex(xdrBytes);
}

/**
 * Formats a revealed resolution spec into human-readable plain words.
 * E.g., "1 of 1 signers: GCM7…XAIF, 24h dispute window"
 */
export function formatResolutionSpec(spec: ResolutionSpecInput | null | undefined): string {
  if (!spec) return "No revealed resolution spec";

  if (spec.kind === "signers") {
    const signers = "config" in spec ? spec.config.signers : spec.signers;
    const threshold = "config" in spec ? spec.config.threshold : spec.threshold;
    const disputeWindowSec = Number("config" in spec ? spec.config.dispute_window : spec.disputeWindow);

    const formattedSigners = signers
      .map((s) => (s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s))
      .join(", ");

    const windowText =
      disputeWindowSec >= 86400
        ? `${(disputeWindowSec / 86400).toFixed(0)}h`
        : disputeWindowSec >= 3600
          ? `${(disputeWindowSec / 3600).toFixed(0)}h`
          : `${disputeWindowSec}s`;

    return `${threshold} of ${signers.length} signers: ${formattedSigners}, ${windowText} dispute window`;
  }

  if (spec.kind === "price") {
    const reflector = "config" in spec ? spec.config.reflector : spec.reflector;
    const direction = "config" in spec ? spec.config.direction.tag : spec.direction;
    const staleness = "config" in spec ? spec.config.max_staleness : spec.maxStaleness;
    const threshold = "config" in spec ? spec.config.threshold.toString() : spec.threshold;

    const shortReflector = reflector.length > 12 ? `${reflector.slice(0, 4)}…${reflector.slice(-4)}` : reflector;
    return `Reflector feed ${shortReflector} price ${threshold} ${direction}, ${staleness}s max staleness`;
  }

  return "Unknown resolution spec";
}

/**
 * Verifies the revealed resolution spec against the on-chain resolution_hash commitment.
 */
export async function verifyResolutionCommitment(
  spec: ResolutionSpecInput | null | undefined,
  onChainHash: Buffer | Uint8Array | string | null | undefined,
  resolverSpec?: Spec,
): Promise<ResolutionVerificationResult> {
  const formattedSpec = formatResolutionSpec(spec);
  const normalizedOnChain = formatHashHex(onChainHash);

  if (!normalizedOnChain) {
    return {
      status: "unconfigured",
      computedHash: null,
      onChainHash: null,
      formattedSpec,
      reason: "No resolution hash committed on-chain",
    };
  }

  if (!spec) {
    return {
      status: "no-spec",
      computedHash: null,
      onChainHash: normalizedOnChain,
      formattedSpec,
      reason: "No resolution spec revealed yet",
    };
  }

  try {
    const computedHash = await computeResolutionHash(spec, resolverSpec);
    if (computedHash.toLowerCase() === normalizedOnChain.toLowerCase()) {
      return {
        status: "verified",
        computedHash,
        onChainHash: normalizedOnChain,
        formattedSpec,
      };
    }

    return {
      status: "mismatch",
      computedHash,
      onChainHash: normalizedOnChain,
      formattedSpec,
      reason: "SpecHashMismatch: Revealed resolution spec does not match on-chain commitment hash",
    };
  } catch (err) {
    return {
      status: "mismatch",
      computedHash: null,
      onChainHash: normalizedOnChain,
      formattedSpec,
      reason: err instanceof Error ? err.message : "Failed to encode resolution spec XDR",
    };
  }
}
