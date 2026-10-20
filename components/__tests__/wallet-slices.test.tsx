import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import React, { useEffect } from "react";

/**
 * The wallet context is split into slices, so a component only re-renders
 * when the part of the wallet it reads actually changes.
 *
 * Each probe reports the slice it reads from an effect (never during render)
 * and is wrapped in a Profiler, so the commit count is the number of renders
 * of that probe.
 */

const signInWithWallet = vi.fn(async (address: string) => ({ walletAddress: address }));

vi.mock("@/lib/api/auth", () => ({
  getStoredSessionWallet: () => null,
  clearAuthSession: () => {},
  signInWithWallet: (address: string) => signInWithWallet(address),
}));

vi.mock("@/lib/api/cross-tab-sync", () => ({
  createCrossTabSync: () => ({ unsubscribe: () => {} }),
  broadcastWalletDisconnect: () => {},
}));

vi.mock("@/lib/notifications/push", () => ({
  storedPushWallet: () => null,
  unsubscribe: async () => {},
}));

// The provider reads the router; there is no app router in a unit test.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

const { createFakeKit, WalletHarness, CommitCounter, FAKE_ADDRESS, OTHER_ADDRESS, TESTNET_PASSPHRASE } =
  await import("./wallet-harness");
const { useWalletActions, useWalletAddress, useWalletNetwork, useWalletSession, useWalletSigner } = await import(
  "@/lib/contexts/WalletContext"
);

type Identity = ReturnType<typeof useWalletAddress>;
type Network = ReturnType<typeof useWalletNetwork>;
type Session = ReturnType<typeof useWalletSession>;
type Signer = ReturnType<typeof useWalletSigner>;
type Actions = ReturnType<typeof useWalletActions>;

interface Handlers {
  onIdentity: (value: Identity) => void;
  onNetwork: (value: Network) => void;
  onSession: (value: Session) => void;
  onSigner: (value: Signer) => void;
  onActions: (value: Actions) => void;
  countIdentity: () => void;
  countNetwork: () => void;
  countSession: () => void;
  countSigner: () => void;
  countActions: () => void;
}

function IdentityProbe({ onChange }: { onChange: (value: Identity) => void }) {
  const value = useWalletAddress();
  useEffect(() => {
    onChange(value);
  }, [value, onChange]);
  return null;
}

function NetworkProbe({ onChange }: { onChange: (value: Network) => void }) {
  const value = useWalletNetwork();
  useEffect(() => {
    onChange(value);
  }, [value, onChange]);
  return null;
}

function SessionProbe({ onChange }: { onChange: (value: Session) => void }) {
  const value = useWalletSession();
  useEffect(() => {
    onChange(value);
  }, [value, onChange]);
  return null;
}

function SignerProbe({ onChange }: { onChange: (value: Signer) => void }) {
  const value = useWalletSigner();
  useEffect(() => {
    onChange(value);
  }, [value, onChange]);
  return null;
}

function ActionsProbe({ onChange }: { onChange: (value: Actions) => void }) {
  const value = useWalletActions();
  useEffect(() => {
    onChange(value);
  }, [value, onChange]);
  return null;
}

function Probes({ handlers }: { handlers: Handlers }) {
  return (
    <>
      <CommitCounter id="identity" onCommit={handlers.countIdentity}>
        <IdentityProbe onChange={handlers.onIdentity} />
      </CommitCounter>
      <CommitCounter id="network" onCommit={handlers.countNetwork}>
        <NetworkProbe onChange={handlers.onNetwork} />
      </CommitCounter>
      <CommitCounter id="session" onCommit={handlers.countSession}>
        <SessionProbe onChange={handlers.onSession} />
      </CommitCounter>
      <CommitCounter id="signer" onCommit={handlers.countSigner}>
        <SignerProbe onChange={handlers.onSigner} />
      </CommitCounter>
      <CommitCounter id="actions" onCommit={handlers.countActions}>
        <ActionsProbe onChange={handlers.onActions} />
      </CommitCounter>
    </>
  );
}

interface Snapshot {
  identity: Identity | null;
  network: Network | null;
  session: Session | null;
  signer: Signer | null;
  actions: Actions | null;
  commits: { identity: number; network: number; session: number; signer: number; actions: number };
}

/** The sink and the handlers that write to it, both built in the test scope. */
function makeSink() {
  const snapshot: Snapshot = {
    identity: null,
    network: null,
    session: null,
    signer: null,
    actions: null,
    commits: { identity: 0, network: 0, session: 0, signer: 0, actions: 0 },
  };
  const handlers: Handlers = {
    onIdentity: (value) => {
      snapshot.identity = value;
    },
    onNetwork: (value) => {
      snapshot.network = value;
    },
    onSession: (value) => {
      snapshot.session = value;
    },
    onSigner: (value) => {
      snapshot.signer = value;
    },
    onActions: (value) => {
      snapshot.actions = value;
    },
    countIdentity: () => {
      snapshot.commits.identity += 1;
    },
    countNetwork: () => {
      snapshot.commits.network += 1;
    },
    countSession: () => {
      snapshot.commits.session += 1;
    },
    countSigner: () => {
      snapshot.commits.signer += 1;
    },
    countActions: () => {
      snapshot.commits.actions += 1;
    },
  };
  return { snapshot, handlers };
}

beforeEach(() => {
  signInWithWallet.mockClear();
});

