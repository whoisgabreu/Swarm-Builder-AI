import {
  collectNodes,
  compileSitePage,
  countNodes,
  createSitePageRoot,
  fallbackSection,
  siteLayoutPlan,
  sitePagePlan,
  sitePageNodeId,
  type Node,
  type SitePage,
  type SitePlan,
} from "@swarm/dsl";
import type { AgentRuntime } from "@swarm/agent-runtime";
import type { AgentInfo, BuildEvent, OwnershipEntry, SitePageView } from "@swarm/protocol";
import { runRevision, expandSelection, type RevisionTarget } from "./revise.js";
import { runSectionAddition } from "./add-section.js";
import { RunChannel } from "./events.js";
import type { ProjectRecord, RunRecord } from "./store.js";
import {
  sitePageView,
  type SiteLayoutRecord,
  type SitePageRecord,
  type SiteProjectRecord,
  type SiteSnapshot,
} from "./site-store.js";

const now = () => Date.now();
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const pageFor = (site: SiteProjectRecord, pageId: string): SitePage | undefined =>
  site.plan?.pages.find((page) => page.slug === pageId);

const pageRecord = (site: SiteProjectRecord, pageId: string): SitePageRecord | undefined =>
  site.pages.find((page) => page.slug === pageId);

const pageOnlyArtifact = (page: SitePageRecord): Node | undefined => {
  if (!page.artifact) return undefined;
  const children = (page.artifact.children ?? []).filter(
    (child) => child.id !== "site-nav" && child.id !== "site-footer",
  );
  return { ...page.artifact, id: sitePageNodeId({ slug: page.slug } as SitePage), children };
};

const layoutArtifact = (site: SiteProjectRecord): Node => ({
  id: "site-layout",
  type: "page",
  children: [
    site.layout?.nav ?? fallbackSection(site.plan!.layout.nav),
    site.layout?.footer ?? fallbackSection(site.plan!.layout.footer),
  ],
});

const childProject = (id: string, prompt: string): ProjectRecord => ({
  id,
  prompt,
  status: "idle",
  createdAt: now(),
});

const childRun = (id: string, projectId: string): RunRecord => ({
  id,
  projectId,
  status: "reviewing",
  startedAt: now(),
  channel: new RunChannel(),
});

const ownershipFor = (site: SiteProjectRecord, pageId: string): Record<string, OwnershipEntry> =>
  Object.fromEntries(
    Object.entries(site.ownership ?? {}).filter(([, entry]) => entry.pageId === pageId),
  );

const agentsFor = (site: SiteProjectRecord, pageId: string): AgentInfo[] =>
  (site.agents ?? []).filter((agent) => agent.pageId === pageId);

const mergeOwnership = (
  site: SiteProjectRecord,
  pageId: string,
  next: Record<string, OwnershipEntry>,
): Record<string, OwnershipEntry> => {
  const merged = Object.fromEntries(
    Object.entries(site.ownership ?? {}).filter(([, entry]) => entry.pageId !== pageId),
  );
  for (const [nodeId, entry] of Object.entries(next)) merged[nodeId] = { ...entry, pageId };
  return merged;
};

const mergeAgents = (site: SiteProjectRecord, incoming: AgentInfo[]): AgentInfo[] => {
  const next = [...(site.agents ?? [])];
  for (const agent of incoming) {
    const index = next.findIndex((item) => item.id === agent.id);
    if (index >= 0) next[index] = agent;
    else next.push(agent);
  }
  return next;
};

const recompilePage = (site: SiteProjectRecord, page: SitePageRecord): void => {
  if (!site.plan) return;
  const spec = pageFor(site, page.slug);
  if (!spec) return;
  const sections = pageOnlyArtifact(page)?.children ?? [];
  const root = createSitePageRoot({
    page: spec,
    nav: site.layout?.nav ?? fallbackSection(site.plan.layout.nav),
    footer: site.layout?.footer ?? fallbackSection(site.plan.layout.footer),
    sections,
  });
  page.artifact = root;
  page.html = compileSitePage({ site: site.plan, page: spec, root, mode: "preview" });
  page.nodes = countNodes(root);
  page.sections = spec.sections.length;
};

const recompileAllPages = (site: SiteProjectRecord): void => {
  for (const page of site.pages) recompilePage(site, page);
};

const recomputeStats = (site: SiteProjectRecord): void => {
  if (!site.stats) return;
  site.stats = {
    ...site.stats,
    pages: site.pages.length,
    sections: site.plan?.pages.reduce((sum, page) => sum + page.sections.length, 0) ?? 0,
    nodes: site.pages.reduce((sum, page) => sum + page.nodes, 0),
    cost: site.cost,
    fallbacks: site.pages.reduce((sum, page) => sum + page.fallbacks, 0),
  };
};

const snapshot = (site: SiteProjectRecord): SiteSnapshot => ({
  plan: structuredClone(site.plan!),
  layout: structuredClone(site.layout ?? {}),
  pages: structuredClone(site.pages),
  agents: structuredClone(site.agents ?? []),
  ownership: structuredClone(site.ownership ?? {}),
  at: now(),
});

