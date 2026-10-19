import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function collectTsxFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next") {
        results.push(...collectTsxFiles(fullPath));
      }
    } else if (entry.name.endsWith(".tsx")) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("Typography & Icons enforcement", () => {
  const rootDir = process.cwd();
  const appFiles = collectTsxFiles(path.join(rootDir, "app"));
  const componentFiles = collectTsxFiles(path.join(rootDir, "components"));
  const allFiles = [...appFiles, ...componentFiles];

  it("finds at least some tsx files to validate", () => {
    expect(allFiles.length).toBeGreaterThan(20);
  });

  it("does not contain material-symbols-outlined in any app or component tsx file", () => {
    const offending: { file: string; line: number; text: string }[] = [];

    for (const file of allFiles) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("material-symbols-outlined")) {
        const lines = content.split("\n");
        lines.forEach((line, idx) => {
          if (line.includes("material-symbols-outlined")) {
            offending.push({
              file: path.relative(rootDir, file),
              line: idx + 1,
              text: line.trim(),
            });
          }
        });
      }
    }

    expect(offending).toEqual([]);
  });

  it("does not contain fonts.googleapis.com or fonts.gstatic.com in app or components", () => {
    const offending: { file: string; line: number; text: string }[] = [];

    for (const file of allFiles) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("fonts.googleapis.com") || content.includes("fonts.gstatic.com")) {
        const lines = content.split("\n");
        lines.forEach((line, idx) => {
          if (line.includes("fonts.googleapis.com") || line.includes("fonts.gstatic.com")) {
            offending.push({
              file: path.relative(rootDir, file),
              line: idx + 1,
              text: line.trim(),
            });
          }
        });
      }
    }

    expect(offending).toEqual([]);
  });
});
