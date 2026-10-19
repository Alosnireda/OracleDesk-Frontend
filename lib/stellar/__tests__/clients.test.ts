import { describe, expect, it } from "vitest";
import { options, withPinnedRpc } from "../clients";
import { RPC_URL } from "../config";

describe("clients options", () => {
  it("uses the provided rpcUrl", () => {
    expect(options("CABC", undefined, undefined, "https://rpc.example").rpcUrl).toBe("https://rpc.example");
  });

  it("sets allowHttp per url", () => {
    expect(options("CABC", undefined, undefined, "http://localhost:8000").allowHttp).toBe(true);
    expect(options("CABC", undefined, undefined, "https://rpc.example").allowHttp).toBe(false);
  });

  it("falls back to RPC_URL without a browser pool", async () => {
    expect(options("CABC").rpcUrl).toBe(RPC_URL);
    await expect(withPinnedRpc(async (url) => url)).resolves.toBe(RPC_URL);
  });
});