const pushSnapshot = (site: SiteProjectRecord): void => {
  if (!site.plan) return;
  site.undoStack = [...(site.undoStack ?? []).slice(-19), snapshot(site)];
};

const withPageId = (event: BuildEvent, pageId: string): BuildEvent =>
  ({ ...event, pageId } as BuildEvent);

export const runSiteRevision = async (input: {
  runtime: AgentRuntime;
  site: SiteProjectRecord;
  run: RunRecord;
  pageId: string;
  request: string;
  target: RevisionTarget;
}): Promise<void> => {
  const { runtime, site, run, pageId, request, target } = input;
  const emit = run.channel.emit.bind(run.channel);
  const shared = pageId === "shared";
  const page = shared ? undefined : pageRecord(site, pageId);
  const plan = site.plan;
  if (!plan || (!shared && (!page || !page.artifact))) {
    site.status = "done";
    run.status = "failed";
    run.finishedAt = now();
    emit({ type: "revision.done", revisionId: run.id, success: false, summary: "Página sem artefato para editar.", cost: 0, totalCost: site.cost, pageId, at: now() });
    return;
  }

  const previous = snapshot(site);
  const child = shared
    ? childProject(`${site.id}:shared`, site.prompt)
    : childProject(`${site.id}:${pageId}`, page!.description || page!.title);
  child.plan = shared ? siteLayoutPlan(plan) : sitePagePlan(plan, pageFor(site, pageId)!);
  child.artifact = shared ? layoutArtifact(site) : pageOnlyArtifact(page!)!;
  child.ownership = ownershipFor(site, pageId);
  child.agents = agentsFor(site, pageId);
  child.parentSessionId = site.parentSessionId;
  const childRunRecord = childRun(`${run.id}:${pageId}`, child.id);
  let revisionDone: BuildEvent | undefined;
  childRunRecord.channel.subscribe((event) => {
    if (event.type === "revision.done") {
      revisionDone = event;
      return;
    }
    if (event.type === "preview.sync" || event.type === "preview.updated") return;
    if (event.type === "run.failed") return;
    emit(withPageId(event, pageId));
  });

  try {
    await runRevision({
      runtime,
      project: child,
      run: childRunRecord,
      request,
      target,
      parentSessionId: site.parentSessionId,
    });
    const cost = revisionDone?.type === "revision.done" ? revisionDone.cost : 0;
    const success = revisionDone?.type === "revision.done" ? revisionDone.success : false;
    if (success) {
      site.undoStack = [...(site.undoStack ?? []).slice(-19), previous];
      site.cost = Math.round((site.cost + cost) * 10000) / 10000;
      if (shared) {
        site.layout = {
          nav: child.artifact?.children?.[0] ?? site.layout?.nav,
          footer: child.artifact?.children?.[1] ?? site.layout?.footer,
        };
        site.ownership = mergeOwnership(site, "shared", child.ownership ?? {});
        site.agents = mergeAgents(site, (child.agents ?? []).map((agent) => ({ ...agent, pageId: "shared" })));
        recompileAllPages(site);
        for (const item of site.pages) {
          emit({ type: "preview.sync", html: item.html!, pageId: item.slug, force: true, at: now() });
        }
      } else {
        page!.artifact = child.artifact;
        page!.cost = Math.round((page!.cost + cost) * 10000) / 10000;
        page!.status = "done";
        site.ownership = mergeOwnership(site, pageId, child.ownership ?? {});
        site.agents = mergeAgents(site, (child.agents ?? []).map((agent) => ({ ...agent, pageId })));
        recompilePage(site, page!);
        emit({ type: "preview.sync", html: page!.html!, pageId, force: true, at: now() });
      }
      recomputeStats(site);
      site.status = "done";
      emit({
        type: "revision.done",
        revisionId: run.id,
        success: true,
        summary: revisionDone?.type === "revision.done" ? revisionDone.summary : "Alteração aplicada.",
        cost,
        totalCost: site.cost,
        pageId,
        at: now(),
      });
      if (!shared) emit({ type: "site.page.done", page: sitePageView(page!), at: now() });
    } else {
      site.status = "done";
      emit({
        type: "revision.done",
        revisionId: run.id,
        success: false,
        summary: revisionDone?.type === "revision.done" ? revisionDone.summary : "Alteração falhou.",
        cost,
        totalCost: site.cost,
        pageId,
        at: now(),
      });
    }
    run.status = success ? "done" : "failed";
    run.finishedAt = now();
  } catch (error) {
    site.status = "done";
    run.status = "failed";
    run.finishedAt = now();
    emit({
      type: "revision.done",
      revisionId: run.id,
      success: false,
      summary: errorMessage(error),
      cost: 0,
      totalCost: site.cost,
      pageId,
      at: now(),
    });
  }
};

