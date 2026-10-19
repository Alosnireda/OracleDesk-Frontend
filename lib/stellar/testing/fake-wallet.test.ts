import { describe, expect, it } from "vitest";
import { declinedSigner, fakeWallet } from "./fake-wallet";

describe("fakeWallet", () => {
  it("defaults to a disconnected wallet with no signer", () => {
    const wallet = fakeWallet();
    expect(wallet.isConnected).toBe(false);
    expect(wallet.signer).toBeNull();
  });

  it("marks the wrong network preset as connected but on the wrong network", () => {
    const wallet = fakeWallet("wrongNetwork");
    expect(wallet.isConnected).toBe(true);
    expect(wallet.isWrongNetwork).toBe(true);
  });

  it("applies overrides on top of a preset", () => {
    expect(fakeWallet("connected", { isAuthenticated: false }).isAuthenticated).toBe(false);
  });

  it("uses a signer that rejects as user declined", async () => {
    await expect(declinedSigner.signTransaction("AAAA")).rejects.toEqual({ code: -4, message: "User declined" });
  });
});
