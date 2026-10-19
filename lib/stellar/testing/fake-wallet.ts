import type { WalletContextValue } from "../WalletProvider";
import type { Signer } from "../clients";

export type FakeWalletPreset = "disconnected" | "connecting" | "connected" | "wrongNetwork" | "unauthenticated" | "withError";

export const FAKE_ADDRESS = "GBFAKEWALLETADDRESSFORSTORIESANDTESTSONLYXXXXXXXXXXXXXXXX";

/** Rejects like a wallet whose user declined, so nothing built on a fake wallet can sign. */
export const declinedSigner: Signer = {
  publicKey: FAKE_ADDRESS,
  signTransaction: async () => {
    throw { code: -4, message: "User declined" };
  },
};

const disconnected: WalletContextValue = {
  address: null,
  isConnected: false,
  isConnecting: false,
  walletNetworkPassphrase: null,
  isWrongNetwork: false,
  signer: null,
  isAuthenticated: false,
  error: null,
  openModal: async () => false,
  ensureSession: async () => false,
  withSession: async (fn) => fn(),
  disconnect: async () => {},
};

const connected: WalletContextValue = {
  ...disconnected,
  address: FAKE_ADDRESS,
  isConnected: true,
  walletNetworkPassphrase: "Test SDF Network ; September 2015",
  signer: declinedSigner,
  isAuthenticated: true,
  openModal: async () => true,
  ensureSession: async () => true,
};

const PRESETS: Record<FakeWalletPreset, WalletContextValue> = {
  disconnected,
  connecting: { ...disconnected, isConnecting: true },
  connected,
  wrongNetwork: { ...connected, walletNetworkPassphrase: "Public Global Stellar Network ; September 2015", isWrongNetwork: true },
  unauthenticated: { ...connected, isAuthenticated: false, ensureSession: async () => false },
  withError: { ...disconnected, error: "Your wallet didn't respond. Try connecting again." },
};

export function fakeWallet(preset: FakeWalletPreset = "disconnected", overrides: Partial<WalletContextValue> = {}): WalletContextValue {
  return { ...PRESETS[preset], ...overrides };
}
