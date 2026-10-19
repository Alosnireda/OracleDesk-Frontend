"use client";

import React, { type ReactNode } from "react";
import { Profiler } from "react";
import { WalletProvider } from "@/lib/stellar/WalletProvider";
import type { WalletKitAdapter } from "@/lib/stellar/wallet-kit-adapter";

export const FAKE_ADDRESS = "GFAKEWALLETADDRESSFORTESTSONLYXXXXXXXXXXXXXXXX";
export const OTHER_ADDRESS = "GOTHERWALLETADDRESSFORTESTSONLYXXXXXXXXXXXXXXX";
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/**
 * A scripted stand-in for Stellar Wallets Kit. The test drives it with
 * `emitState` and `emitDisconnect`; everything else is inert.
 */
export interface FakeKit {
  adapter: WalletKitAdapter;
  /** Push a new kit state, as the kit does on internal changes. */
  emitState(payload: { address: string | null; passphrase: string | null }): void;
  /** Push a disconnect, as the kit does when the wallet locks. */
  emitDisconnect(): void;
  /** How many times the auth modal was opened. */
  modalCalls: number;
}

export function createFakeKit(options: { address?: string | null } = {}): FakeKit {
  let stateListener: ((payload: { address: string | null; passphrase: string | null }) => void) | null = null;
  let disconnectListener: (() => void) | null = null;
  let address: string | null = options.address ?? null;
  const kit: FakeKit = {
    modalCalls: 0,
    adapter: {
      authModal: async () => {
        kit.modalCalls += 1;
        return { address: address ?? FAKE_ADDRESS };
      },
      getAddress: async () => {
        if (!address) throw new Error("no address");
        return { address };
      },
      getNetwork: async () => ({ networkPassphrase: TESTNET_PASSPHRASE }),
      signTransaction: async (xdr: string) => ({ signedTxXdr: xdr }),
      disconnect: async () => {
        address = null;
      },
      onStateUpdated: (cb) => {
        stateListener = cb;
        return () => {
          stateListener = null;
        };
      },
      onDisconnect: (cb) => {
        disconnectListener = cb;
        return () => {
          disconnectListener = null;
        };
      },
      selectedModuleId: () => "fake-wallet",
    },
    emitState: (payload) => stateListener?.(payload),
    emitDisconnect: () => disconnectListener?.(),
  };
  return kit;
}

/** Renders `children` inside a WalletProvider driven by a fake kit. */
export function WalletHarness({ children, kit }: { children: ReactNode; kit: FakeKit }) {
  return <WalletProvider kitLoader={async () => kit.adapter}>{children}</WalletProvider>;
}

/**
 * Counts the commits of a subtree. React only runs the Profiler's callback
 * when the profiled subtree actually rendered, so the count is the number of
 * renders of that subtree.
 */
export function CommitCounter({
  id,
  onCommit,
  children,
}: {
  id: string;
  onCommit: () => void;
  children: ReactNode;
}) {
  return (
    <Profiler id={id} onRender={onCommit}>
      {children}
    </Profiler>
  );
}
