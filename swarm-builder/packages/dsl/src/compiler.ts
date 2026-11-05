import { normalizeStyle, normalizeTheme } from "./normalize.js";
import type { BuildPlan, Node, Style, Theme } from "./schema.js";

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ESC[c] ?? c);

const safeUrl = (value: string | undefined, fallback = "#"): string => {
  if (!value) return fallback;
  const url = value.trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url) || /^tel:/i.test(url)) return url;
  if (url.startsWith("#") || url.startsWith("/")) return url;
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);/i.test(url)) return url;
  return fallback;
};

const safeImage = (value: string | undefined): string | null => {
  if (!value) return null;
  const url = value.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);/i.test(url)) return url;
  return null;
};

const kebab = (value: string): string =>
  value.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const styleToString = (style: Style | undefined): string => {
  const safe = normalizeStyle(style);
  if (!safe) return "";
  return Object.entries(safe)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${kebab(key)}:${String(value)}`)
    .join(";");
};

const mergeStyle = (defaults: Style, style: Style | undefined): string => {
  const merged: Style = { ...defaults, ...(normalizeStyle(style) ?? {}) };
  return styleToString(merged);
};

const attrs = (node: Node): string => {
  const out: string[] = [`data-swarm-node="${escapeHtml(node.id)}"`];
  if (node.type === "section") out.push(`id="${escapeHtml(node.id)}"`);
  if (node.type === "page") out.push('id="top"');
  if (node.a11y?.role) out.push(`role="${escapeHtml(node.a11y.role)}"`);
  if (node.a11y?.label) out.push(`aria-label="${escapeHtml(node.a11y.label)}"`);
  return out.length ? ` ${out.join(" ")}` : "";
};

const prop = (node: Node, key: string): string | number | boolean | undefined => node.props?.[key];

const tokenStyle = (theme: Theme): string => {
  const safe = normalizeTheme(theme);
  const c = safe.colors;
  const fonts = safe.fonts ?? {
    body: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
    display: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  };
  return `
:root{
  --sw-background:${c.background};
  --sw-surface:${c.surface};
  --sw-text:${c.text};
  --sw-muted:${c.muted};
  --sw-primary:${c.primary};
  --sw-primary-text:${c.primaryText};
  --sw-primaryText:${c.primaryText};
  --sw-accent:${c.accent};
  --sw-border:${c.border};
  --sw-font-body:${fonts.body};
  --sw-font-display:${fonts.display};
  --sw-radius:${safe.radius ?? "16px"};
  --sw-spacing:${safe.spacing ?? "24px"};
}`;
};

const BASE_CSS = `
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--sw-background);color:var(--sw-text);font-family:var(--sw-font-body);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img{display:block;max-width:100%}
a{color:inherit}
.sw-section{position:relative;width:100%;padding:88px 24px;scroll-margin-top:112px}
@media(max-width:760px){.sw-section{scroll-margin-top:136px}}
.sw-inner{width:100%;max-width:1120px;margin:0 auto}
.sw-heading{font-family:var(--sw-font-display);line-height:1.08;letter-spacing:-0.03em;margin:0}
.sw-text{margin:0;line-height:1.65;color:var(--sw-muted)}
.sw-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 22px;border-radius:var(--sw-radius);background:var(--sw-primary);color:var(--sw-primary-text);font-weight:650;text-decoration:none;border:1px solid transparent;cursor:pointer;transition:transform .18s ease,opacity .18s ease}
.sw-button:hover{transform:translateY(-1px);opacity:.92}
.sw-image{width:100%;border-radius:var(--sw-radius);object-fit:cover}
.sw-img-placeholder{width:100%;min-height:260px;border-radius:var(--sw-radius);background:linear-gradient(135deg,var(--sw-surface),var(--sw-border));display:flex;align-items:center;justify-content:center;color:var(--sw-muted);font-size:14px;text-align:center;padding:24px}
.sw-input{width:100%;padding:13px 15px;border-radius:var(--sw-radius);border:1px solid var(--sw-border);background:var(--sw-surface);color:var(--sw-text);font:inherit;outline:none}
.sw-input:focus{border-color:var(--sw-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--sw-primary) 22%,transparent)}
.sw-list{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.sw-list-item{display:flex;gap:10px;align-items:flex-start;line-height:1.55}
.sw-icon{display:inline-flex;align-items:center;justify-content:center}
.sw-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;border:1px solid var(--sw-border);color:var(--sw-muted);font-size:13px;font-weight:560}
`;

const sectionCss = (plan: BuildPlan): string => {
  const kinds = new Set(plan.sections.map((s) => s.kind));
  const extra: string[] = [];
  if (kinds.has("hero")) {
    extra.push(`.sw-hero{min-height:min(760px,92vh);display:flex;align-items:center;padding-top:120px;padding-bottom:120px}`);
  }
  if (kinds.has("nav")) {
    extra.push(`.sw-nav{padding:18px 24px}.sw-nav .sw-inner{display:flex;align-items:center;justify-content:space-between;gap:20px}`);
  }
  if (kinds.has("footer")) {
    extra.push(`.sw-footer{padding:52px 24px;border-top:1px solid var(--sw-border);color:var(--sw-muted);font-size:14px}`);
  }
  return extra.join("\n");
};

const defaultsFor = (node: Node): Style => {
  switch (node.type) {
    case "page":
      return { width: "100%" };
    case "section":
      return { position: "relative", width: "100%" };
    case "stack":
      return { display: "flex", flexDirection: "column", gap: "16px" };
    case "grid":
      return {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
        gap: "24px",
      };
    case "text":
      return { margin: "0", lineHeight: "1.65", color: "var(--sw-muted)" };
    case "heading":
      return {
        margin: "0",
        fontFamily: "var(--sw-font-display)",
        lineHeight: "1.08",
        letterSpacing: "-0.03em",
      };
    case "image":
      return {
        width: "100%",
        borderRadius: "var(--sw-radius)",
        objectFit: "cover",
        background: "linear-gradient(135deg,var(--sw-surface),var(--sw-border))",
      };
    case "button":
      return {};
    case "link":
      return { color: "var(--sw-muted)", textDecoration: "none" };
    case "list":
      return { display: "grid", gap: "12px" };
    case "listItem":
      return { display: "flex", gap: "10px", alignItems: "flex-start" };
    case "spacer":
      return { height: "24px" };
    case "icon":
      return { display: "inline-flex", alignItems: "center", justifyContent: "center" };
    default:
      return {};
  }
};

const renderChildren = (node: Node): string =>
  (node.children ?? []).map((child) => renderNode(child)).join("");

const renderNode = (node: Node): string => {
  const inner = renderChildren(node);
  const style = mergeStyle(defaultsFor(node), node.style);
  const styleAttr = style ? ` style="${escapeHtml(style)}"` : "";
  const common = `${attrs(node)}${styleAttr}`;

  switch (node.type) {
    case "page":
      return `<main class="sw-page"${common}>${inner}</main>`;
    case "section": {
      const kind = String(prop(node, "kind") ?? "");
      const klass = `sw-section${kind ? ` sw-${kind}` : ""}`;
      return `<section class="${klass}"${common}>${inner}</section>`;
    }
    case "stack":
      return `<div class="sw-stack"${common}>${inner}</div>`;
    case "grid":
      return `<div class="sw-grid"${common}>${inner}</div>`;
    case "text":
      return `<p class="sw-text"${common}>${escapeHtml(node.text ?? "")}</p>`;
    case "heading": {
      const level = Math.min(6, Math.max(1, node.level ?? 2));
      return `<h${level} class="sw-heading"${common}>${escapeHtml(node.text ?? "")}</h${level}>`;
    }
    case "image": {
      const src = safeImage(node.src);
      if (!src) {
        return `<div class="sw-img-placeholder"${common}>${escapeHtml(node.alt ?? "Imagem")}</div>`;
      }
      return `<img class="sw-image" src="${escapeHtml(src)}" alt="${escapeHtml(node.alt ?? "")}" loading="lazy" decoding="async" referrerpolicy="no-referrer"${common}>`;
    }
    case "button":
      return `<a class="sw-button" href="${escapeHtml(safeUrl(node.href))}"${node.target ? ` target="${node.target}"` : ""}${common}>${escapeHtml(node.text ?? "Começar")}</a>`;
    case "link":
      return `<a class="sw-link" href="${escapeHtml(safeUrl(node.href))}"${node.target ? ` target="${node.target}"` : ""}${common}>${escapeHtml(node.text ?? "")}</a>`;
    case "input": {
      const type = String(prop(node, "type") ?? "text");
      const placeholder = String(prop(node, "placeholder") ?? "");
      const name = String(prop(node, "name") ?? node.id);
      return `<input class="sw-input" type="${escapeHtml(type)}" name="${escapeHtml(name)}" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(node.a11y?.label ?? placeholder)}"${common}>`;
    }
    case "list":
      return `<ul class="sw-list"${common}>${inner}</ul>`;
    case "listItem":
      return `<li class="sw-list-item"${common}>${inner || escapeHtml(node.text ?? "")}</li>`;
    case "spacer":
      return `<div class="sw-spacer"${common}></div>`;
    case "icon":
      return `<span class="sw-icon" aria-hidden="true"${common}>${escapeHtml(node.text ?? "")}</span>`;
    default:
      return `<div${common}>${inner}</div>`;
  }
};

