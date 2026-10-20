import { describe, expect, it, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import {
  clearQuestionCheckCache,
  formatHashHex,
  getCachedQuestionCheck,
  isZeroOrEmptyHash,
  setCachedQuestionCheck,
  verifyMarketQuestion,
} from "../market-question";

describe("isZeroOrEmptyHash & formatHashHex", () => {
  it("recognizes empty and all-zero hashes", () => {
    expect(isZeroOrEmptyHash(null)).toBe(true);
    expect(isZeroOrEmptyHash(undefined)).toBe(true);
    expect(isZeroOrEmptyHash("")).toBe(true);
    expect(isZeroOrEmptyHash(Buffer.alloc(0))).toBe(true);
    expect(isZeroOrEmptyHash(Buffer.alloc(32))).toBe(true);
    expect(isZeroOrEmptyHash("0000000000000000000000000000000000000000000000000000000000000000")).toBe(true);
    expect(isZeroOrEmptyHash("0x" + "0".repeat(64))).toBe(true);
  });

  it("recognizes valid non-zero hashes", () => {
    const valid = Buffer.alloc(32, 1);
    expect(isZeroOrEmptyHash(valid)).toBe(false);
    expect(formatHashHex(valid)).toBe("01".repeat(32));
    expect(formatHashHex("0xabcdef1234")).toBe("abcdef1234");
  });
});

describe("verifyMarketQuestion", () => {
  beforeEach(() => {
    clearQuestionCheckCache();
  });

  const question = "Will BTC close above $100k on 31 Dec?";
  const doc = { question, category: "Crypto" };
  const rawBytes = new TextEncoder().encode(JSON.stringify(doc));
  const validHash = createHash("sha256").update(rawBytes).digest("hex");

  const mockFetch = (text: string, status = 200) =>
    (async () => new Response(text, { status })) as typeof fetch;

  it("returns verified when document hash and question text match", async () => {
    const res = await verifyMarketQuestion({
      displayedQuestion: question,
      metaUri: "ipfs://bafyvalid",
      questionHash: validHash,
      fetchImpl: mockFetch(JSON.stringify(doc)),
    });

    expect(res.status).toBe("verified");
    expect(res.committedQuestion).toBe(question);
    expect(res.committedHash).toBe(validHash);
    expect(res.computedHash).toBe(validHash);
  });

  it("returns mismatch when displayed question text differs from committed question", async () => {
    const tamperedDoc = { question: "Will BTC close above $100k on 1 Jan?", category: "Crypto" };
    const tamperedBytes = new TextEncoder().encode(JSON.stringify(tamperedDoc));
    const tamperedHash = createHash("sha256").update(tamperedBytes).digest("hex");

    // The document hashes to tamperedHash on chain, but the UI is showing "31 Dec"
    const res = await verifyMarketQuestion({
      displayedQuestion: "Will BTC close above $100k on 31 Dec?",
      metaUri: "ipfs://bafytampered",
      questionHash: tamperedHash,
      fetchImpl: mockFetch(JSON.stringify(tamperedDoc)),
    });

    expect(res.status).toBe("mismatch");
    expect(res.reason).toMatch(/differs from canonical/i);
    expect(res.committedQuestion).toBe("Will BTC close above $100k on 1 Jan?");
  });

  it("returns mismatch when IPFS document hash does not match committed question_hash", async () => {
    const differentBytes = JSON.stringify({ question: "Different payload entirely" });

    const res = await verifyMarketQuestion({
      displayedQuestion: question,
      metaUri: "ipfs://bafywronghash",
      questionHash: validHash,
      fetchImpl: mockFetch(differentBytes),
    });

    expect(res.status).toBe("mismatch");
    expect(res.reason).toMatch(/hash does not match/i);
  });

  it("returns not-committed when question_hash is empty or all zeroes", async () => {
    const res = await verifyMarketQuestion({
      displayedQuestion: question,
      metaUri: "ipfs://bafyany",
      questionHash: Buffer.alloc(32),
    });

    expect(res.status).toBe("not-committed");
    expect(res.committedHash).toBeNull();
  });

  it("returns unavailable when meta_uri is empty or IPFS gateway fails", async () => {
    const noUri = await verifyMarketQuestion({
      displayedQuestion: question,
      metaUri: "",
      questionHash: validHash,
    });
    expect(noUri.status).toBe("unavailable");

    const failedFetch = mockFetch("", 504);
    const ipfsDown = await verifyMarketQuestion({
      displayedQuestion: question,
      metaUri: "ipfs://bafyerror",
      questionHash: validHash,
      fetchImpl: failedFetch,
    });
    expect(ipfsDown.status).toBe("unavailable");
  });

  it("stores and retrieves cached verification results", () => {
    const key = "market-1:hash123";
    expect(getCachedQuestionCheck(key)).toBeUndefined();

    const check = {
      status: "verified" as const,
      displayedQuestion: "Test",
      committedQuestion: "Test",
      committedHash: "hash123",
      computedHash: "hash123",
    };
    setCachedQuestionCheck(key, check);
    expect(getCachedQuestionCheck(key)).toEqual(check);

    clearQuestionCheckCache();
    expect(getCachedQuestionCheck(key)).toBeUndefined();
  });
});
