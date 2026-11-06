import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { collectNodes, normalizeSitePlan } from "@swarm/dsl";
import { createMockRuntime } from "@swarm/agent-runtime";
import { runSiteBuild } from "./site-build.js";
import { buildSiteZip } from "./site-export.js";
import { runSiteRevision, undoSite } from "./site-revise.js";
import { pageRecordFromSpec, type SiteProjectRecord } from "./site-store.js";
import { RunChannel } from "./events.js";
import type { RunRecord } from "./store.js";

const makeSite = async (): Promise<SiteProjectRecord> => {
  const runtime = createMockRuntime();
  const planned = await runtime.planSite({ brief: "Site institucional de teste." });
  const plan = normalizeSitePlan({ ...planned.plan, pages: planned.plan.pages.slice(0, 2) });
  return {
    id: "site-1",
    prompt: "Site institucional de teste.",
    status: "idle",
    createdAt: Date.now(),
    plan,
    planningCost: 0,
    pages: plan.pages.map(pageRecordFromSpec),
    layout: {},
    agents: [],
    ownership: {},
    cost: 0,
  };
};

const makeRun = (): RunRecord => ({
  id: "site-run-1",
  projectId: "site-1",
  status: "planning",
  startedAt: Date.now(),
  channel: new RunChannel(),
});

test("site build creates shared layout, page ownership and static export links", async () => {
  const site = await makeSite();
  const run = makeRun();
  await runSiteBuild({ runtime: createMockRuntime(), site, run });
  assert.equal(site.status, "done");
  assert.equal(run.status, "done");
  assert.equal(site.pages.length, 2);
  assert.ok(site.pages.every((page) => page.status === "done"));
  assert.ok(site.pages.every((page) => page.html?.includes("site-nav")));
  assert.ok(site.pages.every((page) => page.html?.includes("site-footer")));
  assert.ok(site.pages.every((page) => page.artifact?.children?.some((node) => node.id === "site-nav")));
  assert.ok(Object.values(site.ownership ?? {}).some((entry) => entry.pageId === "home"));
  assert.ok(Object.values(site.ownership ?? {}).some((entry) => entry.pageId === "sobre"));
  assert.ok(Object.values(site.ownership ?? {}).some((entry) => entry.pageId === "shared"));
  assert.equal(site.stats?.pages, 2);
  assert.equal(site.stats?.sections, 5);
  assert.ok((site.stats?.nodes ?? 0) > 0);

  const archive = await buildSiteZip(site);
  const zip = await JSZip.loadAsync(archive);
  assert.deepEqual(Object.keys(zip.files).sort(), ["index.html", "sobre.html"]);
  const index = await zip.file("index.html")!.async("string");
  assert.match(index, /href="sobre.html"/);
  assert.match(index, /data-swarm-node="page-home"/);
});

test("shared layout revision updates every page", async () => {
  const site = await makeSite();
  await runSiteBuild({ runtime: createMockRuntime(), site, run: makeRun() });
  const link = collectNodes(site.layout!.nav!).find((node) => node.type === "link");
  assert.ok(link?.text);
  const revisionRun: RunRecord = { ...makeRun(), id: "site-layout-revision", status: "reviewing" };
  await runSiteRevision({
    runtime: createMockRuntime(),
    site,
    run: revisionRun,
    pageId: "shared",
    request: "Ajuste o texto do link.",
    target: { nodeId: link!.id },
  });
  assert.equal(revisionRun.status, "done");
  assert.ok(site.pages.every((page) => page.html?.includes("revisado")));
});

test("site revision updates one page and undo restores its html", async () => {
  const site = await makeSite();
  await runSiteBuild({ runtime: createMockRuntime(), site, run: makeRun() });
  const page = site.pages[0]!;
  const node = collectNodes(page.artifact!).find((item) => item.type === "heading");
  assert.ok(node?.text);
  const before = page.html;
  const revisionRun: RunRecord = { ...makeRun(), id: "site-revision-1", status: "reviewing" };
  await runSiteRevision({
    runtime: createMockRuntime(),
    site,
    run: revisionRun,
    pageId: "home",
    request: "Deixe o título mais direto.",
    target: { nodeId: node!.id },
  });
  assert.equal(revisionRun.status, "done");
  assert.match(page.html ?? "", /revisado/);
  assert.notEqual(page.html, before);
  const restored = undoSite(site);
  assert.ok(restored);
  assert.equal(site.pages[0]?.html, before);
});
