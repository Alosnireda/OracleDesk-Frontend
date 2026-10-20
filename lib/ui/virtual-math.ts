export type ColumnConfig = number | { base: number; md?: number; xl?: number };

/**
 * Compute the number of columns for a given viewport width and column config.
 * Tailwind breakpoints:
 * md: 768px
 * xl: 1280px
 */
export function columnsForWidth(width: number, config?: ColumnConfig): number {
  if (!config) return 1;
  if (typeof config === "number") return Math.max(1, Math.floor(config));

  const base = Math.max(1, config.base ?? 1);
  const md = config.md !== undefined ? Math.max(1, config.md) : base;
  const xl = config.xl !== undefined ? Math.max(1, config.xl) : md;

  if (width >= 1280) return xl;
  if (width >= 768) return md;
  return base;
}

/**
 * Split a flat array of items into rows for a grid layout.
 */
export function rowsFromItems<T>(items: readonly T[], columns: number): T[][] {
  const cols = Math.max(1, Math.floor(columns));
  if (cols === 1) {
    return items.map((item) => [item]);
  }

  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += cols) {
    rows.push(items.slice(i, i + cols));
  }
  return rows;
}

/**
 * Determine next page param for TanStack Query based on backend PaginationMeta.
 */
export function nextPageParam(meta?: { page?: number; totalPages?: number } | null): number | undefined {
  if (!meta) return undefined;
  const page = meta.page;
  const totalPages = meta.totalPages;
  if (typeof page !== "number" || typeof totalPages !== "number") return undefined;
  if (page < totalPages) {
    return page + 1;
  }
  return undefined;
}
