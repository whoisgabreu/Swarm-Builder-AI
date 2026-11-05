import {
  CREATIVE_FORMATS,
  applyRefinements,
  collectNodes,
  compileArtboard,
  findNode,
  type BuildPlan,
  type CreativeSetPlan,
  type Node,
  type SectionSpec,
} from "@swarm/dsl";
import type { AgentRuntime } from "@swarm/agent-runtime";
import type { AgentInfo, OwnershipEntry } from "@swarm/protocol";
import {
  creativeArtboardView,
  type CreativeArtboardRecord,
  type CreativeProjectRecord,
} from "./creative.js";
import type { RunRecord } from "./store.js";

export type CreativeRevisionTarget = {
  nodeId?: string;
  nodeIds?: string[];
  agentId?: string;
  expand?: "text";
};

export type CreativeExpandMatch = {
  nodeId: string;
  nodeIds?: string[];
  ownerAgentId?: string;
  ownerName?: string;
  text?: string;
};

const normText = (value: string | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const planAdapter = (plan: CreativeSetPlan): BuildPlan => ({
  title: plan.title,
  tagline: plan.concept,
  theme: plan.theme,
  sections: plan.artboards.map((artboard) => ({
    id: artboard.id,
    kind: "custom" as const,
    title: `Card ${artboard.role}`,
    goal: artboard.brief,
    contentBrief: artboard.brief,
    layoutBrief: "Fixed social-media artboard. Preserve composition, safe margins and hierarchy.",
  })),
});

const sectionFor = (plan: CreativeSetPlan, artboardId: string): SectionSpec | undefined =>
  planAdapter(plan).sections.find((section) => section.id === artboardId);

const artboardAgents = (project: CreativeProjectRecord, artboardId: string): AgentInfo[] =>
  (project.agents ?? []).filter((agent) => agent.sectionId === artboardId);

const artboardOwnership = (project: CreativeProjectRecord, artboardId: string): Record<string, OwnershipEntry> =>
  Object.fromEntries(
    Object.entries(project.ownership ?? {}).filter(([, entry]) => entry.sectionId === artboardId),
  );

const mergeOwnership = (
  project: CreativeProjectRecord,
  artboardId: string,
  next: Record<string, OwnershipEntry>,
): Record<string, OwnershipEntry> => {
  const merged = Object.fromEntries(
    Object.entries(project.ownership ?? {}).filter(([, entry]) => entry.sectionId !== artboardId),
  );
  return { ...merged, ...next };
};

const primaryAgent = (project: CreativeProjectRecord, artboardId: string): AgentInfo | undefined =>
  artboardAgents(project, artboardId).find((agent) => agent.id === `artboard:${artboardId}`) ??
  artboardAgents(project, artboardId)[0];

const belongsToArtboard = (project: CreativeProjectRecord, artboardId: string, nodeId: string): boolean => {
  const owner = project.ownership?.[nodeId];
  return owner?.sectionId === artboardId || nodeId === artboardId || nodeId.startsWith(`${artboardId}-`);
};

const recomputeStats = (project: CreativeProjectRecord): void => {
  if (!project.stats) return;
  project.stats = {
    ...project.stats,
    artboards: project.artboards.length,
    nodes: project.artboards.reduce((sum, artboard) => sum + artboard.nodes, 0),
    cost: project.cost,
    fallbacks: project.artboards.filter((artboard) => artboard.fallback).length,
  };
};

export const expandCreativeSelection = (
  project: CreativeProjectRecord,
  artboard: CreativeArtboardRecord,
  nodeIds: string[],
): CreativeExpandMatch[] => {
  const artifact = artboard.artifact;
  if (!artifact) return [];
  const selected = nodeIds.map((id) => findNode(artifact, id)).filter((node): node is Node => Boolean(node));
  const values = new Set(
    selected.flatMap((node) => [node.text, node.alt]).map(normText).filter((value) => value.length > 1),
  );
  if (!values.size) return [];
  const ownership = project.ownership ?? {};
  const matches: CreativeExpandMatch[] = [];
  for (const node of collectNodes(artifact)) {
    if (nodeIds.includes(node.id)) continue;
    const ownValues = [node.text, node.alt].map(normText).filter((value) => value.length > 1);
    if (!ownValues.some((value) => values.has(value))) continue;
    const owner = ownership[node.id];
    const ownerAgentId = owner?.agentId;
    matches.push({
      nodeId: node.id,
      nodeIds: [node.id],
      ownerAgentId,
      ownerName: (project.agents ?? []).find((agent) => agent.id === ownerAgentId)?.name,
      text: node.text ?? node.alt,
    });
    if (matches.length >= 80) break;
  }
  return matches;
};

const fixedRoot = (root: Node, plan: CreativeSetPlan): Node => {
  const format = CREATIVE_FORMATS[plan.formatId];
  const next = structuredClone(root) as Node;
  next.style = {
    ...(next.style ?? {}),
    width: `${format.width}px`,
    height: `${format.height}px`,
    position: "relative",
    overflow: "hidden",
  };
  return next;
};

export const runCreativeRevision = async (input: {
  runtime: AgentRuntime;
  project: CreativeProjectRecord;
  artboardId: string;
  run: RunRecord;
  request: string;
  target: CreativeRevisionTarget;
}): Promise<void> => {
  const { runtime, project, artboardId, run, request, target } = input;
  const emit = run.channel.emit.bind(run.channel);
  const plan = project.plan;
  const artboard = project.artboards.find((item) => item.id === artboardId);
  const agents = project.agents ?? [];
  let revisedAgentId: string | undefined;

  if (!plan || !artboard?.artifact) {
    project.status = "done";
    run.status = "failed";
    run.finishedAt = Date.now();
    emit({ type: "revision.done", revisionId: run.id, success: false, summary: "Card sem artefato para editar.", cost: 0, at: Date.now() });
    return;
  }

  try {
    const ownership = artboardOwnership(project, artboardId);
    const selectedIds = new Set<string>(target.nodeIds?.length ? target.nodeIds : target.nodeId ? [target.nodeId] : []);

    if (target.agentId) {
      const agent = agents.find((candidate) => candidate.id === target.agentId && candidate.sectionId === artboardId);
      if (!agent) throw new Error(`agent ${target.agentId} is not part of this card`);
      for (const [id, entry] of Object.entries(ownership)) if (entry.agentId === target.agentId) selectedIds.add(id);
    }

    if (target.expand === "text" && (target.nodeIds?.length || target.nodeId)) {
      for (const match of expandCreativeSelection(project, artboard, [...selectedIds])) selectedIds.add(match.nodeId);
    }

    const selectedNodes = [...selectedIds]
      .map((id) => findNode(artboard.artifact!, id))
      .filter((node): node is Node => Boolean(node));
    if (!selectedNodes.length) throw new Error("revision target has no nodes");
    const outside = selectedNodes.find((node) => !belongsToArtboard(project, artboardId, node.id));
    if (outside) throw new Error(`node ${outside.id} does not belong to this card`);

    const firstOwnerId = ownership[selectedNodes[0]!.id]?.agentId;
    const agent =
      agents.find((candidate) => candidate.id === firstOwnerId && candidate.sectionId === artboardId) ??
      primaryAgent(project, artboardId);
    if (!agent) throw new Error("revision target has no owner agent");
    revisedAgentId = agent.id;

    const section = sectionFor(plan, artboardId);
    if (!section) throw new Error(`artboard ${artboardId} not found in plan`);

    const allowedNodeIds = new Set<string>();
    if (target.agentId) {
      for (const [id, entry] of Object.entries(ownership)) if (entry.agentId === target.agentId) allowedNodeIds.add(id);
    }
    for (const node of selectedNodes) for (const item of collectNodes(node)) allowedNodeIds.add(item.id);
    for (const node of selectedNodes) allowedNodeIds.add(node.id);

    const targets = selectedNodes.map((node) => {
      const owner = ownership[node.id];
      const ownerAgentId = owner?.agentId ?? agent.id;
      const ownerAgent = agents.find((candidate) => candidate.id === ownerAgentId);
      return {
        nodeId: node.id,
        ownerAgentId,
        ownerName: ownerAgent?.name,
        text: node.text ?? node.alt,
        role: owner?.cursorRole ?? ownerAgent?.cursorRole,
      };
    });

    const targetNode: Node =
      selectedNodes.length === 1
        ? selectedNodes[0]!
        : { id: "selection", type: "stack", children: selectedNodes };

    emit({ type: "agent.spawned", agent, at: Date.now() });
    emit({
      type: "revision.started",
      revisionId: run.id,
      agent,
      sectionId: artboardId,
      nodeId: selectedNodes[0]!.id,
      request,
      at: Date.now(),
    });

    const format = CREATIVE_FORMATS[plan.formatId];
    const edited = await runtime.editNode({
      plan: planAdapter(plan),
      section,
      node: targetNode,
      targets,
      request,
      allowedNodeIds: [...allowedNodeIds],
      agentId: agent.id,
      agentName: agent.name,
      role: agent.cursorRole,
      parentSessionId: project.parentSessionId,
      surface: "artboard",
      format: { width: format.width, height: format.height },
    });

    const patches = edited.result.patches;
    if (!patches.length) throw new Error("o agente não retornou nenhuma alteração válida para o escopo selecionado");
    const outsidePatch = patches.find((patch) => !allowedNodeIds.has(patch.nodeId));
    if (outsidePatch) throw new Error(`alteração fora do escopo selecionado: ${outsidePatch.nodeId}`);

    const previous = structuredClone(artboard.artifact) as Node;
    const previousHtml = artboard.html;
    const previousOwnership = structuredClone(ownership) as Record<string, OwnershipEntry>;
    const previousGroups = structuredClone(artboard.groups);
    artboard.undoStack = [...artboard.undoStack.slice(-19), {
      artifact: previous,
      html: previousHtml,
      ownership: previousOwnership,
      groups: previousGroups,
      at: Date.now(),
    }];

    const nextRoot = fixedRoot(applyRefinements(artboard.artifact, patches), plan);
    const nextOwnership: Record<string, OwnershipEntry> = { ...ownership };
    for (const patch of patches) {
      const owner = ownership[patch.nodeId];
      nextOwnership[patch.nodeId] = owner ?? {
        agentId: agent.id,
        sectionId: artboardId,
        cursorRole: agent.cursorRole,
      };
    }

    const nextHtml = compileArtboard({
      title: `${plan.title} — ${artboard.id}`,
      plan,
      root: nextRoot,
      width: format.width,
      height: format.height,
    });
    const revisionCost = Math.round((edited.cost ?? 0) * 10000) / 10000;

    artboard.artifact = nextRoot;
    artboard.html = nextHtml;
    artboard.ownership = nextOwnership;
    artboard.nodes = collectNodes(nextRoot).length;
    artboard.cost = Math.round((artboard.cost + revisionCost) * 10000) / 10000;
    project.ownership = mergeOwnership(project, artboardId, nextOwnership);
    project.cost = Math.round((project.cost + revisionCost) * 10000) / 10000;
    project.status = "done";
    recomputeStats(project);

    emit({ type: "preview.updated", html: nextHtml, artboardId, at: Date.now() });
    emit({ type: "ownership.updated", ownership: project.ownership, at: Date.now() });
    emit({
      type: "revision.applied",
      revisionId: run.id,
      agent,
      sectionId: artboardId,
      nodeIds: patches.map((patch) => patch.nodeId),
      nodeCount: collectNodes(nextRoot).length,
      at: Date.now(),
    });
    run.status = "done";
    run.finishedAt = Date.now();
    emit({
      type: "revision.done",
      revisionId: run.id,
      agentId: agent.id,
      success: true,
      summary: edited.result.summary || "Alteração aplicada.",
      cost: revisionCost,
      totalCost: project.cost,
      artboardId,
      artboardCost: artboard.cost,
      at: Date.now(),
    });
  } catch (error) {
    project.status = "done";
    run.status = "failed";
    run.finishedAt = Date.now();
    emit({
      type: "revision.done",
      revisionId: run.id,
      agentId: revisedAgentId,
      success: false,
      summary: error instanceof Error ? error.message : String(error),
      cost: 0,
      totalCost: project.cost,
      artboardId,
      artboardCost: artboard.cost,
      at: Date.now(),
    });
  }
};

export const undoCreativeRevision = (
  project: CreativeProjectRecord,
  artboardId: string,
): { html: string; ownership: Record<string, OwnershipEntry>; groups: CreativeArtboardRecord["groups"]; cost: number } | null => {
  const artboard = project.artboards.find((item) => item.id === artboardId);
  if (!artboard) return null;
  const snapshot = artboard.undoStack.pop();
  if (!snapshot) return null;
  artboard.artifact = snapshot.artifact;
  artboard.html = snapshot.html;
  artboard.ownership = snapshot.ownership;
  artboard.groups = snapshot.groups;
  artboard.nodes = collectNodes(snapshot.artifact).length;
  project.ownership = mergeOwnership(project, artboardId, snapshot.ownership);
  recomputeStats(project);
  return {
    html: artboard.html,
    ownership: project.ownership,
    groups: artboard.groups,
    cost: project.cost,
  };
};

export const creativeView = (project: CreativeProjectRecord, artboardId: string) => {
  const artboard = project.artboards.find((item) => item.id === artboardId);
  return artboard ? creativeArtboardView(artboard) : null;
};
