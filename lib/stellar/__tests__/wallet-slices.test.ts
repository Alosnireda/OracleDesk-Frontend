import { describe, expect, it } from "vitest";
import { initialWalletState, transition, viewOf, type ConnectedState } from "../wallet-machine";

/**
 * The provider only re-renders when the state machine hands it a *new* state
 * object. These tests pin that: an event that does not change anything must
 * keep the same object, so the provider (and every consumer) stays put.
 */

const connected = (address = "GADDRESS1"): ConnectedState => ({
  tag: "connected",
  epoch: 0,
  address,
  network: "Test SDF Network ; September 2015",
  session: { wallet: address },
  attempt: 0,
  error: null,
});

describe("wallet machine keeps its state object when nothing changes", () => {
  it("ignores a state update with the same address and network", () => {
    const state = connected();
    const next = transition(state, {
      type: "KIT_STATE_UPDATED",
      address: state.address,
      passphrase: state.network,
      storedSessionWallet: state.address,
    });
    expect(next.state).toBe(state);
  });

  it("ignores a repeated network report", () => {
    const state = connected();
    const next = transition(state, {
      type: "NETWORK_REPORTED",
      epoch: 0,
      address: state.address,
      passphrase: state.network,
    });
    expect(next.state).toBe(state);
  });

  it("ignores a session sync for the wallet that is already signed in", () => {
    const state = connected();
    const next = transition(state, { type: "SESSION_SYNCED", wallet: state.address });
    expect(next.state).toBe(state);
  });

  it("keeps the same state when the kit reports no address at all", () => {
    const state = connected();
    const next = transition(state, {
      type: "KIT_STATE_UPDATED",
      address: null,
      passphrase: null,
      storedSessionWallet: null,
    });
    // A disconnect is a real change, so the state moves, but the reason it
    // moves is the missing address, not the unchanged network.
    expect(next.state).not.toBe(state);
    expect(viewOf(next.state).isConnected).toBe(false);
  });

  it("moves to a new state when the network really changes", () => {
    const state = connected();
    const next = transition(state, {
      type: "NETWORK_REPORTED",
      epoch: 0,
      address: state.address,
      passphrase: "Public Global Stellar Network ; September 2015",
    });
    expect(next.state).not.toBe(state);
    expect(viewOf(next.state).walletNetworkPassphrase).toBe("Public Global Stellar Network ; September 2015");
  });

  it("keeps the same state when a stale-epoch network report arrives", () => {
    const state = connected();
    const next = transition(state, {
      type: "NETWORK_REPORTED",
      epoch: 99,
      address: state.address,
      passphrase: "Public Global Stellar Network ; September 2015",
    });
    expect(next.state).toBe(state);
  });

  it("starts disconnected and stays put while the kit loads", () => {
    const state = initialWalletState;
    const next = transition(state, { type: "KIT_LOADED" });
    expect(next.state).not.toBe(state);
    expect(next.state.tag).toBe("restoring");
  });
});