describe("wallet context slices", () => {
  it("keeps the action identities stable when the account changes", async () => {
    const kit = createFakeKit({ address: FAKE_ADDRESS });
    const { snapshot, handlers } = makeSink();
    render(
      <WalletHarness kit={kit}>
        <Probes handlers={handlers} />
      </WalletHarness>,
    );

    await waitFor(() => expect(snapshot.identity?.address).toBe(FAKE_ADDRESS));
    const actionsBefore = snapshot.actions;

    await act(async () => {
      kit.emitState({ address: OTHER_ADDRESS, passphrase: TESTNET_PASSPHRASE });
    });
    await waitFor(() => expect(snapshot.identity?.address).toBe(OTHER_ADDRESS));

    expect(snapshot.actions).toBe(actionsBefore);
    expect(snapshot.actions?.openModal).toBe(actionsBefore?.openModal);
    expect(snapshot.actions?.ensureSession).toBe(actionsBefore?.ensureSession);
    expect(snapshot.actions?.disconnect).toBe(actionsBefore?.disconnect);
  });

  it("changes the signer when the account changes", async () => {
    const kit = createFakeKit({ address: FAKE_ADDRESS });
    const { snapshot, handlers } = makeSink();
    render(
      <WalletHarness kit={kit}>
        <Probes handlers={handlers} />
      </WalletHarness>,
    );

    await waitFor(() => expect(snapshot.identity?.address).toBe(FAKE_ADDRESS));
    const signerBefore = snapshot.signer;
    expect(signerBefore?.publicKey).toBe(FAKE_ADDRESS);

    await act(async () => {
      kit.emitState({ address: OTHER_ADDRESS, passphrase: TESTNET_PASSPHRASE });
    });
    await waitFor(() => expect(snapshot.identity?.address).toBe(OTHER_ADDRESS));

    expect(snapshot.signer).not.toBe(signerBefore);
    expect(snapshot.signer?.publicKey).toBe(OTHER_ADDRESS);
  });

  it("does not re-render a component that only reads the identity slice when the network changes", async () => {
    const kit = createFakeKit({ address: FAKE_ADDRESS });
    const { snapshot, handlers } = makeSink();
    render(
      <WalletHarness kit={kit}>
        <Probes handlers={handlers} />
      </WalletHarness>,
    );

    await waitFor(() => expect(snapshot.identity?.address).toBe(FAKE_ADDRESS));
    const identityBefore = snapshot.identity;
    const identityCommits = snapshot.commits.identity;
    const networkCommits = snapshot.commits.network;

    await act(async () => {
      kit.emitState({ address: FAKE_ADDRESS, passphrase: "Public Global Stellar Network ; September 2015" });
    });
    await waitFor(() => expect(snapshot.network?.isWrongNetwork).toBe(true));

    expect(snapshot.identity).toBe(identityBefore);
    expect(snapshot.commits.identity).toBe(identityCommits);
    expect(snapshot.commits.network).toBeGreaterThan(networkCommits);
  });

  it("does not re-render anything when the kit repeats the same state", async () => {
    const kit = createFakeKit({ address: FAKE_ADDRESS });
    const { snapshot, handlers } = makeSink();
    render(
      <WalletHarness kit={kit}>
        <Probes handlers={handlers} />
      </WalletHarness>,
    );

    await waitFor(() => expect(snapshot.identity?.address).toBe(FAKE_ADDRESS));
    // The first report teaches the machine the network.
    await act(async () => {
      kit.emitState({ address: FAKE_ADDRESS, passphrase: TESTNET_PASSPHRASE });
    });
    await waitFor(() => expect(snapshot.network?.walletNetworkPassphrase).toBe(TESTNET_PASSPHRASE));

    const before = { ...snapshot.commits };
    const identityBefore = snapshot.identity;

    await act(async () => {
      kit.emitState({ address: FAKE_ADDRESS, passphrase: TESTNET_PASSPHRASE });
    });

    expect(snapshot.commits.identity).toBe(before.identity);
    expect(snapshot.commits.network).toBe(before.network);
    expect(snapshot.commits.session).toBe(before.session);
    expect(snapshot.commits.signer).toBe(before.signer);
    expect(snapshot.commits.actions).toBe(before.actions);
    expect(snapshot.identity).toBe(identityBefore);
  });

  it("signs in with the address that is current when ensureSession runs", async () => {
    const kit = createFakeKit({ address: FAKE_ADDRESS });
    const { snapshot, handlers } = makeSink();
    render(
      <WalletHarness kit={kit}>
        <Probes handlers={handlers} />
      </WalletHarness>,
    );

    await waitFor(() => expect(snapshot.identity?.address).toBe(FAKE_ADDRESS));
    await act(async () => {
      kit.emitState({ address: OTHER_ADDRESS, passphrase: TESTNET_PASSPHRASE });
    });
    await waitFor(() => expect(snapshot.identity?.address).toBe(OTHER_ADDRESS));

    await act(async () => {
      await snapshot.actions?.ensureSession();
    });

    // The sign-in used the address that was current at call time, not the one
    // that was current when the action was created.
    expect(signInWithWallet).toHaveBeenCalledTimes(1);
    expect(signInWithWallet.mock.calls[0][0]).toBe(OTHER_ADDRESS);
  });

  it("refuses to sign in when no wallet is connected", async () => {
    const kit = createFakeKit();
    const { snapshot, handlers } = makeSink();
    render(
      <WalletHarness kit={kit}>
        <Probes handlers={handlers} />
      </WalletHarness>,
    );

    await waitFor(() => expect(snapshot.commits.actions).toBeGreaterThan(0));
    let result: boolean | undefined;
    await act(async () => {
      result = await snapshot.actions?.ensureSession();
    });

    expect(result).toBe(false);
    expect(signInWithWallet).not.toHaveBeenCalled();
  });
});