export type RenderOp =
  | {
      op: "create";
      nodeId: string;
      parentId?: string;
      beforeNodeId?: string;
      tag: string;
      className?: string;
      style?: string;
      attrs?: Record<string, string>;
      responsive?: { mobile?: string; tablet?: string };
    }
  | { op: "text"; nodeId: string; text: string; mode: "type" | "set" }
  | { op: "media"; nodeId: string; src: string; alt?: string; objectFit?: string }
  | { op: "style"; nodeId: string; style: string }
  | { op: "responsive"; nodeId: string; responsive: { mobile?: string; tablet?: string } }
  | { op: "reveal"; nodeId: string }
  | { op: "remove"; nodeId: string };

const importantStyle = (style: Style | undefined): string => {
  const safe = normalizeStyle(style);
  if (!safe) return "";
  return Object.entries(safe)
    .map(([key, value]) => `${kebab(key)}:${String(value)}!important;`)
    .join("");
};

export const responsiveCss = (node: Node): { mobile?: string; tablet?: string } => {
  const responsive = node.responsive;
  if (!responsive) return {};
  const out: { mobile?: string; tablet?: string } = {};
  const mobile = importantStyle(responsive.mobile);
  const tablet = importantStyle(responsive.tablet);
  if (mobile) out.mobile = mobile;
  if (tablet) out.tablet = tablet;
  if (responsive.hide?.includes("mobile")) out.mobile = (out.mobile ?? "") + "display:none!important;";
  if (responsive.hide?.includes("tablet")) out.tablet = (out.tablet ?? "") + "display:none!important;";
  return out;
};

