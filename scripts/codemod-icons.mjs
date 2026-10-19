#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Accessible name map for icon-only buttons or links
export const ACCESSIBLE_NAMES = {
  close: "Close",
  notifications: "Notifications",
  expand_more: "Expand",
  expand_less: "Collapse",
  arrow_back: "Go back",
  arrow_forward: "Next",
  search: "Search",
  settings: "Settings",
  logout: "Log out",
  history: "History",
  refresh: "Refresh",
  sync: "Sync",
  copy: "Copy",
  content_copy: "Copy to clipboard",
  delete: "Delete",
  add: "Add",
  edit: "Edit",
  info: "Information",
  filter_list: "Filter",
};

/**
 * Clean up className string by removing `material-symbols-outlined`
 */
function cleanClassName(cls) {
  return cls
    .replace(/\bmaterial-symbols-outlined\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if a style JSX attribute matches fontVariationSettings: 'FILL' 1
 */
function isFillStyle(attr) {
  if (!attr || !ts.isJsxAttribute(attr) || attr.name.text !== "style") return false;
  if (!attr.initializer || !ts.isJsxExpression(attr.initializer) || !attr.initializer.expression) return false;
  const expr = attr.initializer.expression;
  if (!ts.isObjectLiteralExpression(expr)) return false;

  for (const prop of expr.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const name = prop.name.getText();
      const val = prop.initializer.getText();
      if (
        (name === "fontVariationSettings" || name === "'fontVariationSettings'") &&
        (val.includes('"FILL" 1') || val.includes("'FILL' 1"))
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Transform TSX source text using TypeScript Compiler API
 */
export function transformTsx(sourceText, filePath = "file.tsx") {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const replacements = [];
  const report = {
    converted: [],
    labeledControls: [],
    dynamicChildren: [],
  };

  let hasIconImport = false;

  // Check existing imports
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const moduleSpecifier = statement.moduleSpecifier.getText(sourceFile);
      if (moduleSpecifier.includes("/ui/icon") || moduleSpecifier.includes("@/components/ui/icon")) {
        hasIconImport = true;
      }
    }
  }

  function visit(node) {
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      const tagName = opening.tagName.getText(sourceFile);
      const attributes = opening.attributes.properties;

      let classNameAttr = null;
      let styleAttr = null;
      let ariaLabelAttr = null;
      let otherAttrs = [];

      for (const attr of attributes) {
        if (ts.isJsxAttribute(attr)) {
          const name = attr.name.text;
          if (name === "className") classNameAttr = attr;
          else if (name === "style") styleAttr = attr;
          else if (name === "aria-label") ariaLabelAttr = attr;
          else otherAttrs.push(attr);
        } else {
          otherAttrs.push(attr);
        }
      }

      const classText = classNameAttr?.initializer?.getText(sourceFile) || "";
      const isMaterialIcon = classText.includes("material-symbols-outlined");

      if (isMaterialIcon) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const children = node.children;

        // Check for dynamic children
        const textNodes = children.filter((c) => ts.isJsxText(c) && c.text.trim().length > 0);
        const exprNodes = children.filter((c) => ts.isJsxExpression(c));

        if (tagName === "span") {
          if (exprNodes.length > 0 || textNodes.length === 0) {
            // Dynamic child inside span
            report.dynamicChildren.push({
              file: filePath,
              line,
              code: node.getText(sourceFile).slice(0, 80),
              reason: "Dynamic or expression child",
            });
            ts.forEachChild(node, visit);
            return;
          }

          const iconName = textNodes[0].text.trim();
          if (/^[a-z0-9_]+$/.test(iconName)) {
            // Case 1: Standard span icon
            const hasFilled = isFillStyle(styleAttr);
            const remainingStyle = styleAttr && !hasFilled ? styleAttr.getText(sourceFile) : "";

            let cleanedClass = "";
            if (classNameAttr && classNameAttr.initializer) {
              if (ts.isStringLiteral(classNameAttr.initializer)) {
                cleanedClass = cleanClassName(classNameAttr.initializer.text);
              } else {
                const raw = classNameAttr.initializer.getText(sourceFile);
                cleanedClass = raw.replace(/\bmaterial-symbols-outlined\b\s*/g, "").replace(/\s*\bmaterial-symbols-outlined\b/g, "");
              }
            }

            let iconProps = [`name="${iconName}"`];
            if (hasFilled) iconProps.push("filled");
            if (cleanedClass && cleanedClass !== '""' && cleanedClass !== "``") {
              if (cleanedClass.startsWith("{") || cleanedClass.startsWith("`")) {
                iconProps.push(`className=${cleanedClass}`);
              } else {
                iconProps.push(`className="${cleanedClass}"`);
              }
            }
            if (remainingStyle) {
              iconProps.push(remainingStyle);
            }
            for (const attr of otherAttrs) {
              iconProps.push(attr.getText(sourceFile));
            }

            const replacementText = `<Icon ${iconProps.join(" ")} />`;
            replacements.push({
              start: node.getStart(sourceFile),
              end: node.getEnd(),
              text: replacementText,
            });

            report.converted.push({
              file: filePath,
              line,
              type: "span",
              icon: iconName,
            });
            return;
          }
        } else if (tagName === "button" || tagName === "Link" || tagName === "a") {
          // Case 2: Control element (button, Link, a)
          if (textNodes.length > 0) {
            const rawIconText = textNodes[0].text.trim();
            if (/^[a-z0-9_]+$/.test(rawIconText)) {
              let cleanedClass = "";
              if (classNameAttr && classNameAttr.initializer) {
                if (ts.isStringLiteral(classNameAttr.initializer)) {
                  cleanedClass = cleanClassName(classNameAttr.initializer.text);
                } else {
                  const raw = classNameAttr.initializer.getText(sourceFile);
                  cleanedClass = raw.replace(/\bmaterial-symbols-outlined\b\s*/g, "").replace(/\s*\bmaterial-symbols-outlined\b/g, "");
                }
              }

              const hasFilled = isFillStyle(styleAttr);
              let labelToAdd = null;
              if (!ariaLabelAttr) {
                labelToAdd = ACCESSIBLE_NAMES[rawIconText] || rawIconText;
                report.labeledControls.push({
                  file: filePath,
                  line,
                  element: tagName,
                  icon: rawIconText,
                  addedLabel: labelToAdd,
                });
              }

              // Rebuild opening tag
              let attrsText = "";
              if (labelToAdd) attrsText += ` aria-label="${labelToAdd}"`;
              else if (ariaLabelAttr) attrsText += ` ${ariaLabelAttr.getText(sourceFile)}`;

              if (cleanedClass && cleanedClass !== '""' && cleanedClass !== "``") {
                if (cleanedClass.startsWith("{") || cleanedClass.startsWith("`")) {
                  attrsText += ` className=${cleanedClass}`;
                } else {
                  attrsText += ` className="${cleanedClass}"`;
                }
              }

              if (otherAttrs.length) {
                attrsText += " " + otherAttrs.map((a) => a.getText(sourceFile)).join(" ");
              }

              const iconProps = [`name="${rawIconText}"`];
              if (hasFilled) iconProps.push("filled");

              // Other children (e.g. badge in Navbar)
              const remainingChildren = children
                .filter((c) => c !== textNodes[0])
                .map((c) => c.getText(sourceFile))
                .join("");

              const newContent = `<${tagName}${attrsText}>\n  <Icon ${iconProps.join(" ")} />${remainingChildren}\n</${tagName}>`;

              replacements.push({
                start: node.getStart(sourceFile),
                end: node.getEnd(),
                text: newContent,
              });

              report.converted.push({
                file: filePath,
                line,
                type: `control (${tagName})`,
                icon: rawIconText,
              });
              return;
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (replacements.length === 0) {
    return { modified: false, outputText: sourceText, report };
  }

  // Apply replacements from back to front
  replacements.sort((a, b) => b.start - a.start);
  let result = sourceText;
  for (const rep of replacements) {
    result = result.slice(0, rep.start) + rep.text + result.slice(rep.end);
  }

  // Add import if needed
  if (!hasIconImport) {
    const importStatement = 'import { Icon } from "@/components/ui/icon";\n';
    if (result.startsWith('"use client";') || result.startsWith("'use client';")) {
      const firstLineEnd = result.indexOf("\n") + 1;
      result = result.slice(0, firstLineEnd) + importStatement + result.slice(firstLineEnd);
    } else {
      result = importStatement + result;
    }
  }

  return { modified: true, outputText: result, report };
}

// CLI runner
async function run() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const targetDirs = args.filter((a) => !a.startsWith("--"));

  const roots = targetDirs.length ? targetDirs : ["app", "components"];
  const allFiles = [];

  function collect(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".next") {
          collect(fullPath);
        }
      } else if (entry.name.endsWith(".tsx")) {
        allFiles.push(fullPath);
      }
    }
  }

  for (const root of roots) {
    if (fs.existsSync(root) && fs.statSync(root).isFile()) {
      allFiles.push(root);
    } else {
      collect(root);
    }
  }

  const globalReport = {
    totalFilesScanned: allFiles.length,
    modifiedFilesCount: 0,
    totalIconsConverted: 0,
    labeledControls: [],
    dynamicCasesReported: [],
    convertedPerFile: {},
  };

  for (const file of allFiles) {
    const content = fs.readFileSync(file, "utf8");
    if (!content.includes("material-symbols-outlined")) continue;

    const { modified, outputText, report } = transformTsx(content, file);

    if (modified) {
      globalReport.modifiedFilesCount++;
      globalReport.totalIconsConverted += report.converted.length;
      globalReport.convertedPerFile[file] = report.converted;
      globalReport.labeledControls.push(...report.labeledControls);

      if (!isDryRun) {
        fs.writeFileSync(file, outputText, "utf8");
      }
    }

    if (report.dynamicChildren.length > 0) {
      globalReport.dynamicCasesReported.push(...report.dynamicChildren);
    }
  }

  const reportPath = path.join(process.cwd(), "docs/perf/codemod-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(globalReport, null, 2), "utf8");

  console.log(`\n=== Codemod Icons Summary ===`);
  console.log(`Dry Run: ${isDryRun}`);
  console.log(`Files Scanned: ${globalReport.totalFilesScanned}`);
  console.log(`Files Modified: ${globalReport.modifiedFilesCount}`);
  console.log(`Icons Converted: ${globalReport.totalIconsConverted}`);
  console.log(`Labeled Controls Added: ${globalReport.labeledControls.length}`);
  console.log(`Dynamic Cases Flagged: ${globalReport.dynamicCasesReported.length}`);
  console.log(`Report written to ${reportPath}\n`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