export const runSiteSectionAddition = async (input: {
  runtime: AgentRuntime;
  site: SiteProjectRecord;
  run: RunRecord;
  pageId: string;
  prompt: string;
  title?: string;
  kind?: import("@swarm/dsl").SectionKind;
  insertIndex: number;
  quality?: "solo" | "split" | "race";
}): Promise<void> => {
  const { runtime, site, run, pageId } = input;
  const emit = run.channel.emit.bind(run.channel);
  const page = pageRecord(site, pageId);
  const spec = pageFor(site, pageId);
  if (!site.plan || !page?.artifact || !spec) {
    run.status = "failed";
    run.finishedAt = now();
    emit({ type: "section.add.done", success: false, summary: "Página sem artefato.", cost: 0, at: now() });
    return;
  }
  const previous = snapshot(site);
  const child = childProject(`${site.id}:${pageId}:section`, spec.description || spec.title);
  child.plan = sitePagePlan(site.plan, spec);
  child.artifact = pageOnlyArtifact(page);
  child.ownership = ownershipFor(site, pageId);
  child.agents = agentsFor(site, pageId);
  child.parentSessionId = site.parentSessionId;
  const childRunRecord = childRun(`${run.id}:${pageId}:section`, child.id);
  let doneEvent: BuildEvent | undefined;
  childRunRecord.channel.subscribe((event) => {
    if (event.type === "section.add.done") {
      doneEvent = event;
      return;
    }
    if (event.type === "preview.sync" || event.type === "preview.updated") return;
    emit(withPageId(event, pageId));
  });
  try {
    await runSectionAddition({
      runtime,
      project: child,
      run: childRunRecord,
      prompt: input.prompt,
      title: input.title,
      kind: input.kind,
      insertIndex: input.insertIndex,
      quality: input.quality,
      parentSessionId: site.parentSessionId,
    });
    const cost = doneEvent?.type === "section.add.done" ? doneEvent.cost : 0;
    const success = doneEvent?.type === "section.add.done" ? doneEvent.success : false;
    if (success && child.plan) {
      site.undoStack = [...(site.undoStack ?? []).slice(-19), previous];
      site.plan = {
        ...site.plan,
        pages: site.plan.pages.map((item) => (item.slug === pageId ? { ...item, sections: child.plan!.sections } : item)),
      };
      page.artifact = child.artifact;
      page.cost = Math.round((page.cost + cost) * 10000) / 10000;
      page.status = "done";
      site.ownership = mergeOwnership(site, pageId, child.ownership ?? {});
      site.agents = mergeAgents(site, (child.agents ?? []).map((agent) => ({ ...agent, pageId })));
      site.cost = Math.round((site.cost + cost) * 10000) / 10000;
      recompilePage(site, page);
      recomputeStats(site);
      site.status = "done";
      emit({ type: "preview.sync", html: page.html!, pageId, force: true, at: now() });
      emit({ type: "site.page.done", page: sitePageView(page), at: now() });
      emit({
        type: "section.add.done",
        sectionId: doneEvent?.type === "section.add.done" ? doneEvent.sectionId : undefined,
        success: true,
        summary: doneEvent?.type === "section.add.done" ? doneEvent.summary : "Seção adicionada.",
        cost,
        at: now(),
      });
    } else {
      site.status = "done";
      emit({
        type: "section.add.done",
        success: false,
        summary: doneEvent?.type === "section.add.done" ? doneEvent.summary : "Falha ao adicionar seção.",
        cost,
        at: now(),
      });
    }
    run.status = success ? "done" : "failed";
    run.finishedAt = now();
  } catch (error) {
    site.status = "done";
    run.status = "failed";
    run.finishedAt = now();
    emit({ type: "section.add.done", success: false, summary: errorMessage(error), cost: 0, at: now() });
  }
};

export const expandSiteSelection = (
  site: SiteProjectRecord,
  pageId: string,
  nodeIds: string[],
): Array<{ nodeId: string; ownerName?: string; text?: string }> => {
  const shared = pageId === "shared";
  const page = shared ? undefined : pageRecord(site, pageId);
  if (!site.plan || (!shared && !page)) return [];
  const project: ProjectRecord = {
    id: site.id,
    prompt: site.prompt,
    status: "done",
    createdAt: site.createdAt,
    plan: shared ? siteLayoutPlan(site.plan) : sitePagePlan(site.plan, pageFor(site, pageId)!),
    artifact: shared ? layoutArtifact(site) : pageOnlyArtifact(page!)!,
    ownership: ownershipFor(site, pageId),
    agents: agentsFor(site, pageId),
  };
  return expandSelection(project, nodeIds, "text").map((match) => ({
    nodeId: match.nodeId,
    ownerName: match.ownerName,
    text: match.text,
  }));
};

export const undoSite = (site: SiteProjectRecord): SitePageView[] | null => {
  const snapshotValue = site.undoStack?.pop();
  if (!snapshotValue) return null;
  site.plan = snapshotValue.plan;
  site.layout = snapshotValue.layout;
  site.pages = snapshotValue.pages;
  site.agents = snapshotValue.agents;
  site.ownership = snapshotValue.ownership;
  recomputeStats(site);
  return site.pages.map(sitePageView);
};
