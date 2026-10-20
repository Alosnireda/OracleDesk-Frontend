import { describe, it, expect } from "vitest";
import { transformTsx } from "../../scripts/codemod-icons.mjs";
import { Icon, type IconName } from "@/components/ui/icon";

describe("codemod-icons fixture transformations", () => {
  it("converts a static ligature span into <Icon />", () => {
    const input = `export function View() {
  return <span className="material-symbols-outlined text-[18px]">close</span>;
}`;
    const { modified, outputText } = transformTsx(input, "test.tsx");
    expect(modified).toBe(true);
    expect(outputText).toContain('<Icon name="close" className="text-[18px]" />');
    expect(outputText).toContain('import { Icon } from "@/components/ui/icon";');
  });

  it("converts a filled variant fontVariationSettings: 'FILL' 1 into filled prop", () => {
    const input = `export function View() {
  return (
    <span
      className="material-symbols-outlined text-primary"
      style={{ fontVariationSettings: "'FILL' 1" }}
    >
      psychology
    </span>
  );
}`;
    const { modified, outputText } = transformTsx(input, "test.tsx");
    expect(modified).toBe(true);
    expect(outputText).toContain('<Icon name="psychology" filled className="text-primary" />');
    expect(outputText).not.toContain("fontVariationSettings");
  });

  it("converts icon-as-button with existing aria-label", () => {
    const input = `export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      className="material-symbols-outlined p-2"
      aria-label="Close"
      onClick={onClose}
    >
      close
    </button>
  );
}`;
    const { modified, outputText, report } = transformTsx(input, "test.tsx");
    expect(modified).toBe(true);
    expect(outputText).toContain('<button aria-label="Close" className="p-2" onClick={onClose}>');
    expect(outputText).toContain('<Icon name="close" />');
    expect(report.labeledControls.length).toBe(0); // already had aria-label
  });

  it("converts icon-as-link without aria-label and infers accessible name", () => {
    const input = `export function NavLink() {
  return (
    <a className="material-symbols-outlined hover:text-primary" href="/notifications">
      notifications
    </a>
  );
}`;
    const { modified, outputText, report } = transformTsx(input, "test.tsx");
    expect(modified).toBe(true);
    expect(outputText).toContain('aria-label="Notifications"');
    expect(outputText).toContain('<Icon name="notifications" />');
    expect(report.labeledControls).toEqual([
      expect.objectContaining({
        element: "a",
        icon: "notifications",
        addedLabel: "Notifications",
      }),
    ]);
  });

  it("leaves dynamic children untouched and reports them", () => {
    const input = `export function DynamicIcon({ icon }: { icon: string }) {
  return <span className="material-symbols-outlined">{icon}</span>;
}`;
    const { modified, outputText, report } = transformTsx(input, "test.tsx");
    expect(modified).toBe(false);
    expect(outputText).toBe(input);
    expect(report.dynamicChildren.length).toBe(1);
    expect((report.dynamicChildren[0] as { reason: string }).reason).toContain("Dynamic");
  });
});

describe("Icon component type safety", () => {
  it("allows valid IconName values", () => {
    const validName: IconName = "account_balance_wallet";
    expect(validName).toBe("account_balance_wallet");
  });

  it("rejects unknown icon names at compile time", () => {
    // @ts-expect-error - invalid icon name must be rejected by TypeScript
    const invalidName: IconName = "non_existent_icon_xyz";
    expect(invalidName).toBe("non_existent_icon_xyz");
  });
});
