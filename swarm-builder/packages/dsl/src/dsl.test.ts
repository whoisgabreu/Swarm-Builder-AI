import assert from "node:assert/strict";
import test from "node:test";
import { buildRenderOps, compilePage, diffRenderOps, normalizeAnchors, responsiveCss } from "./compiler.js";
import { normalizePlan } from "./normalize.js";
import { applyRefinements, applySectionPatch, createArtifact, fallbackSection, validateSectionPatch } from "./project.js";
import { normalizeStyle } from "./normalize.js";
import type { BuildPlan, Node } from "./schema.js";

const plan: BuildPlan = {
  title: "Teste",
  tagline: "Uma página de teste.",
  theme: {
    colors: {
      background: "#000",
      surface: "#111",
      text: "#fff",
      muted: "#aaa",
      primary: "#0f0",
      primaryText: "#000",
      accent: "#00f",
      border: "#333",
    },
    fonts: { body: "Inter, system-ui, sans-serif", display: "Inter, sans-serif" },
    radius: "16px",
    spacing: "24px",
  },
  sections: [
    {
      id: "hero",
      kind: "hero",
      title: "Hero",
      goal: "Converter.",
      contentBrief: "Headline e CTA.",
      layoutBrief: "Duas colunas.",
    },
  ],
};

test("normalizePlan repairs descriptive design tokens", () => {
  const normalized = normalizePlan({
    ...plan,
    theme: {
      ...plan.theme,
      radius: "Cards e inputs: 14px; botões: 999px",
      spacing: "Base 8px. Seções com padding 96px.",
      fonts: {
        body: "『Inter』, system-ui, sans-serif — pesos 400/500",
        display: "Inter Tight, Inter, sans-serif",
      },
    },
  });
  assert.equal(normalized.theme.radius, "14px");
  assert.equal(normalized.theme.spacing, "8px");
  assert.equal(normalized.theme.fonts?.body, "Inter, system-ui, sans-serif");
  assert.equal(normalized.theme.fonts?.display, "Inter Tight, Inter, sans-serif");
});

test("compiler escapes text and rejects script URLs", () => {
  const root: Node = {
    id: "page",
    type: "page",
    children: [
      {
        id: "hero",
        type: "section",
        children: [
          { id: "hero-title", type: "heading", level: 1, text: "<script>alert(1)</script>" },
          { id: "hero-cta", type: "button", text: "Clique", href: "javascript:alert(1)" },
        ],
      },
    ],
  };
  const html = compilePage({ title: "Teste", plan, root });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /javascript:alert/);
  assert.match(html, /href="#"/);
  assert.match(html, /data-swarm-node="hero-title"/);
});

test("section patches replace placeholders and normalize child ids", () => {
  const artifact = createArtifact(plan);
  const patch = {
    sectionId: "hero",
    node: {
      id: "wrong-id",
      type: "section" as const,
      children: [{ id: "title", type: "heading" as const, text: "Olá" }],
    },
  };
  const checked = validateSectionPatch(patch, plan);
  assert.equal(checked.ok, true);
  if (!checked.ok) return;
  assert.equal(checked.node.id, "hero");
  assert.equal(checked.node.children?.[0]?.id, "hero-title");
  const next = applySectionPatch(artifact, checked.node);
  assert.equal(next.children?.[0]?.id, "hero");
  assert.equal(next.children?.[0]?.children?.[0]?.text, "Olá");
});

test("style normalization accepts real CSS aliases and drops junk", () => {
  const style = normalizeStyle({
    display: "flex",
    flexDirection: "horizontal",
    alignItems: "start",
    justifyContent: "end",
    textAlign: "start",
    position: "sticky",
    overflow: "auto",
    color: "#fff",
    backgroundColor: "#111",
    ["align-items" as never]: "center",
  } as never);
  assert.equal(style?.display, "flex");
  assert.equal(style?.flexDirection, "row");
  assert.equal(style?.alignItems, "center");
  assert.equal(style?.justifyContent, "flex-end");
  assert.equal(style?.textAlign, "left");
  assert.equal(style?.position, "sticky");
  assert.equal(style?.overflow, "auto");
  assert.equal(style?.backgroundColor, "#111");
});

test("compiler normalizes start/end values instead of rejecting the section", () => {
  const root: Node = {
    id: "page",
    type: "page",
    children: [
      {
        id: "hero",
        type: "section",
        children: [
          {
            id: "hero-inner",
            type: "stack",
            style: { display: "flex", alignItems: "start", justifyContent: "end" },
          },
        ],
      },
    ],
  };
  const html = compilePage({ title: "Teste", plan, root });
  assert.match(html, /align-items:flex-start/);
  assert.match(html, /justify-content:flex-end/);
  assert.doesNotMatch(html, /align-items:start/);
});

test("fallback section is a complete, small section", () => {
  const node = fallbackSection(plan.sections[0]!);
  assert.equal(node.id, "hero");
  assert.equal(node.props?.fallback, true);
  assert.ok((node.children?.length ?? 0) > 0);
});

