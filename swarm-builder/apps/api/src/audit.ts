import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import type { Responsive, Style } from "@swarm/dsl";

export type AuditSeverity = "high" | "medium" | "low";
export type AuditCategory = "layout" | "a11y" | "visual" | "content" | "copy";

export type AuditPatch = {
  text?: string;
  src?: string;
  alt?: string;
  href?: string;
  style?: Style;
  responsive?: Responsive;
};

export type AuditIssue = {
  id: string;
  source: "audit" | "critic";
  nodeId?: string;
  sectionId?: string;
  severity: AuditSeverity;
  category: AuditCategory;
  message: string;
  autoFix: boolean;
  patch?: AuditPatch;
};

export type RenderNode = {
  id: string;
  sectionId?: string;
  tag: string;
  text?: string;
  alt?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  display?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
  gridTemplateColumns?: string;
  childrenCount?: number;
  fontSize?: string;
  color?: string;
  backgroundColor?: string;
  flexWrap?: string;
};

export type NavMetrics = {
  id: string;
  height: number;
  bar?: RenderNode;
  links?: RenderNode;
  actions?: RenderNode;
};

export type ViewportReport = {
  width: number;
  height: number;
  documentHeight: number;
  horizontalOverflow: boolean;
  sections: Array<{ id: string; top: number; height: number; width: number; text: string }>;
  keyNodes: RenderNode[];
  overflowing: RenderNode[];
  deadAnchors: Array<{ href: string; nodeId: string; sectionId?: string; text?: string }>;
  nav?: NavMetrics;
};

