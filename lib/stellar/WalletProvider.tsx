"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearAuthSession, getStoredSessionWallet, signInWithWallet } from "@/lib/api/auth";
import { broadcastWalletDisconnect, createCrossTabSync } from "@/lib/api/cross-tab-sync";
import { safeReturnTo } from "@/lib/navigation";
import { NETWORK_PASSPHRASE } from "./config";
import { describeError, UserFacingError } from "./errors";
import type { Signer } from "./clients";
import { loadStellarWalletsKit, type WalletKitAdapter } from "./wallet-kit-adapter";
import { WalletInterpreter } from "./wallet-interpreter";
import { viewOf } from "./wallet-machine";
import { TransactionTrackerProvider } from "./tx-tracker";
import { storedPushWallet, unsubscribe as unsubscribePush } from "@/lib/notifications/push";
import { LedgerInvalidator } from "./ledger-invalidation";

export interface OpenModalOptions {
  /**
   * Where to go after a successful connect. Only a same-origin path is used
   * (see safeReturnTo). Without it the user stays on the page they are on.
   */
  returnTo?: string;
}

export interface WalletContextValue {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  /** Passphrase the wallet reports, or null before it has said. */
  walletNetworkPassphrase: string | null;
  isWrongNetwork: boolean;
  /** Signs as the connected account; null when disconnected. */
  signer: Signer | null;
  /** True when the backend session (JWT) belongs to the connected address. */
  isAuthenticated: boolean;
  /** Last connect/sign-in error, in plain language. */
  error: string | null;
  /** Resolves true if a wallet is connected when the attempt ends. Stays on the current page. */
  openModal: (opts?: OpenModalOptions) => Promise<boolean>;
  /** Runs the backend challenge login if there's no session for this address. */
  ensureSession: () => Promise<boolean>;
  /**
   * Signs in to the backend right before `fn`, which calls a protected endpoint.
   * Throws a readable error if the user declines, so `fn` never runs without a session.
   */
  withSession: <T>(fn: () => Promise<T>, why: string) => Promise<T>;
  disconnect: () => Promise<void>;
  /** Wallet module the user picked in the kit (e.g. "freighter"), for diagnostics. Optional. */
  selectedWalletId?: string | null;
}

/**
 * The wallet context is split into slices so a component only re-renders when
 * the part of the wallet it actually reads changes. Each slice is a separate
 * React context with a memoized value; `useWallet()` stays as a compatibility
 * facade over all of them.
 */
export interface WalletIdentityValue {
  address: string | null;
  isConnected: boolean;
}

export interface WalletNetworkValue {
  walletNetworkPassphrase: string | null;
  isWrongNetwork: boolean;
}

export interface WalletSessionValue {
  isAuthenticated: boolean;
  isConnecting: boolean;
  error: string | null;
}

export interface WalletMetaValue {
  /** Wallet module the user picked in the kit (e.g. "freighter"), for diagnostics. */
  selectedWalletId: string | null;
}

export interface WalletActionsValue {
  openModal: (opts?: OpenModalOptions) => Promise<boolean>;
  ensureSession: () => Promise<boolean>;
  withSession: <T>(fn: () => Promise<T>, why: string) => Promise<T>;
  disconnect: () => Promise<void>;
}

const IdentityContext = createContext<WalletIdentityValue | null>(null);
const NetworkContext = createContext<WalletNetworkValue | null>(null);
const SessionContext = createContext<WalletSessionValue | null>(null);
const SignerContext = createContext<Signer | null | undefined>(undefined);
const ActionsContext = createContext<WalletActionsValue | null>(null);
const MetaContext = createContext<WalletMetaValue | null>(null);

const OUTSIDE_PROVIDER = "must be used inside <WalletProvider>";

/** The connected account. Changes only when the account changes. */
export function useWalletAddress(): WalletIdentityValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error(`useWalletAddress ${OUTSIDE_PROVIDER}`);
  return ctx;
}

/** The network the wallet reports, and whether it is the wrong one. */
export function useWalletNetwork(): WalletNetworkValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error(`useWalletNetwork ${OUTSIDE_PROVIDER}`);
  return ctx;
}

/** Sign-in state: whether a backend session exists, and the last error. */
export function useWalletSession(): WalletSessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error(`useWalletSession ${OUTSIDE_PROVIDER}`);
  return ctx;
}

/** The signer for the connected account, or null when disconnected. */
export function useWalletSigner(): Signer | null {
  const ctx = useContext(SignerContext);
  if (ctx === undefined) throw new Error(`useWalletSigner ${OUTSIDE_PROVIDER}`);
  return ctx;
}

/** Connect, sign in and disconnect. These identities never change. */
export function useWalletActions(): WalletActionsValue {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error(`useWalletActions ${OUTSIDE_PROVIDER}`);
  return ctx;
}

/** Diagnostics about the wallet module in use. */
export function useWalletMeta(): WalletMetaValue {
  const ctx = useContext(MetaContext);
  if (!ctx) throw new Error(`useWalletMeta ${OUTSIDE_PROVIDER}`);
  return ctx;
}

/**
 * Compatibility facade: the whole wallet value in one object.
 *
 * It re-renders on *any* wallet change, so hot components (the trade ticket,
 * the wallet dropdown) should use the narrow hooks above instead.
 */
export function useWallet(): WalletContextValue {
  const identity = useWalletAddress();
  const network = useWalletNetwork();
  const session = useWalletSession();
  const signer = useWalletSigner();
  const actions = useWalletActions();
  const meta = useWalletMeta();
  return useMemo(
    () => ({ ...identity, ...network, ...session, signer, ...actions, ...meta }),
    [identity, network, session, signer, actions, meta],
  );
}

