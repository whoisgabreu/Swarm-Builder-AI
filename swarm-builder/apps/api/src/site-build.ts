import {
  collectNodes,
  countNodes,
  compileSitePage,
  createSitePageRoot,
  fallbackSection,
  findDeadSiteLinks,
  siteLayoutPlan,
  sitePageLinks,
  sitePagePlan,
  sitePageNodeId,
  type Node,
  type SitePage,
  type SitePlan,
} from "@swarm/dsl";
import type { AgentRuntime } from "@swarm/agent-runtime";
import type { AgentInfo, BuildEvent, OwnershipEntry, SitePageView, SiteStats } from "@swarm/protocol";
import { runBuild } from "./build.js";
import type { ProjectRecord, RunRecord } from "./store.js";
import { RunChannel } from "./events.js";
import {
  pageRecordFromSpec,
  sitePageView,
  type SiteLayoutRecord,
  type SitePageRecord,
  type SiteProjectRecord,
} from "./site-store.js";

const now = () => Date.now();
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const childProject = (id: string, prompt: string, plan: SitePlan["pages"][number] | null): ProjectRecord => ({
  id,
  prompt,
  status: "idle",
  createdAt: now(),
});

const childRun = (id: string, projectId: string): RunRecord => ({
  id,
  projectId,
  status: "planning",
  startedAt: now(),
  channel: new RunChannel(),
});

const withPageId = (event: BuildEvent, pageId: string): BuildEvent =>
  ({ ...event, pageId } as BuildEvent);

const agentWithPage = (agent: AgentInfo, pageId: string): AgentInfo => ({
  ...agent,
  pageId,
});

const pageSectionsFromArtifact = (root: Node | undefined): Node[] => {
  if (!root) return [];
  return root.children ?? [];
};

const fallbackPageRoot = (page: SitePage): Node => ({
  id: sitePageNodeId(page),
  type: "page",
  children: page.sections.map((section) => fallbackSection(section)),
});

const buildLayout = async (input: {
  runtime: AgentRuntime;
  site: SiteProjectRecord;
  run: RunRecord;
  emit: (event: BuildEvent) => void;
  sitePlan: SitePlan;
}): Promise<{ layout: SiteLayoutRecord; ownership: Record<string, OwnershipEntry>; agents: AgentInfo[]; cost: number; issues: number; fixed: number }> => {
  const { runtime, site, emit, sitePlan } = input;
  const plan = siteLayoutPlan(sitePlan);
  const project = childProject(`${site.id}:layout`, site.prompt, null);
  const run = childRun(`${input.run.id}:layout`, project.id);
  let cost = 0;
  let issues = 0;
  let fixed = 0;
  const childEvents: BuildEvent[] = [];
  run.channel.subscribe((event) => childEvents.push(event));
  emit({ type: "site.layout.started", at: now() });
  try {
    await runBuild({
      runtime,
      project,
      run,
      concurrency: 2,
      prebuiltPlan: plan,
      prebuiltSessionId: site.parentSessionId,
      sitePages: sitePageLinks(sitePlan),
    });
    const root = project.artifact;
    const nav = root?.children?.find((node) => node.id === "site-nav") ?? root?.children?.[0];
    const footer = root?.children?.find((node) => node.id === "site-footer") ?? root?.children?.[1];
    const layout: SiteLayoutRecord = {
      nav: nav ?? fallbackSection(sitePlan.layout.nav),
      footer: footer ?? fallbackSection(sitePlan.layout.footer),
    };
    const ownership: Record<string, OwnershipEntry> = {};
    for (const [nodeId, entry] of Object.entries(project.ownership ?? {})) {
      ownership[nodeId] = { ...entry, pageId: "shared" };
    }
    const agents = (project.agents ?? []).map((agent) => agentWithPage(agent, "shared"));
    const done = childEvents.find((event) => event.type === "run.done");
    if (done?.type === "run.done") {
      cost = done.stats.cost;
      issues = done.stats.issues ?? 0;
      fixed = done.stats.fixed ?? 0;
    }
    emit({ type: "site.layout.done", at: now() });
    return { layout, ownership, agents, cost, issues, fixed };
  } catch (error) {
    emit({ type: "site.layout.done", at: now() });
    return {
      layout: {
        nav: fallbackSection(sitePlan.layout.nav),
        footer: fallbackSection(sitePlan.layout.footer),
      },
      ownership: {},
      agents: [],
      cost,
      issues,
      fixed,
    };
  }
};

