import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cidDigestCheck, parseCid } from "../cid";
import { MAX_IPFS_GATEWAYS, parseGateways } from "../config";

// CIDv1, raw codec, sha2-256 of the bytes "hello world" (the common `ipfs add --cid-version 1 --raw-leaves` example).
const HELLO_CID = "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e";
const HELLO_SHA256 = createHash("sha256").update("hello world").digest("hex");

describe("parseCid", () => {
  it("parses a CIDv1 raw sha2-256 CID", () => {
    const parsed = parseCid(HELLO_CID);
    expect(parsed).toMatchObject({ version: 1, codec: 0x55, hashCode: 0x12 });
    expect(Buffer.from(parsed!.digest).toString("hex")).toBe(HELLO_SHA256);
  });

  it("rejects malformed strings", () => {
    expect(parseCid("demo-trace-placeholder")).toBeNull();
    expect(parseCid("bafy1")).toBeNull();
    expect(parseCid(HELLO_CID.slice(0, -1))).toBeNull(); // a truncated payload is shorter than its length prefix
    expect(parseCid(`z${HELLO_CID.slice(1)}`)).toBeNull();
  });

  it("parses CIDv0 (dag-pb) but treats it as unsupported", () => {
    expect(parseCid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")).toMatchObject({ version: 0 });
  });
});

describe("cidDigestCheck", () => {
  it("matches the bytes the CID names", () => {
    expect(cidDigestCheck(HELLO_CID, HELLO_SHA256)).toBe("match");
  });

  it("mismatches bytes the CID doesn't name", () => {
    expect(cidDigestCheck(HELLO_CID, "00".repeat(32))).toBe("mismatch");
  });

  it("reports unverifiable CID kinds as unsupported and garbage as invalid", () => {
    expect(cidDigestCheck("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", HELLO_SHA256)).toBe("unsupported");
    expect(cidDigestCheck("demo-trace-placeholder", HELLO_SHA256)).toBe("invalid");
  });
});

describe("parseGateways", () => {
  it("keeps https gateways, trims them, and drops trailing slashes", () => {
    expect(parseGateways(" https://a.test/ipfs/ , https://b.test ")).toEqual(["https://a.test/ipfs", "https://b.test"]);
  });

  it("rejects plain http except for localhost", () => {
    expect(parseGateways("http://evil.test/ipfs,http://localhost:8080/ipfs")).toEqual(["http://localhost:8080/ipfs"]);
    expect(parseGateways("ftp://x.test,not a url")).toEqual([]);
  });

  it("de-duplicates and caps the pool", () => {
    const many = Array.from({ length: 9 }, (_, i) => `https://g${i}.test`).join(",");
    expect(parseGateways(`${many},https://g0.test`)).toHaveLength(MAX_IPFS_GATEWAYS);
    expect(parseGateways("https://a.test,https://a.test/")).toEqual(["https://a.test"]);
  });

  it("returns nothing when unset", () => {
    expect(parseGateways(undefined)).toEqual([]);
    expect(parseGateways("")).toEqual([]);
  });
});