test("normalizePlan fills cursor plan defaults and roles", () => {
  const normalized = normalizePlan({
    ...plan,
    sections: [
      { ...plan.sections[0]!, cursors: { count: 3, mode: "split" } },
      { ...plan.sections[0]!, id: "hero-2", cursors: { count: 2, mode: "race" } },
      { ...plan.sections[0]!, id: "hero-3", cursors: { count: 1, mode: "race" } },
    ],
  });
  assert.equal(normalized.sections[0]?.cursors?.count, 3);
  assert.deepEqual(normalized.sections[0]?.cursors?.roles, ["layout", "copy", "style"]);
  assert.equal(normalized.sections[1]?.cursors?.mode, "race");
  assert.equal(normalized.sections[2]?.cursors?.mode, "solo");
});

test("applyRefinements patches existing nodes only", () => {
  const artifact = createArtifact(plan);
  const next = applyRefinements(artifact, [
    { nodeId: "hero-placeholder-text", text: "Novo texto" },
    { nodeId: "missing", text: "Ignorado" },
  ]);
  const hero = next.children?.find((node) => node.id === "hero");
  const placeholder = hero?.children?.[0]?.children?.[1];
  assert.equal(placeholder?.text, "Novo texto");
});

test("buildRenderOps creates the tree in document order", () => {
  const node: Node = {
    id: "hero",
    type: "section",
    children: [
      {
        id: "hero-inner",
        type: "stack",
        children: [{ id: "hero-title", type: "heading", level: 1, text: "Clareza" }],
      },
    ],
  };
  const ops = buildRenderOps(node, "page");
  assert.deepEqual(
    ops.map((op) => `${op.op}:${"nodeId" in op ? op.nodeId : ""}`),
    [
      "create:hero",
      "reveal:hero",
      "create:hero-inner",
      "reveal:hero-inner",
      "create:hero-title",
      "reveal:hero-title",
      "text:hero-title",
    ],
  );
});

test("diffRenderOps emits only changed text and styles", () => {
  const before: Node = {
    id: "hero",
    type: "section",
    children: [{ id: "hero-title", type: "heading", text: "Antes", style: { color: "#111" } }],
  };
  const after: Node = {
    id: "hero",
    type: "section",
    children: [{ id: "hero-title", type: "heading", text: "Depois", style: { color: "#222" } }],
  };
  const ops = diffRenderOps(before, after);
  assert.equal(ops.some((op) => op.op === "style" && op.nodeId === "hero-title"), true);
  assert.equal(ops.some((op) => op.op === "text" && op.nodeId === "hero-title" && op.text === "Depois"), true);
  assert.equal(ops.some((op) => op.op === "create"), false);
});

test("compiled sections and page receive anchor ids", () => {
  const node: Node = {
    id: "page",
    type: "page",
    children: [
      {
        id: "hero",
        type: "section",
        children: [{ id: "hero-title", type: "heading", text: "Hero" }],
      },
    ],
  };
  const html = compilePage({ title: "Teste", plan, root: node });
  assert.match(html, /<main[^>]*id="top"/);
  assert.match(html, /<section[^>]*id="hero"/);
  assert.match(html, /scroll-margin-top:112px/);
});

test("normalizeAnchors repairs exact matches only", () => {
  const node: Node = {
    id: "page",
    type: "page",
    children: [
      {
        id: "nav",
        type: "section",
        children: [
          { id: "nav-link", type: "link", text: "Hero", href: "#inicio" },
          { id: "nav-bad", type: "link", text: "Cursos", href: "#cursos" },
        ],
      },
    ],
  };
  const fixed = normalizeAnchors(node, plan);
  const nav = fixed.children?.[0];
  assert.equal(nav?.children?.[0]?.href, "#hero");
  assert.equal(nav?.children?.[1]?.href, "#cursos");
});

test("buildRenderOps supports inserting before a sibling", () => {
  const node: Node = { id: "nova", type: "section", children: [] };
  const ops = buildRenderOps(node, "page", { beforeNodeId: "footer" });
  assert.equal(ops[0]?.op, "create");
  if (ops[0]?.op === "create") {
    assert.equal(ops[0].beforeNodeId, "footer");
    assert.equal(ops[0].attrs?.id, "nova");
  }
});

test("responsive styles compile into media queries and render ops", () => {
  const node: Node = {
    id: "hero",
    type: "section",
    responsive: {
      mobile: { padding: "40px 16px", gridTemplateColumns: "1fr" },
      tablet: { padding: "64px 24px" },
    },
    children: [{ id: "hero-title", type: "heading", text: "Claro" }],
  };
  const planWithHero: BuildPlan = {
    ...plan,
    sections: [{ ...plan.sections[0]!, id: "hero", title: "Hero" }],
  };
  const html = compilePage({ title: "t", plan: planWithHero, root: { id: "page", type: "page", children: [node] } });
  assert.match(html, /@media \(max-width:767px\)/);
  assert.match(html, /@media \(min-width:768px\) and \(max-width:1023px\)/);
  assert.match(html, /padding:40px 16px!important/);
  const ops = buildRenderOps(node, "page");
  assert.equal(ops[0]?.op, "create");
  if (ops[0]?.op === "create") assert.ok(ops[0].responsive?.mobile);
  assert.ok(responsiveCss(node).mobile);
});

test("diffRenderOps emits responsive changes", () => {
  const before: Node = { id: "hero", type: "section", responsive: { mobile: { padding: "10px" } } };
  const after: Node = { id: "hero", type: "section", responsive: { mobile: { padding: "20px" } } };
  const ops = diffRenderOps(before, after);
  assert.equal(ops.some((op) => op.op === "responsive" && op.nodeId === "hero"), true);
});
