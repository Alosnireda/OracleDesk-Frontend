"use client";

import { createContext, useContext } from "react";

/**
 * True while a newer service worker is waiting. Signing is blocked until the
 * user reloads (see useWriteGuard), so no transaction is signed by an
 * outdated bundle.
 */
export const UpdatePendingContext = createContext(false);

export function useUpdatePending(): boolean {
  return useContext(UpdatePendingContext);
}