export type AuditReport = {
  available: boolean;
  warning?: string;
  desktop?: ViewportReport;
  tablet?: ViewportReport;
  mobile?: ViewportReport;
  issues: AuditIssue[];
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((value): value is string => Boolean(value));

const findChrome = (): string | null => CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;

const COLLECT_SCRIPT = String.raw`(() => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const styleOf = (el) => {
    const cs = getComputedStyle(el);
    return {
      display: cs.display,
      flexDirection: cs.flexDirection,
      flexWrap: cs.flexWrap,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      gap: cs.gap,
      gridTemplateColumns: cs.gridTemplateColumns,
      fontSize: cs.fontSize,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
    };
  };
  const nodeId = (el) => el.getAttribute("data-swarm-node") || "";
  const sectionOf = (el) =>
    (el.closest(".sw-section") && el.closest(".sw-section").getAttribute("data-swarm-node")) ||
    (el.closest("[role='navigation']") && el.closest("[role='navigation']").getAttribute("data-swarm-node")) ||
    undefined;
  const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);

  const sectionEls = Array.from(document.querySelectorAll("main.sw-page > [data-swarm-node], main > .sw-section"));
  const sections = sectionEls.map((el) => {
    const b = box(el);
    return { id: nodeId(el), top: b.y, height: b.h, width: b.w, text: text(el) };
  });

  const interesting = Array.from(document.querySelectorAll(".sw-nav [data-swarm-node], h1, h2, h3, .sw-button, .sw-link, img, .sw-section, [data-swarm-node]"));
  const seen = new Set();
  const keyNodes = [];
  for (const el of interesting) {
    if (seen.has(el)) continue;
    seen.add(el);
    const b = box(el);
    if (b.w <= 0 || b.h <= 0) continue;
    const cs = styleOf(el);
    keyNodes.push({
      id: nodeId(el),
      sectionId: sectionOf(el),
      tag: el.tagName.toLowerCase(),
      text: text(el) || undefined,
      alt: el.getAttribute("alt") || undefined,
      ...b,
      ...cs,
      childrenCount: el.children.length,
    });
    if (keyNodes.length >= 160) break;
  }

  const findSuffix = (root, suffix) =>
    Array.from(root.querySelectorAll("[data-swarm-node]")).find((el) => nodeId(el).endsWith(suffix));

  const navEl =
    document.querySelector(".sw-nav") ||
    Array.from(document.querySelectorAll("[data-swarm-node]")).find((el) => el.getAttribute("role") === "navigation") ||
    Array.from(document.querySelectorAll("[data-swarm-node]")).find((el) => nodeId(el).endsWith("nav"));
  let nav;
  if (navEl) {
    const navBox = box(navEl);
    const bar = findSuffix(navEl, "bar") || navEl.querySelector(":scope > [data-swarm-node]");
    const links = findSuffix(navEl, "links");
    const actions = findSuffix(navEl, "actions");
    const describe = (el) => {
      if (!el) return undefined;
      return {
        id: nodeId(el),
        sectionId: sectionOf(el),
        tag: el.tagName.toLowerCase(),
        text: text(el) || undefined,
        alt: el.getAttribute("alt") || undefined,
        ...box(el),
        ...styleOf(el),
        childrenCount: el.children.length,
      };
    };
    nav = { id: nodeId(navEl), height: navBox.h, bar: describe(bar), links: describe(links), actions: describe(actions) };
  }

  const overflowing = [];
  for (const el of document.querySelectorAll("[data-swarm-node]")) {
    const b = box(el);
    if (b.w <= 0 || b.h <= 0) continue;
    if (b.x + b.w > window.innerWidth + 1 || b.x < -1 || b.w > window.innerWidth + 1) {
      const cs = styleOf(el);
      overflowing.push({
        id: nodeId(el),
        sectionId: sectionOf(el),
        tag: el.tagName.toLowerCase(),
        text: text(el) || undefined,
        alt: el.getAttribute("alt") || undefined,
        ...b,
        ...cs,
      });
    }
    if (overflowing.length >= 30) break;
  }

  const deadAnchors = [];
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    const href = link.getAttribute("href") || "";
    if (href.length <= 1) continue;
    let exists = false;
    try { exists = Boolean(document.querySelector(href)); } catch (_) { exists = false; }
    if (!exists) {
      deadAnchors.push({
        href: href,
        nodeId: nodeId(link),
        sectionId: sectionOf(link),
        text: text(link) || undefined,
      });
    }
    if (deadAnchors.length >= 20) break;
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    sections,
    keyNodes,
    overflowing,
    deadAnchors,
    nav,
  };
})()`;

const collectViewport = async (page: import("playwright-core").Page, width: number, height: number): Promise<ViewportReport> => {
  await page.setViewportSize({ width, height });
  await page.evaluate("window.scrollTo(0,0)");
  return (await page.evaluate(COLLECT_SCRIPT)) as ViewportReport;
};

const isColumn = (node: RenderNode | undefined): boolean =>
  Boolean(node && /column/.test(node.flexDirection ?? "") && node.display === "flex");

const navIssues = (report: ViewportReport, prefix: string): AuditIssue[] => {
  const nav = report.nav;
  if (!nav) return [];
  const issues: AuditIssue[] = [];
  const bar = nav.bar;
  const links = nav.links;
  const actions = nav.actions;
  const base = { source: "audit" as const, category: "layout" as const, autoFix: true };

  if (nav.height > 140 || isColumn(bar)) {
    issues.push({
      ...base,
      id: `${prefix}-nav-height`,
      nodeId: bar?.id || nav.id,
      sectionId: nav.id,
      severity: "high",
      message: `Navbar is ${nav.height}px tall; it should be a single horizontal row (<=120px) on desktop.`,
      patch: bar
        ? {
            style: {
              display: "flex",
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "24px",
            },
          }
        : undefined,
    });
  }
  if (links && isColumn(links)) {
    issues.push({
      ...base,
      id: `${prefix}-nav-links`,
      nodeId: links.id,
      sectionId: nav.id,
      severity: "high",
      message: "Navbar links are stacked vertically; they should be in a horizontal row on desktop.",
      patch: { style: { display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: "24px" } },
    });
  }
  if (actions && isColumn(actions)) {
    issues.push({
      ...base,
      id: `${prefix}-nav-actions`,
      nodeId: actions.id,
      sectionId: nav.id,
      severity: "high",
      message: "Navbar actions are stacked vertically; the login link and CTA should be in a horizontal row on desktop.",
      patch: { style: { display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: "16px" } },
    });
  }
  if (bar && bar.flexWrap && /nowrap/.test(bar.flexWrap) && report.width < 900) {
    issues.push({
      ...base,
      id: `${prefix}-nav-wrap`,
      nodeId: bar.id,
      sectionId: nav.id,
      severity: "medium",
      message: "Navbar does not wrap on narrow screens and may overflow.",
      patch: { style: { flexWrap: "wrap" } },
    });
  }
  return issues;
};

const generalIssues = (report: ViewportReport, prefix: string, mobile: boolean): AuditIssue[] => {
  const issues: AuditIssue[] = [];
  if (report.horizontalOverflow) {
    issues.push({
      id: `${prefix}-overflow`,
      source: "audit",
      severity: "high",
      category: "layout",
      message: `Page has horizontal overflow at ${report.width}px.`,
      autoFix: false,
    });
  }
  for (const section of report.sections) {
    if (!section.text) {
      issues.push({
        id: `${prefix}-empty-${section.id}`,
        source: "audit",
        nodeId: section.id,
        sectionId: section.id,
        severity: "medium",
        category: "content",
        message: `Section "${section.id}" has no text content.`,
        autoFix: false,
      });
    }
    if (section.width > report.width + 1) {
      issues.push({
        id: `${prefix}-wide-${section.id}`,
        source: "audit",
        nodeId: section.id,
        sectionId: section.id,
        severity: "high",
        category: "layout",
        message: `Section "${section.id}" is ${section.width}px wide at a ${report.width}px viewport.`,
        autoFix: false,
      });
    }
  }
  for (const dead of report.deadAnchors) {
    issues.push({
      id: `${prefix}-dead-anchor-${dead.nodeId || dead.href}`,
      source: "audit",
      nodeId: dead.nodeId || undefined,
      sectionId: dead.sectionId,
      severity: "medium",
      category: "layout",
      message: `Internal link "${dead.href}" does not point to any section.`,
      autoFix: false,
    });
  }
  const seen = new Set<string>();
  for (const node of report.keyNodes) {
    if (node.tag === "img" && !node.alt && !seen.has(node.id)) {
      seen.add(node.id);
      issues.push({
        id: `${prefix}-img-alt-${node.id}`,
        source: "audit",
        nodeId: node.id,
        sectionId: node.sectionId,
        severity: "medium",
        category: "a11y",
        message: `Image "${node.id}" has no alt text.`,
        autoFix: false,
      });
    }
    if (node.tag === "a" || node.tag === "button") {
      if (!node.text && node.id && !seen.has(node.id)) {
        seen.add(node.id);
        issues.push({
          id: `${prefix}-cta-text-${node.id}`,
          source: "audit",
          nodeId: node.id,
          sectionId: node.sectionId,
          severity: "medium",
          category: "a11y",
          message: `Interactive element "${node.id}" has no visible text.`,
          autoFix: false,
        });
      }
    }
  }
  return issues;
};

const responsiveIssues = (report: ViewportReport, prefix: string, device: "mobile" | "tablet"): AuditIssue[] => {
  const issues: AuditIssue[] = [];
  const isMobile = device === "mobile";
  const minFont = 14;
  const minTap = 44;
  const patchFor = (style: Style): AuditPatch["responsive"] =>
    device === "mobile" ? { mobile: style } : { tablet: style };

  if (report.nav && device === "mobile" && report.nav.height > 320) {
    issues.push({
      id: `${prefix}-nav-tall`,
      source: "audit",
      nodeId: report.nav.bar?.id ?? report.nav.id,
      sectionId: report.nav.id,
      severity: "medium",
      category: "layout",
      message: `Navbar is ${report.nav.height}px tall on mobile; consider a compact/wrapped menu.`,
      autoFix: false,
    });
  }

  for (const node of report.keyNodes) {
    if (node.w <= 0 || node.h <= 0) continue;

    const fontSize = parseFloat(node.fontSize ?? "");
    if (isMobile && Number.isFinite(fontSize) && fontSize < minFont && ["p", "a", "button", "span", "li"].includes(node.tag)) {
      issues.push({
        id: `${prefix}-font-${node.id}`,
        source: "audit",
        nodeId: node.id,
        sectionId: node.sectionId,
        severity: "medium",
        category: "a11y",
        message: `Text in "${node.id}" is ${node.fontSize} on ${device}; minimum is ${minFont}px.`,
        autoFix: true,
        patch: { responsive: patchFor({ fontSize: `${minFont}px` }) },
      });
    }

    if (isMobile && ["a", "button"].includes(node.tag) && (node.w < minTap || node.h < minTap)) {
      const fix: Style = { display: "inline-flex", alignItems: "center" };
      if (node.h < minTap) fix.minHeight = `${minTap}px`;
      if (node.w < minTap) {
        fix.minWidth = `${minTap}px`;
        fix.justifyContent = "center";
      }
      issues.push({
        id: `${prefix}-tap-${node.id}`,
        source: "audit",
        nodeId: node.id,
        sectionId: node.sectionId,
        severity: "medium",
        category: "a11y",
        message: `Tap target "${node.id}" is ${node.w}x${node.h} on ${device}; minimum is ${minTap}x${minTap}.`,
        autoFix: true,
        patch: { responsive: patchFor(fix) },
      });
    }

    if (isMobile && node.display === "grid" && node.gridTemplateColumns && node.gridTemplateColumns !== "none") {
      const columns = node.gridTemplateColumns.trim().split(/\s+/).filter((value) => Number.parseFloat(value) > 0 || value.includes("fr"));
      if (columns.length > 1) {
        issues.push({
          id: `${prefix}-grid-${node.id}`,
          source: "audit",
          nodeId: node.id,
          sectionId: node.sectionId,
          severity: device === "mobile" ? "high" : "medium",
          category: "layout",
          message: `Grid "${node.id}" has ${columns.length} columns on ${device}; collapse to one column.`,
          autoFix: true,
          patch: { responsive: patchFor({ gridTemplateColumns: "1fr" }) },
        });
      }
    }

    if (
      node.display === "flex" &&
      /row/.test(node.flexDirection ?? "") &&
      (node.childrenCount ?? 0) >= 2 &&
      node.flexWrap !== "wrap" &&
      node.flexWrap !== "wrap-reverse" &&
      ["mobile", "tablet"].includes(device)
    ) {
      issues.push({
        id: `${prefix}-row-${node.id}`,
        source: "audit",
        nodeId: node.id,
        sectionId: node.sectionId,
        severity: "medium",
        category: "layout",
        message: `Flex row "${node.id}" does not wrap on ${device}; it may overflow.`,
        autoFix: true,
        patch: { responsive: patchFor({ flexWrap: "wrap" }) },
      });
    }

    if (node.w > report.width + 1) {
      issues.push({
        id: `${prefix}-wide-${node.id}`,
        source: "audit",
        nodeId: node.id,
        sectionId: node.sectionId,
        severity: "high",
        category: "layout",
        message: `Node "${node.id}" is ${node.w}px wide at a ${report.width}px ${device} viewport.`,
        autoFix: true,
        patch: { responsive: patchFor({ width: "100%", maxWidth: "100%" }) },
      });
    }
  }
  return issues;
};

export const auditHtml = async (html: string): Promise<AuditReport> => {
  const executablePath = findChrome();
  if (!executablePath) {
    return {
      available: false,
      warning: "Chrome/Chromium not found; deterministic render audit skipped.",
      issues: [],
    };
  }

  let browser: import("playwright-core").Browser | null = null;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 8000 });
    await page.waitForTimeout(250);
    const desktop = await collectViewport(page, 1440, 900);
    const tablet = await collectViewport(page, 768, 1024);
    const mobile = await collectViewport(page, 390, 844);

    const issues = [
      ...navIssues(desktop, "desktop"),
      ...generalIssues(desktop, "desktop", false),
      ...responsiveIssues(tablet, "tablet", "tablet"),
      ...generalIssues(tablet, "tablet", true),
      ...responsiveIssues(mobile, "mobile", "mobile"),
      ...generalIssues(mobile, "mobile", true),
    ];

    const seen = new Set<string>();
    const unique = issues.filter((issue) => {
      const key = `${issue.nodeId ?? ""}|${issue.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { available: true, desktop, tablet, mobile, issues: unique };
  } catch (error) {
    return {
      available: false,
      warning: `Render audit failed: ${error instanceof Error ? error.message : String(error)}`,
      issues: [],
    };
  } finally {
    await browser?.close().catch(() => {});
  }
};
