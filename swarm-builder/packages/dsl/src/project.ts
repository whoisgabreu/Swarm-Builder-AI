import type { BuildPlan, CriticIssue, CriticResult, Node, RefinementPatch, Responsive, SectionPatch, SectionSpec, Style } from "./schema.js";

const clone = <T>(value: T): T => structuredClone(value);

const placeholder = (spec: SectionSpec): Node => ({
  id: spec.id,
  type: "section",
  props: { kind: spec.kind, placeholder: true },
  a11y: { label: spec.title },
  style: {
    minHeight: "200px",
    background: "var(--sw-surface)",
    border: "1px dashed var(--sw-border)",
  },
  children: [
    {
      id: `${spec.id}-placeholder`,
      type: "stack",
      style: { alignItems: "center", justifyContent: "center", minHeight: "200px" },
      children: [
        {
          id: `${spec.id}-placeholder-icon`,
          type: "icon",
          text: "◌",
          style: { fontSize: "30px", color: "var(--sw-muted)" },
        },
        {
          id: `${spec.id}-placeholder-text`,
          type: "text",
          text: `Construindo ${spec.title.toLowerCase()}…`,
          style: { textAlign: "center" },
        },
      ],
    },
  ],
});

export const createArtifact = (plan: BuildPlan): Node => ({
  id: "page",
  type: "page",
  children: plan.sections.map((section) => placeholder(section)),
});

export const findNode = (root: Node, id: string): Node | null => {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
};

export const replaceNode = (root: Node, id: string, next: Node): boolean => {
  const children = root.children;
  if (!children) return false;
  for (let i = 0; i < children.length; i++) {
    if (children[i]?.id === id) {
      children[i] = next;
      return true;
    }
    if (replaceNode(children[i]!, id, next)) return true;
  }
  return false;
};

const normalizeIds = (node: Node, sectionId: string): Node => {
  const next = clone(node);
  const walk = (current: Node, root = false) => {
    if (root) current.id = sectionId;
    else if (!current.id.startsWith(`${sectionId}-`)) current.id = `${sectionId}-${current.id}`;
    for (const child of current.children ?? []) walk(child);
  };
  walk(next, true);
  return next;
};

export const MAX_SECTION_NODES = 120;

export const validateSectionPatch = (
  patch: SectionPatch,
  plan: BuildPlan,
): { ok: true; node: Node } | { ok: false; error: string } => {
  const spec = plan.sections.find((section) => section.id === patch.sectionId);
  if (!spec) return { ok: false, error: `unknown section ${patch.sectionId}` };
  if (patch.node.type !== "section") return { ok: false, error: "section patch root must be a section" };
  const node = normalizeIds(patch.node, spec.id);
  if (!collectText(node).trim()) return { ok: false, error: "section has no text content" };
  const nodes = countNodes(node);
  if (nodes > MAX_SECTION_NODES) {
    return { ok: false, error: `section is too large: ${nodes} nodes (maximum ${MAX_SECTION_NODES})` };
  }
  return { ok: true, node };
};

export const applySectionPatch = (root: Node, node: Node): Node => {
  const next = clone(root);
  if (!replaceNode(next, node.id, node)) throw new Error(`section ${node.id} not found`);
  return next;
};

const mergeStyle = (current: Style | undefined, patch: Style | undefined): Style | undefined => {
  if (!current && !patch) return undefined;
  return { ...(current ?? {}), ...(patch ?? {}) };
};

const mergeResponsive = (current: Responsive | undefined, patch: Responsive | undefined): Responsive | undefined => {
  if (!current && !patch) return undefined;
  return {
    ...(current ?? {}),
    ...(patch ?? {}),
    mobile: mergeStyle(current?.mobile, patch?.mobile),
    tablet: mergeStyle(current?.tablet, patch?.tablet),
  };
};

export const applyCriticIssue = (root: Node, issue: CriticIssue): Node => {
  const next = clone(root);
  if (!issue.nodeId || !issue.patch) return next;
  const node = findNode(next, issue.nodeId);
  if (!node) return next;
  const patch = issue.patch;
  if (patch.text != null) node.text = patch.text;
  if (patch.src != null) node.src = patch.src;
  if (patch.alt != null) node.alt = patch.alt;
  if (patch.href != null) node.href = patch.href;
  if (patch.style) node.style = mergeStyle(node.style, patch.style);
  if (patch.responsive) node.responsive = mergeResponsive(node.responsive, patch.responsive);
  return next;
};

export const applyCriticResult = (root: Node, result: CriticResult): Node =>
  result.issues.reduce((current, issue) => applyCriticIssue(current, issue), root);

export const collectText = (node: Node): string => {
  const own = node.text ?? "";
  return [own, ...(node.children ?? []).map((child) => collectText(child))].join(" ");
};

export const countNodes = (root: Node): number =>
  1 + (root.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);

export const collectNodes = (root: Node): Node[] => [
  root,
  ...(root.children ?? []).flatMap((child) => collectNodes(child)),
];

const firstCopy = (value: string, max = 320): string => {
  const clean = value
    .replace(/\b(t[ií]tulo|texto|headline|copy|subheadline|cta)\s*:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (boundary > max * 0.5 ? cut.slice(0, boundary + 1) : cut).trim();
};

export const fallbackSection = (spec: SectionSpec): Node => {
  const copy = firstCopy(spec.contentBrief) || spec.goal || spec.title;
  const compact = spec.kind === "nav" || spec.kind === "footer";
  const headingLevel = spec.kind === "hero" ? 1 : 2;
  const action: Node = {
    id: `${spec.id}-fallback-action`,
    type: spec.kind === "nav" || spec.kind === "footer" ? "link" : "button",
    text: spec.kind === "footer" ? "Entrar em contato" : spec.kind === "nav" ? "Início" : "Começar agora",
    href: "#",
  };
  return {
    id: spec.id,
    type: "section",
    props: { kind: spec.kind, fallback: true },
    a11y: { label: spec.title },
    style: compact
      ? undefined
      : { background: "var(--sw-surface)", borderTop: "1px solid var(--sw-border)" },
    children: [
      {
        id: `${spec.id}-fallback-inner`,
        type: "stack",
        style: {
          maxWidth: "1120px",
          margin: "0 auto",
          gap: "18px",
          display: compact ? "flex" : "flex",
          flexDirection: compact ? "row" : "column",
          alignItems: compact ? "center" : "flex-start",
          justifyContent: compact ? "space-between" : "flex-start",
          padding: compact ? "8px 0" : "24px 0",
        },
        children: [
          {
            id: `${spec.id}-fallback-title`,
            type: "heading",
            level: headingLevel,
            text: spec.title,
            style: compact ? { fontSize: "18px" } : { fontSize: "clamp(30px, 4vw, 48px)" },
          },
          {
            id: `${spec.id}-fallback-copy`,
            type: "text",
            text: copy,
            style: compact ? { fontSize: "14px", maxWidth: "620px" } : { fontSize: "17px", maxWidth: "720px" },
          },
          action,
        ],
      },
    ],
  };
};

export const applyRefinements = (root: Node, patches: RefinementPatch[]): Node => {
  const next = clone(root);
  for (const patch of patches) {
    const node = findNode(next, patch.nodeId);
    if (!node) continue;
    if (patch.text != null) node.text = patch.text;
    if (patch.src != null) node.src = patch.src;
    if (patch.alt != null) node.alt = patch.alt;
    if (patch.href != null) node.href = patch.href;
    if (patch.style) node.style = mergeStyle(node.style, patch.style);
    if (patch.responsive) node.responsive = mergeResponsive(node.responsive, patch.responsive);
  }
  return next;
};
