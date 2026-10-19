/**
 * Compile-time switch for the debug panels. Each process.env reference is
 * literal so Next inlines it and production builds without the flag drop the
 * panel code entirely (the dynamic import becomes dead code).
 *
 * NEXT_PUBLIC_DEBUG_PANELS is accepted as an alias (RPC panel, issue #126).
 */
export const DEBUG_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_DEBUG_PANEL === "1" ||
  process.env.NEXT_PUBLIC_DEBUG_PANELS === "1" ||
  process.env.NODE_ENV !== "production";
