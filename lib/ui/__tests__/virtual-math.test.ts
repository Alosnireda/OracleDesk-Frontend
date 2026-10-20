import { describe, it, expect } from "vitest";
import { columnsForWidth, rowsFromItems } from "@/lib/ui/virtual-math";

describe("virtual-math helpers", () => {
  describe("columnsForWidth", () => {
    it("returns 1 if config is missing", () => {
      expect(columnsForWidth(1000)).toBe(1);
    });

    it("returns fixed number when config is numeric", () => {
      expect(columnsForWidth(500, 3)).toBe(3);
      expect(columnsForWidth(1500, 4)).toBe(4);
    });

    it("evaluates responsive breakpoints base, md (768), xl (1280)", () => {
      const config = { base: 1, md: 2, xl: 3 };
      expect(columnsForWidth(400, config)).toBe(1);
      expect(columnsForWidth(767, config)).toBe(1);
      expect(columnsForWidth(768, config)).toBe(2);
      expect(columnsForWidth(1024, config)).toBe(2);
      expect(columnsForWidth(1279, config)).toBe(2);
      expect(columnsForWidth(1280, config)).toBe(3);
      expect(columnsForWidth(1920, config)).toBe(3);
    });
  });

  describe("rowsFromItems", () => {
    it("returns 1-item arrays when columns is 1", () => {
      const items = ["a", "b", "c"];
      expect(rowsFromItems(items, 1)).toEqual([["a"], ["b"], ["c"]]);
    });

    it("chunks items into rows of N columns", () => {
      const items = [1, 2, 3, 4, 5];
      expect(rowsFromItems(items, 2)).toEqual([[1, 2], [3, 4], [5]]);
      expect(rowsFromItems(items, 3)).toEqual([[1, 2, 3], [4, 5]]);
    });

    it("handles empty arrays", () => {
      expect(rowsFromItems([], 3)).toEqual([]);
    });
  });
});
