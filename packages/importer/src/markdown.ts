import { createHash } from "node:crypto";
import { extname } from "node:path";
import type {
  DecisionStatus,
  DesiredOutcome,
  ImplementationStatus,
  Priority,
} from "@facet/protocol";
import { strFromU8, unzipSync } from "fflate";
import type { Heading, Root, Table } from "mdast";
import { toString as toText } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type {
  ImportedCapability,
  ImportedFeatureArea,
  ImportedMatrix,
  ImportWarning,
} from "./types";

const SUBJECT_ALIASES = new Map([
  ["macos", "macOS"],
  ["mac os", "macOS"],
  ["ios", "iOS"],
  ["android", "Android"],
  ["linux", "Linux"],
  ["flutter", "Flutter"],
]);

export async function readOutlineMarkdown(
  path: string,
): Promise<{ markdown: string; hash: string; sourceName: string }> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  let markdown: string;
  let sourceName = path;
  if (extname(path).toLowerCase() === ".zip") {
    const entries = unzipSync(bytes);
    const candidates = Object.entries(entries).filter(([name]) =>
      name.toLowerCase().endsWith(".md"),
    );
    if (candidates.length === 0)
      throw new Error("Outline export ZIP contains no Markdown document.");
    const [name, contents] = candidates.sort((a, b) => b[1].byteLength - a[1].byteLength)[0]!;
    sourceName = name;
    markdown = strFromU8(contents);
  } else {
    markdown = new TextDecoder().decode(bytes);
  }
  return { markdown, sourceName, hash: createHash("sha256").update(markdown).digest("hex") };
}

export function parseOutlineMatrix(markdown: string): ImportedMatrix {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
  const warnings: ImportWarning[] = [];
  const areas: ImportedFeatureArea[] = [];
  const subjects = new Set<string>();
  let documentTitle = "White Noise";
  let currentArea: ImportedFeatureArea | undefined;
  let rowNumber = 0;

  visit(tree, (node) => {
    if (node.type === "heading") {
      const heading = node as Heading;
      const title = toText(heading).trim();
      if (heading.depth === 1 && title) documentTitle = title;
      if (heading.depth === 2 && title) {
        currentArea = { sourceId: slug(title), title, capabilities: [] };
        areas.push(currentArea);
      }
      return;
    }
    if (node.type !== "table") return;
    const table = node as Table;
    const header = table.children[0]?.children.map((cell) => toText(cell).trim()) ?? [];
    if (header.length < 2) return;
    if (!currentArea) {
      currentArea = {
        sourceId: `area-${areas.length + 1}`,
        title: `Feature area ${areas.length + 1}`,
        capabilities: [],
      };
      areas.push(currentArea);
    }
    const columns = header.map(classifyColumn);
    for (const column of columns) if (column.type === "subject") subjects.add(column.subject);
    for (const row of table.children.slice(1)) {
      rowNumber += 1;
      const cells = row.children.map((cell) => toText(cell).trim());
      const title = cells[0]?.trim();
      if (!title) continue;
      const capability: ImportedCapability = {
        sourceId: `${currentArea.sourceId}:${slug(title)}`,
        title,
        assessments: {},
        desiredOutcome: "undecided",
        decisionStatus: "open",
        priority: "none",
        links: extractLinks(row),
        sourceRow: rowNumber,
      };
      columns.forEach((column, index) => {
        const cell = cells[index] ?? "";
        if (column.type === "subject")
          capability.assessments[column.subject] = mapImplementationStatus(
            cell,
            capability.sourceId,
            warnings,
          );
        if (column.type === "description" && cell) capability.description = cell;
        if (column.type === "desired")
          capability.desiredOutcome = mapDesiredOutcome(cell, capability.sourceId, warnings);
        if (column.type === "decision")
          capability.decisionStatus = mapDecisionStatus(cell, capability.sourceId, warnings);
        if (column.type === "priority") capability.priority = mapPriority(cell);
      });
      currentArea.capabilities.push(capability);
    }
  });

  return { title: documentTitle, featureAreas: areas, subjects: [...subjects], warnings };
}