const buildPage = async (input: {
  runtime: AgentRuntime;
  site: SiteProjectRecord;
  run: RunRecord;
  sitePlan: SitePlan;
  page: SitePage;
  layout: SiteLayoutRecord;
  emit: (event: BuildEvent) => void;
}): Promise<{ page: SitePageRecord; ownership: Record<string, OwnershipEntry>; agents: AgentInfo[]; cost: number; issues: number; fixed: number }> => {
  const { runtime, site, sitePlan, page, layout, emit } = input;
  const plan = sitePagePlan(sitePlan, page);
  const project = childProject(`${site.id}:${page.slug}`, page.description || page.title, page);
  const run = childRun(`${input.run.id}:${page.slug}`, project.id);
  const childEvents: BuildEvent[] = [];
  run.channel.subscribe((event) => {
    childEvents.push(event);
    if (event.type === "run.done" || event.type === "run.started" || event.type === "plan.ready" || event.type === "plan.updated") return;
    if (event.type === "ownership.updated") return;
    if (event.type === "agent.spawned") {
      emit({ ...event, agent: agentWithPage(event.agent, page.slug) });
      return;
    }
    emit(withPageId(event, page.slug));
  });
  emit({ type: "site.page.started", pageId: page.slug, at: now() });
  let cost = 0;
  let issues = 0;
  let fixed = 0;
  let childError: string | undefined;
  try {
    await runBuild({
      runtime,
      project,
      run,
      concurrency: 3,
      prebuiltPlan: plan,
      prebuiltSessionId: site.parentSessionId,
      sitePages: sitePageLinks(sitePlan),
    });
    if (run.status === "failed") childError = project.error;
  } catch (error) {
    childError = errorMessage(error);
  }
  const pageRoot = project.artifact
    ? { ...project.artifact, id: sitePageNodeId(page) }
    : fallbackPageRoot(page);
  const sections = pageSectionsFromArtifact(pageRoot);
  const root = createSitePageRoot({
    page,
    nav: layout.nav ?? fallbackSection(sitePlan.layout.nav),
    footer: layout.footer ?? fallbackSection(sitePlan.layout.footer),
    sections,
  });
  const done = childEvents.find((event) => event.type === "run.done");
  if (done?.type === "run.done") {
    cost = done.stats.cost;
    issues = done.stats.issues ?? 0;
    fixed = done.stats.fixed ?? 0;
  }
  const ownership: Record<string, OwnershipEntry> = {};
  for (const [nodeId, entry] of Object.entries(project.ownership ?? {})) {
    ownership[nodeId] = { ...entry, pageId: page.slug };
  }
  const agents = (project.agents ?? []).map((agent) => agentWithPage(agent, page.slug));
  const html = compileSitePage({ site: sitePlan, page, root, mode: "preview" });
  const record: SitePageRecord = {
    ...pageRecordFromSpec(page),
    status: childError ? "failed" : "done",
    artifact: root,
    html,
    nodes: countNodes(root),
    cost,
    fallbacks: done?.type === "run.done" ? done.stats.fallbacks ?? 0 : 0,
    error: childError,
  };
  return { page: record, ownership, agents, cost, issues, fixed };
};

export const runSiteBuild = async (input: {
  runtime: AgentRuntime;
  site: SiteProjectRecord;
  run: RunRecord;
  concurrency?: number;
}): Promise<void> => {
  const { runtime, site, run } = input;
  const emit = run.channel.emit.bind(run.channel);
  const started = now();
  site.status = "planning";
  run.status = "planning";
  site.cost = site.planningCost;
  site.error = undefined;
  emit({ type: "site.plan.ready", plan: site.plan!, agents: [], at: now() });

  try {
    const sitePlan = site.plan!;
    site.status = "building";
    run.status = "building";
    const layoutResult = await buildLayout({ runtime, site, run, emit, sitePlan });
    site.layout = layoutResult.layout;
    site.ownership = { ...layoutResult.ownership };
    site.agents = [...layoutResult.agents];
    site.cost += layoutResult.cost;
    emit({ type: "ownership.updated", ownership: site.ownership, at: now() });
    let totalIssues = layoutResult.issues;
    let totalFixed = layoutResult.fixed;
    let totalFallbacks = 0;
    let totalSections = 0;

    site.pages = [];
    for (const page of sitePlan.pages) {
      const result = await buildPage({
        runtime,
        site,
        run,
        sitePlan,
        page,
        layout: layoutResult.layout,
        emit,
      });
      site.pages.push(result.page);
      site.ownership = { ...site.ownership, ...result.ownership };
      emit({ type: "ownership.updated", ownership: site.ownership, at: now() });
      const existing: Set<string> = new Set((site.agents ?? []).map((agent) => agent.id));
      site.agents = [...(site.agents ?? []), ...result.agents.filter((agent) => !existing.has(agent.id))];
      site.cost += result.cost;
      totalIssues += result.issues;
      totalFixed += result.fixed;
      totalFallbacks += result.page.fallbacks;
      totalSections += page.sections.length;
      emit({ type: "site.page.done", page: sitePageView(result.page), at: now() });
    }

    const deadLinks = site.pages.flatMap((page) =>
      page.artifact ? findDeadSiteLinks(sitePlan, page.slug, page.artifact) : [],
    );
    const uniqueDeadLinks = new Map(deadLinks.map((link) => [`${link.nodeId}|${link.href}`, link]));
    totalIssues += uniqueDeadLinks.size;
    site.cost = Math.round(site.cost * 10000) / 10000;
    const stats: SiteStats = {
      pages: site.pages.length,
      sections: totalSections,
      nodes: site.pages.reduce((sum, page) => sum + page.nodes, 0),
      cost: site.cost,
      durationMs: now() - started,
      fallbacks: totalFallbacks,
      issues: totalIssues,
      fixed: totalFixed,
      model: runtime.name,
    };
    site.stats = stats;
    site.status = "done";
    run.status = "done";
    run.finishedAt = now();
    emit({ type: "ownership.updated", ownership: site.ownership ?? {}, at: now() });
    emit({ type: "site.done", pages: site.pages.map(sitePageView), stats, at: now() });
  } catch (error) {
    const message = errorMessage(error);
    site.status = "failed";
    site.error = message;
    run.status = "failed";
    run.finishedAt = now();
    emit({ type: "run.failed", message, at: now() });
  }
};
