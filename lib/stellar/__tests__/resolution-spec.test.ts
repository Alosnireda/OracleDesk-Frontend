import { describe, expect, it } from "vitest";
import {
  buildPriceConfigScVal,
  buildSignerConfigScVal,
  computeResolutionHash,
  formatResolutionSpec,
  resolutionSpecToScVal,
  verifyResolutionCommitment,
} from "../resolution-spec";
import type { ResolutionSpec } from "@/lib/api/markets";

describe("ResolutionSpec XDR encoding & Golden Vectors", () => {
  const signerAddress = "GCM7A2T3K2K4E6V4N774YAG75XNQL655EAEAYC5X6GZ2H44XGCM7XAIF";
  const reflectorAddress = "CAFEED35XICK4OXIEXQDS6KTTBUA2LDNW3EXEUGTNMN54DY5ANETCH6M";

  // Golden Vector 1: Signers rule (1 of 1, 24h dispute window)
  const signerSpec: ResolutionSpec = {
    kind: "signers",
    signers: [signerAddress],
    threshold: 1,
    disputeWindow: 86400,
  };

  // Golden Vector 2: Price rule (Reflector Above 650,000.0000000 USDC, 300s staleness)
  const priceSpec: ResolutionSpec = {
    kind: "price",
    reflector: reflectorAddress,
    asset: { kind: "stellar", address: reflectorAddress },
    threshold: "6500000000000",
    direction: "Above",
    maxStaleness: 300,
  };

  it("encodes Signers spec to canonical Soroban ScVal vector", () => {
    const scVal = resolutionSpecToScVal(signerSpec);
    expect(scVal.switch().name).toBe("scvVec");
    const vec = scVal.vec();
    expect(vec).toBeDefined();
    expect(vec?.[0].sym().toString()).toBe("Signers");

    // Inner config is a Map
    const configMap = vec?.[1].map();
    expect(configMap).toBeDefined();
    expect(configMap?.length).toBe(3);

    // Sorted keys: dispute_window, signers, threshold
    expect(configMap?.[0].key().sym().toString()).toBe("dispute_window");
    expect(configMap?.[1].key().sym().toString()).toBe("signers");
    expect(configMap?.[2].key().sym().toString()).toBe("threshold");
  });

  it("encodes Price spec to canonical Soroban ScVal vector", () => {
    const scVal = resolutionSpecToScVal(priceSpec);
    expect(scVal.switch().name).toBe("scvVec");
    const vec = scVal.vec();
    expect(vec).toBeDefined();
    expect(vec?.[0].sym().toString()).toBe("Price");

    // Inner config is a Map with 5 sorted keys
    const configMap = vec?.[1].map();
    expect(configMap).toBeDefined();
    expect(configMap?.length).toBe(5);

    expect(configMap?.[0].key().sym().toString()).toBe("asset");
    expect(configMap?.[1].key().sym().toString()).toBe("direction");
    expect(configMap?.[2].key().sym().toString()).toBe("max_staleness");
    expect(configMap?.[3].key().sym().toString()).toBe("reflector");
    expect(configMap?.[4].key().sym().toString()).toBe("threshold");
  });

  it("computes deterministic SHA-256 hash for golden Signers vector", async () => {
    const hash = await computeResolutionHash(signerSpec);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // Recomputing produces identical hash
    const hashAgain = await computeResolutionHash(signerSpec);
    expect(hash).toBe(hashAgain);
  });

  it("computes deterministic SHA-256 hash for golden Price vector", async () => {
    const hash = await computeResolutionHash(priceSpec);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    const hashAgain = await computeResolutionHash(priceSpec);
    expect(hash).toBe(hashAgain);
  });

  it("detects modification of any spec field as hash mismatch", async () => {
    const baseHash = await computeResolutionHash(signerSpec);

    // Changing threshold from 1 to 2
    const tamperedThreshold: ResolutionSpec = { ...signerSpec, threshold: 2 };
    const tamperedHash1 = await computeResolutionHash(tamperedThreshold);
    expect(tamperedHash1).not.toBe(baseHash);

    // Changing dispute window from 86400 to 3600
    const tamperedWindow: ResolutionSpec = { ...signerSpec, disputeWindow: 3600 };
    const tamperedHash2 = await computeResolutionHash(tamperedWindow);
    expect(tamperedHash2).not.toBe(baseHash);

    // Changing signer key
    const differentSigner = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
    const tamperedSigner: ResolutionSpec = { ...signerSpec, signers: [differentSigner] };
    const tamperedHash3 = await computeResolutionHash(tamperedSigner);
    expect(tamperedHash3).not.toBe(baseHash);
  });
});