type Column =
  | { type: "title" }
  | { type: "subject"; subject: string }
  | { type: "description" | "desired" | "decision" | "priority" | "other" };

function classifyColumn(value: string): Column {
  const normalized = normalize(value);
  const subject = SUBJECT_ALIASES.get(normalized);
  if (subject) return { type: "subject", subject };
  if (/capability|feature|function/u.test(normalized)) return { type: "title" };
  if (/description|notes?|evidence/u.test(normalized)) return { type: "description" };
  if (/desired|outcome|parity action/u.test(normalized)) return { type: "desired" };
  if (/decision status|decision/u.test(normalized)) return { type: "decision" };
  if (/priority/u.test(normalized)) return { type: "priority" };
  return { type: "other" };
}

export function mapImplementationStatus(
  value: string,
  sourceId: string,
  warnings: ImportWarning[],
): ImplementationStatus {
  const normalized = normalize(value);
  if (!normalized || /unknown|tbd|\?/u.test(normalized)) return "unknown";
  if (/not applicable|n\/a|na$/u.test(normalized)) return "not_applicable";
  if (/stub|broken|placeholder/u.test(normalized)) return "stub_or_broken";
  if (/partial|incomplete|limited|some/u.test(normalized)) return "partial";
  if (/not implemented|missing|none|no$/u.test(normalized)) return "not_implemented";
  if (/implemented|complete|yes|supported|done/u.test(normalized)) return "implemented";
  warnings.push({
    code: "ambiguous_status",
    sourceId,
    message: `Could not map implementation status: ${value}`,
  });
  return "unknown";
}

function mapDesiredOutcome(
  value: string,
  sourceId: string,
  warnings: ImportWarning[],
): DesiredOutcome {
  const normalized = normalize(value);
  if (/keep as is|keep|no change/u.test(normalized)) return "keep_as_is";
  if (/standardize|align|parity/u.test(normalized)) return "standardize";
  if (/platform specific|platform-specific/u.test(normalized)) return "platform_specific";
  if (/remove|drop/u.test(normalized)) return "remove";
  if (/add|implement/u.test(normalized)) return "add";
  if (normalized && !/undecided|tbd|unknown/u.test(normalized))
    warnings.push({
      code: "ambiguous_decision",
      sourceId,
      message: `Could not map desired outcome: ${value}`,
    });
  return "undecided";
}

function mapDecisionStatus(
  value: string,
  sourceId: string,
  warnings: ImportWarning[],
): DecisionStatus {
  const normalized = normalize(value);
  if (/superseded|obsolete/u.test(normalized)) return "superseded";
  if (/decided|approved|final/u.test(normalized)) return "decided";
  if (/discuss|review/u.test(normalized)) return "discussing";
  if (normalized && !/open|undecided|tbd/u.test(normalized))
    warnings.push({
      code: "ambiguous_decision",
      sourceId,
      message: `Could not map decision status: ${value}`,
    });
  return "open";
}

function mapPriority(value: string): Priority {
  const normalized = normalize(value);
  if (/^now$|urgent|p0/u.test(normalized)) return "now";
  if (/^next$|soon|p1/u.test(normalized)) return "next";
  if (/^later$|backlog|p2/u.test(normalized)) return "later";
  return "none";
}

function extractLinks(row: Table["children"][number]): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  visit(row, "link", (node: any) => links.push({ label: toText(node) || node.url, url: node.url }));
  return links;
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll("⚠️", "")
    .replace(/[✅❌🟡🟢🔴]/gu, "")
    .replace(/\s+/gu, " ");
}
function slug(value: string): string {
  return (
    normalize(value)
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 100) || "untitled"
  );
}
