"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/lib/contexts/WalletContext";
import { currentRpcUrl, rpcServer } from "@/lib/stellar/clients";
import { NETWORK_PASSPHRASE, STELLAR_NETWORK_ID, X402_URL } from "@/lib/stellar/config";
import { UserFacingError } from "@/lib/stellar/errors";
import { fetchVerifiedTrace } from "@/lib/stellar/verified-trace";
import { createPaymentHeader, requestRequirements, type UnlockDeps, type X402Transport } from "@/lib/x402/client";
import {
  REDELIVERABLE_STATES,
  browserJournal,
  rpcSettlementChain,
  subscribeJournalChanges,
  type JournalEntry,
} from "@/lib/x402/recovery";
import { addToCart, cartKey, loadCart, quoteCart, removeFromCart, saveCart, type CartItem, type CartTrace } from "@/lib/x402/cart";

/** Per-trace unlocks exist only when the contracts repo's x402 service is configured. */
export const X402_ENABLED = Boolean(X402_URL);

export const x402Transport = (): X402Transport => ({ baseUrl: X402_URL, network: STELLAR_NETWORK_ID });

const journalKey = (wallet: string | null) => ["x402", "journal", STELLAR_NETWORK_ID, wallet] as const;

/**
 * Dependencies for unlockTrace bound to the connected wallet, or null when no
 * wallet is connected. Signing refuses on the wrong network or when the
 * wallet can't sign Soroban auth entries.
 */
export function useX402UnlockDeps(): UnlockDeps | null {
  const { signer, isWrongNetwork } = useWallet();
  return useMemo(() => {
    if (!signer) return null;
    return {
      journal: browserJournal(),
      chain: rpcSettlementChain(rpcServer(), NETWORK_PASSPHRASE),
      verify: (onChainTraceId) => fetchVerifiedTrace(onChainTraceId),
      transport: x402Transport(),
      sign: async (paymentRequired, requirement) => {
        if (isWrongNetwork) throw new UserFacingError({ kind: "wrong-network", message: "Switch your wallet to the app's network and try again." });
        if (!signer.signAuthEntry) {
          throw new UserFacingError({ kind: "unknown", message: "Your wallet can't sign Soroban authorization entries, which x402 payments need." });
        }
        return createPaymentHeader(paymentRequired, requirement, { address: signer.publicKey, signAuthEntry: signer.signAuthEntry }, currentRpcUrl());
      },
    };
  }, [signer, isWrongNetwork]);
}

/** Re-reads journal queries when any tab writes to the journal. */
function useJournalRefresh(wallet: string | null) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!wallet || !X402_ENABLED) return;
    return subscribeJournalChanges((change) => {
      if (change.wallet === wallet && change.network === STELLAR_NETWORK_ID) {
        void queryClient.invalidateQueries({ queryKey: journalKey(wallet) });
      }
    });
  }, [wallet, queryClient]);
}

/** This wallet's journal entries on this network, newest first. Null data when IndexedDB is unavailable. */
function useJournalEntries(wallet: string | null) {
  useJournalRefresh(wallet);
  return useQuery({
    queryKey: journalKey(wallet),
    enabled: Boolean(wallet) && X402_ENABLED,
    staleTime: Infinity,
    queryFn: async (): Promise<JournalEntry[] | null> => {
      const journal = browserJournal();
      if (!journal || !wallet) return null;
      try {
        return await journal.list(wallet, STELLAR_NETWORK_ID);
      } catch {
        return null;
      }
    },
  });
}

/** Payments that were signed but not delivered: saved for redelivery, or paid without content. */
export function useOpenX402Payments(wallet: string | null) {
  const entries = useJournalEntries(wallet);
  const open = useMemo(
    () => (entries.data ?? []).filter((entry) => entry.state === "settled-undelivered" || REDELIVERABLE_STATES.includes(entry.state)),
    [entries.data],
  );
  return { open, isLoading: entries.isLoading };
}

/** Newest journal entry for one trace (any state), and whether the journal is usable. */
export function useTraceJournal(wallet: string | null, onChainTraceId: string) {
  const entries = useJournalEntries(wallet);
  const entry = useMemo(() => entries.data?.find((e) => e.onChainTraceId === onChainTraceId), [entries.data, onChainTraceId]);
  return { entry, journalAvailable: entries.data !== null, isLoading: entries.isLoading };
}

/** The live 402 price for one trace. */
export function useX402Quote(onChainTraceId: string | null) {
  return useQuery({
    queryKey: ["x402", "quote", STELLAR_NETWORK_ID, onChainTraceId],
    enabled: Boolean(onChainTraceId) && X402_ENABLED,
    staleTime: 30_000,
    queryFn: () => requestRequirements(onChainTraceId as string, x402Transport()),
  });
}

/** Only queued items are quoted automatically; a failed quote is retried by the user (see UnlockCart). */
const needsQuote = (item: CartItem) => item.status === "queued";

/**
 * Cart state for /reasoning: items persisted per wallet in sessionStorage
 * (ids only), quoted from the live 402 three at a time.
 */
export function useUnlockCart(wallet: string | null) {
  const storageKey = wallet ? cartKey(wallet, STELLAR_NETWORK_ID) : null;
  const [items, setItems] = useState<CartItem[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Restore on wallet change (reading storage during render would break hydration).
  useEffect(() => {
    const session = typeof window === "undefined" ? null : window.sessionStorage;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores browser-only session state when the wallet changes
    setItems(storageKey ? loadCart(session, storageKey) : []);
    setLoadedKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (storageKey && loadedKey === storageKey) saveCart(window.sessionStorage, storageKey, items);
  }, [items, storageKey, loadedKey]);

  const updateItem = useCallback((next: CartItem) => {
    setItems((current) => current.map((item) => (item.onChainTraceId === next.onChainTraceId ? next : item)));
  }, []);

  const add = useCallback((trace: CartTrace): string | undefined => {
    const result = addToCart([], trace);
    if (result.error) return result.error;
    setItems((current) => addToCart(current, trace).items);
    return undefined;
  }, []);

  const remove = useCallback((onChainTraceId: string) => setItems((current) => removeFromCart(current, onChainTraceId)), []);
  const clear = useCallback(() => setItems([]), []);

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const pendingQuotes = items.filter(needsQuote).length;

  const quote = useCallback(async () => {
    const pending = itemsRef.current.filter(needsQuote);
    if (pending.length === 0) return;
    await quoteCart(pending, { requestRequirements: (id) => requestRequirements(id, x402Transport()), network: STELLAR_NETWORK_ID }, updateItem);
  }, [updateItem]);

  return { items, pendingQuotes, add, remove, clear, quote, updateItem };
}