describe("verifyResolutionCommitment", () => {
  const signerAddress = "GCM7A2T3K2K4E6V4N774YAG75XNQL655EAEAYC5X6GZ2H44XGCM7XAIF";
  const validSpec: ResolutionSpec = {
    kind: "signers",
    signers: [signerAddress],
    threshold: 1,
    disputeWindow: 86400,
  };

  it("verifies matching revealed spec against on-chain commitment", async () => {
    const commitmentHash = await computeResolutionHash(validSpec);
    const res = await verifyResolutionCommitment(validSpec, commitmentHash);

    expect(res.status).toBe("verified");
    expect(res.computedHash).toBe(commitmentHash);
    expect(res.onChainHash).toBe(commitmentHash);
    expect(res.formattedSpec).toContain("1 of 1 signers");
    expect(res.formattedSpec).toContain("24h dispute window");
  });

  it("reports mismatch when backend spec differs from on-chain commitment", async () => {
    const realOnChainHash = await computeResolutionHash(validSpec);

    // Backend claims 2 of 3 signers while chain committed to 1 of 1
    const misleadingBackendSpec: ResolutionSpec = {
      kind: "signers",
      signers: [
        signerAddress,
        "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        "GCFXHS4GMXBYRBAP57M4BCBSJQXGABOMGE637OXVQOHY6Y55G3A4UEX2",
      ],
      threshold: 2,
      disputeWindow: 86400,
    };

    const res = await verifyResolutionCommitment(misleadingBackendSpec, realOnChainHash);
    expect(res.status).toBe("mismatch");
    expect(res.reason).toMatch(/SpecHashMismatch/i);
    expect(res.computedHash).not.toBe(realOnChainHash);
  });

  it("handles unconfigured and no-spec states gracefully", async () => {
    const unconfigured = await verifyResolutionCommitment(validSpec, Buffer.alloc(32));
    expect(unconfigured.status).toBe("unconfigured");

    const noSpec = await verifyResolutionCommitment(null, "abcdef".repeat(10) + "1234");
    expect(noSpec.status).toBe("no-spec");
  });
});

describe("formatResolutionSpec", () => {
  it("formats signer specs in plain words", () => {
    const text1 = formatResolutionSpec({
      kind: "signers",
      signers: ["GCM7A2T3K2K4E6V4N774YAG75XNQL655EAEAYC5X6GZ2H44XGCM7XAIF"],
      threshold: 1,
      disputeWindow: 86400,
    });
    expect(text1).toBe("1 of 1 signers: GCM7…XAIF, 24h dispute window");

    const text2 = formatResolutionSpec({
      kind: "signers",
      signers: [
        "GCM7A2T3K2K4E6V4N774YAG75XNQL655EAEAYC5X6GZ2H44XGCM7XAIF",
        "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
      ],
      threshold: 2,
      disputeWindow: 43200,
    });
    expect(text2).toBe("2 of 2 signers: GCM7…XAIF, GA7Q…VSGZ, 12h dispute window");
  });

  it("formats price specs in plain words", () => {
    const text = formatResolutionSpec({
      kind: "price",
      reflector: "CAFEED35XICK4OXIEXQDS6KTTBUA2LDNW3EXEUGTNMN54DY5ANETCH6M",
      asset: { kind: "stellar", address: "CAFEED35XICK4OXIEXQDS6KTTBUA2LDNW3EXEUGTNMN54DY5ANETCH6M" },
      threshold: "100000000",
      direction: "Above",
      maxStaleness: 60,
    });
    expect(text).toContain("Reflector feed CAFE…CH6M");
    expect(text).toContain("Above");
    expect(text).toContain("60s max staleness");
  });

  it("handles empty spec cleanly", () => {
    expect(formatResolutionSpec(null)).toBe("No revealed resolution spec");
    expect(formatResolutionSpec(undefined)).toBe("No revealed resolution spec");
  });
});