const collectResponsiveRules = (root: Node): { mobile: string[]; tablet: string[] } => {
  const rules = { mobile: [] as string[], tablet: [] as string[] };
  const walk = (node: Node) => {
    const css = responsiveCss(node);
    if (css.mobile) rules.mobile.push(`[data-swarm-node="${node.id}"]{${css.mobile}}`);
    if (css.tablet) rules.tablet.push(`[data-swarm-node="${node.id}"]{${css.tablet}}`);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return rules;
};

export type NodeShell = {
  tag: string;
  className?: string;
  style?: string;
  attrs: Record<string, string>;
};

const nodeAttrs = (node: Node): Record<string, string> => {
  const out: Record<string, string> = { "data-swarm-node": node.id };
  if (node.type === "section") out.id = node.id;
  if (node.type === "page") out.id = "top";
  if (node.a11y?.role) out.role = node.a11y.role;
  if (node.a11y?.label) out["aria-label"] = node.a11y.label;
  return out;
};

export const nodeShell = (node: Node): NodeShell => {
  const style = mergeStyle(defaultsFor(node), node.style);
  const attrs = nodeAttrs(node);
  switch (node.type) {
    case "page":
      return { tag: "main", className: "sw-page", style, attrs };
    case "section": {
      const kind = String(prop(node, "kind") ?? "");
      return { tag: "section", className: `sw-section${kind ? ` sw-${kind}` : ""}`, style, attrs };
    }
    case "stack":
      return { tag: "div", className: "sw-stack", style, attrs };
    case "grid":
      return { tag: "div", className: "sw-grid", style, attrs };
    case "text":
      return { tag: "p", className: "sw-text", style, attrs };
    case "heading":
      return { tag: `h${Math.min(6, Math.max(1, node.level ?? 2))}`, className: "sw-heading", style, attrs };
    case "image": {
      const src = safeImage(node.src);
      if (!src) return { tag: "div", className: "sw-img-placeholder", style, attrs };
      attrs.alt = node.alt ?? "";
      attrs.loading = "lazy";
      attrs.decoding = "async";
      attrs.referrerpolicy = "no-referrer";
      return { tag: "img", className: "sw-image", style, attrs };
    }
    case "button":
      attrs.href = safeUrl(node.href);
      if (node.target) attrs.target = node.target;
      return { tag: "a", className: "sw-button", style, attrs };
    case "link":
      attrs.href = safeUrl(node.href);
      if (node.target) attrs.target = node.target;
      return { tag: "a", className: "sw-link", style, attrs };
    case "input": {
      attrs.type = String(prop(node, "type") ?? "text");
      attrs.name = String(prop(node, "name") ?? node.id);
      attrs.placeholder = String(prop(node, "placeholder") ?? "");
      attrs["aria-label"] = node.a11y?.label ?? attrs.placeholder;
      return { tag: "input", className: "sw-input", style, attrs };
    }
    case "list":
      return { tag: "ul", className: "sw-list", style, attrs };
    case "listItem":
      return { tag: "li", className: "sw-list-item", style, attrs };
    case "spacer":
      return { tag: "div", className: "sw-spacer", style, attrs };
    case "icon":
      return { tag: "span", className: "sw-icon", style, attrs };
    default:
      return { tag: "div", style, attrs };
  }
};

export const buildRenderOps = (node: Node, parentId?: string, options?: { beforeNodeId?: string }): RenderOp[] => {
  const ops: RenderOp[] = [];
  const walk = (current: Node, parent?: string, beforeNodeId?: string) => {
    const shell = nodeShell(current);
    ops.push({
      op: "create",
      nodeId: current.id,
      parentId: parent,
      beforeNodeId,
      tag: shell.tag,
      className: shell.className,
      style: shell.style,
      attrs: shell.attrs,
      responsive: responsiveCss(current),
    });
    ops.push({ op: "reveal", nodeId: current.id });

    if (current.type === "image") {
      const src = safeImage(current.src);
      if (src) {
        ops.push({
          op: "media",
          nodeId: current.id,
          src,
          alt: current.alt,
          objectFit: current.style?.objectFit,
        });
      }
      return;
    }

    if (current.text != null && current.text !== "") {
      ops.push({ op: "text", nodeId: current.id, text: current.text, mode: "type" });
    }
    for (const child of current.children ?? []) walk(child, current.id);
  };
  walk(node, parentId, options?.beforeNodeId);
  return ops;
};

const sameStyle = (a: Node, b: Node): boolean => nodeShell(a).style === nodeShell(b).style;

export const diffRenderOps = (prev: Node, next: Node, mode: "type" | "set" = "type"): RenderOp[] => {
  const ops: RenderOp[] = [];
  const prevById = new Map<string, Node>();
  const index = (node: Node) => {
    prevById.set(node.id, node);
    for (const child of node.children ?? []) index(child);
  };
  index(prev);

  const walk = (current: Node, parentId?: string) => {
    const before = prevById.get(current.id);
    if (!before) {
      ops.push(...buildRenderOps(current, parentId));
      return;
    }
    if (!sameStyle(before, current)) {
      ops.push({ op: "style", nodeId: current.id, style: nodeShell(current).style ?? "" });
    }
    if (JSON.stringify(before.responsive ?? null) !== JSON.stringify(current.responsive ?? null)) {
      ops.push({ op: "responsive", nodeId: current.id, responsive: responsiveCss(current) });
    }
    if (current.text != null && before.text !== current.text && !(current.children?.length)) {
      ops.push({ op: "text", nodeId: current.id, text: current.text, mode });
    }
    if (current.type === "image" && (before.src !== current.src || before.alt !== current.alt)) {
      const src = safeImage(current.src);
      if (src) ops.push({ op: "media", nodeId: current.id, src, alt: current.alt, objectFit: current.style?.objectFit });
    }
    const nextIds = new Set((current.children ?? []).map((child) => child.id));
    for (const child of before.children ?? []) {
      if (!nextIds.has(child.id)) ops.push({ op: "remove", nodeId: child.id });
    }
    const prevIds = new Set((before.children ?? []).map((child) => child.id));
    for (const child of current.children ?? []) {
      if (!prevIds.has(child.id)) ops.push(...buildRenderOps(child, current.id));
      else walk(child, current.id);
    }
  };
  walk(next, undefined);
  return ops;
};

const normText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const normalizeAnchors = (root: Node, plan: BuildPlan): Node => {
  const anchors = new Set(["top", ...plan.sections.map((section) => section.id)]);
  const candidates = plan.sections.map((section) => ({
    id: section.id,
    keys: [normText(section.id), normText(section.title), normText(section.kind)],
  }));
  const next = structuredClone(root);
  const walk = (node: Node) => {
    if ((node.type === "link" || node.type === "button") && node.href?.startsWith("#") && node.href.length > 1) {
      const target = node.href.slice(1);
      if (!anchors.has(target)) {
        const text = normText(node.text ?? "");
        const matches = candidates.filter((candidate) => candidate.keys.includes(text));
        if (matches.length === 1) node.href = `#${matches[0]!.id}`;
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(next);
  return next;
};

export type CompileInput = {
  title: string;
  description?: string;
  plan: BuildPlan;
  root: Node;
};

export const compilePage = ({ title, description, plan, root }: CompileInput): string => {
  const safeRoot = normalizeAnchors(root, plan);
  const html = renderNode(safeRoot);
  const rules = collectResponsiveRules(safeRoot);
  const responsiveCssText =
    (rules.mobile.length ? `@media (max-width:767px){${rules.mobile.join("")}}` : "") +
    (rules.tablet.length ? `@media (min-width:768px) and (max-width:1023px){${rules.tablet.join("")}}` : "");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${escapeHtml(description ?? plan.tagline)}">
<title>${escapeHtml(title)}</title>
<style>${tokenStyle(plan.theme)}
${BASE_CSS}
${sectionCss(plan)}
${responsiveCssText}
</style>
</head>
<body>
${html}
</body>
</html>`;
};
