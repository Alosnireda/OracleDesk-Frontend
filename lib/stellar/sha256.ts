/**
 * Incremental SHA-256 (FIPS 180-4, section 6.2) for hashing bodies that arrive
 * in chunks. WebCrypto's digest() needs the whole input at once, so streamed
 * trace content goes through this instead. Output must match WebCrypto and
 * Node's createHash for every input; lib/stellar/__tests__/sha256.test.ts
 * checks that.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const BLOCK_BYTES = 64;

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export class Sha256 {
  private readonly state = Uint32Array.from(INITIAL_STATE);
  private readonly block = new Uint8Array(BLOCK_BYTES);
  private readonly schedule = new Uint32Array(64);
  private blockLength = 0;
  // Bit length is tracked as bigint so inputs past 512 MB still pad correctly.
  private totalBytes = 0n;
  private finalised = false;

  /** Feeds more bytes. Full 64-byte blocks are compressed immediately; the tail is buffered. */
  update(chunk: Uint8Array): this {
    if (this.finalised) throw new Error("Sha256: update() after digest()");
    this.totalBytes += BigInt(chunk.byteLength);
    let offset = 0;
    if (this.blockLength > 0) {
      const take = Math.min(BLOCK_BYTES - this.blockLength, chunk.byteLength);
      this.block.set(chunk.subarray(0, take), this.blockLength);
      this.blockLength += take;
      offset = take;
      if (this.blockLength < BLOCK_BYTES) return this;
      this.compress(this.block, 0);
      this.blockLength = 0;
    }
    while (chunk.byteLength - offset >= BLOCK_BYTES) {
      this.compress(chunk, offset);
      offset += BLOCK_BYTES;
    }
    if (offset < chunk.byteLength) {
      this.block.set(chunk.subarray(offset), 0);
      this.blockLength = chunk.byteLength - offset;
    }
    return this;
  }

  /** Pads (0x80, zeros, 64-bit big-endian bit length) and returns the 32-byte digest. Single use. */
  digest(): Uint8Array {
    if (this.finalised) throw new Error("Sha256: digest() called twice");
    this.finalised = true;
    const padded = new Uint8Array(2 * BLOCK_BYTES);
    padded.set(this.block.subarray(0, this.blockLength));
    padded[this.blockLength] = 0x80;
    const paddedLength = this.blockLength < 56 ? BLOCK_BYTES : 2 * BLOCK_BYTES;
    const bitLength = this.totalBytes * 8n;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Number((bitLength >> 32n) & 0xffffffffn));
    view.setUint32(paddedLength - 4, Number(bitLength & 0xffffffffn));
    for (let offset = 0; offset < paddedLength; offset += BLOCK_BYTES) this.compress(padded, offset);

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) outView.setUint32(i * 4, this.state[i]);
    return out;
  }

  private compress(data: Uint8Array, offset: number): void {
    const w = this.schedule;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = (data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }

    const h = this.state;
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i] + w[i]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }
}

/** Lowercase hex of a SHA-256 over every chunk, in order. */
export function sha256HexOf(chunks: Iterable<Uint8Array>): string {
  const hasher = new Sha256();
  for (const chunk of chunks) hasher.update(chunk);
  return Array.from(hasher.digest(), (b) => b.toString(16).padStart(2, "0")).join("");
}
