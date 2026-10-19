import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../trace";
import { Sha256, sha256HexOf } from "../sha256";

const hexOf = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const reference = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("Sha256", () => {
  it("matches the FIPS 180-4 vectors", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sha256HexOf([new Uint8Array()])).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256HexOf([enc("abc")])).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256HexOf([enc("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")])).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("matches the one-million-'a' long message vector", () => {
    expect(sha256HexOf([new Uint8Array(1_000_000).fill(0x61)])).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  it("gives the same digest for any chunking, including block boundaries", () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1_000, 10_000]) {
      const data = new Uint8Array(randomBytes(length));
      for (const size of [1, 7, 63, 64, 65, 4096]) {
        const chunks: Uint8Array[] = [];
        for (let i = 0; i < data.length; i += size) chunks.push(data.subarray(i, i + size));
        expect(sha256HexOf(chunks)).toBe(reference(data));
      }
    }
  });

  it("agrees with WebCrypto on the same input", async () => {
    const data = new TextEncoder().encode('{"action":"buy","confidence":0.72}');
    expect(hexOf(new Sha256().update(data).digest())).toBe(await sha256Hex(data));
  });

  it("refuses reuse after digest()", () => {
    const hasher = new Sha256();
    hasher.digest();
    expect(() => hasher.update(new Uint8Array(1))).toThrow();
    expect(() => hasher.digest()).toThrow();
  });
});