export interface WalletProviderProps {
  children: ReactNode;
  /** Replaces the real kit in tests. Defaults to loading Stellar Wallets Kit in the browser. */
  kitLoader?: () => Promise<WalletKitAdapter>;
}

export function WalletProvider({ children, kitLoader = loadStellarWalletsKit }: WalletProviderProps) {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 1000 * 60 * 2, refetchOnWindowFocus: false } },
      }),
  );

  // All wallet logic lives in the state machine; this component only renders it.
  // The initializer stores deferred navigation callbacks; it never reads the ref.
  const [interpreter] = useState(
    // eslint-disable-next-line react-hooks/refs
    () =>
      new WalletInterpreter({
        loadKit: kitLoader,
        storedSessionWallet: getStoredSessionWallet,
        clearBackendSession: clearAuthSession,
        signIn: async (address, sign) => {
          const session = await signInWithWallet(address, async (xdr, networkPassphrase) => {
            const { signedTxXdr } = await sign(xdr, { networkPassphrase, address });
            return signedTxXdr;
          });
          return session.walletAddress;
        },
        purgeStellarQueries: () => queryClient.removeQueries({ queryKey: ["stellar"] }),
        navigate: (to) => routerRef.current.replace(to),
        describe: (err) => describeError(err),
        broadcastDisconnect: broadcastWalletDisconnect,
      }),
  );

  // Starts the kit, restores a session the kit persisted (never redirects or
  // prompts), and tears the kit subscriptions down on unmount.
  useEffect(() => interpreter.start(), [interpreter]);

  // Changes made in another tab (disconnect, account switch, login) reach this tab.
  useEffect(() => {
    const sync = createCrossTabSync((msg) => interpreter.applyCrossTab(msg));
    return () => sync.unsubscribe();
  }, [interpreter]);

  const state = useSyncExternalStore(interpreter.subscribe, interpreter.getState, interpreter.getState);
  const view = useMemo(() => viewOf(state), [state]);
  const { address } = view;

  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  useEffect(() => {
    if (!address) return;
    let live = true;
    kitLoader()
      .then((kit) => live && setSelectedWalletId(kit.selectedModuleId?.() ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [address, kitLoader]);

  // Push notifications are per-origin, not per-wallet: when the wallet
  // disconnects or switches, drop the previous wallet's subscription so its
  // pushes never show while another wallet is connected. Best effort.
  useEffect(() => {
    const stored = storedPushWallet();
    if (stored && stored !== address && !view.isConnecting) void unsubscribePush().catch(() => {});
  }, [address, view.isConnecting]);

  // Event-driven invalidation heartbeat
  useEffect(() => {
    const invalidator = new LedgerInvalidator({
      queryClient,
      getUserAddress: () => address,
    });
    return invalidator.start();
  }, [queryClient, address]);

  const signer = useMemo<Signer | null>(() => {
    if (!address) return null;
    return {
      publicKey: address,
      signTransaction: (xdr, opts) =>
        interpreter.signTransaction(xdr, { networkPassphrase: opts?.networkPassphrase ?? NETWORK_PASSPHRASE, address }),
    };
  }, [address, interpreter]);

  // The actions read the interpreter's *current* state when they are called, so
  // their identities can stay stable for the lifetime of the provider.
  const actions = useMemo<WalletActionsValue>(
    () => ({
      openModal: (opts) => interpreter.openModal(safeReturnTo(opts?.returnTo)),
      ensureSession: () => interpreter.ensureSession(),
      withSession: async (fn, why) => {
        if (!(await interpreter.ensureSession())) {
          const connected = viewOf(interpreter.getState()).isConnected;
          throw new UserFacingError({
            kind: "disconnected",
            message: connected ? `Sign in with your wallet to ${why}.` : `Connect your wallet to ${why}.`,
          });
        }
        return fn();
      },
      disconnect: async () => {
        await unsubscribePush().catch(() => {});
        await interpreter.disconnect();
      },
    }),
    [interpreter],
  );

  // One slice per concern. Each value only changes when its own fields do, so
  // a component that reads one slice is not re-rendered by the others.
  const identity = useMemo<WalletIdentityValue>(
    () => ({ address: view.address, isConnected: view.isConnected }),
    [view.address, view.isConnected],
  );
  const network = useMemo<WalletNetworkValue>(
    () => ({
      walletNetworkPassphrase: view.walletNetworkPassphrase,
      isWrongNetwork: Boolean(view.walletNetworkPassphrase) && view.walletNetworkPassphrase !== NETWORK_PASSPHRASE,
    }),
    [view.walletNetworkPassphrase],
  );
  const session = useMemo<WalletSessionValue>(
    () => ({ isAuthenticated: view.isAuthenticated, isConnecting: view.isConnecting, error: view.error }),
    [view.isAuthenticated, view.isConnecting, view.error],
  );
  const meta = useMemo<WalletMetaValue>(
    () => ({ selectedWalletId: address ? selectedWalletId : null }),
    [address, selectedWalletId],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ActionsContext.Provider value={actions}>
        <IdentityContext.Provider value={identity}>
          <NetworkContext.Provider value={network}>
            <SessionContext.Provider value={session}>
              <SignerContext.Provider value={signer}>
                <MetaContext.Provider value={meta}>
                  <TransactionTrackerProvider>{children}</TransactionTrackerProvider>
                </MetaContext.Provider>
              </SignerContext.Provider>
            </SessionContext.Provider>
          </NetworkContext.Provider>
        </IdentityContext.Provider>
      </ActionsContext.Provider>
    </QueryClientProvider>
  );
}
