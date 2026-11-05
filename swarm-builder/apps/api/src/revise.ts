import {
  applyRefinements,
  collectNodes,
  compilePage,
  diffRenderOps,
  findNode,
  normalizeAnchors,
  type BuildPlan,
  type Node,
  type RefinementPatch,
} from "@swarm/dsl";
import type { AgentRuntime } from "@swarm/agent-runtime";
import type { AgentInfo, OwnershipEntry } from "@swarm/protocol";
import { auditHtml } from "./audit.js";
import type { ProjectRecord, RunRecord } from "./store.js";

export type RevisionTarget = {
  nodeId?: string;
  nodeIds?: string[];
  sectionId?: string;
  agentId?: string;
  expand?: "text";
};

export type RevisionInput = {
  runtime: AgentRuntime;
  project: ProjectRecord;
  run: RunRecord;
  request: string;
  target: RevisionTarget;
  parentSessionId?: string;
};

export type ExpandMatch = {
  nodeId: string;
  sectionId?: string;
  ownerAgentId?: string;
  ownerName?: string;
  text?: string;
};

const pageHtml = (plan: BuildPlan, root: Node): string =>
  compilePage({ title: plan.title, description: plan.tagline, plan, root });

const normText = (value: string | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const sectionForNode = (plan: BuildPlan, ownership: Record<string, OwnershipEntry>, nodeId?: string): string | undefined => {
  if (!nodeId) return undefined;
  const owner = ownership[nodeId];
  if (owner?.sectionId) return owner.sectionId;
  return plan.sections.find((section) => nodeId === section.id || nodeId.startsWith(`${section.id}-`))?.id;
};

const primaryAgent = (agents: AgentInfo[], sectionId: string): AgentInfo | undefined =>
  agents.find((agent) => agent.sectionId === sectionId && agent.cursorRole === "layout") ??
  agents.find((agent) => agent.sectionId === sectionId);

export const expandSelection = (
  project: ProjectRecord,
  nodeIds: string[],
  by: "text",
): ExpandMatch[] => {
  const artifact = project.artifact;
  const plan = project.plan;
  const ownership = project.ownership ?? {};
  const agents = project.agents ?? [];
  if (!artifact || !plan || by !== "text") return [];

  const selected = nodeIds.map((id) => findNode(artifact, id)).filter((node): node is Node => Boolean(node));
  const values = new Set(
    selected.flatMap((node) => [node.text, node.alt]).map(normText).filter((value) => value.length > 1),
  );
  if (!values.size) return [];

  const matches: ExpandMatch[] = [];
  for (const node of collectNodes(artifact)) {
    if (nodeIds.includes(node.id)) continue;
    const ownValues = [node.text, node.alt].map(normText).filter((value) => value.length > 1);
    if (!ownValues.some((value) => values.has(value))) continue;
    const owner = ownership[node.id];
    const sectionId = owner?.sectionId ?? sectionForNode(plan, ownership, node.id);
    const ownerAgentId = owner?.agentId;
    matches.push({
      nodeId: node.id,
      sectionId,
      ownerAgentId,
      ownerName: agents.find((agent) => agent.id === ownerAgentId)?.name,
      text: node.text ?? node.alt,
    });
    if (matches.length >= 80) break;
  }
  return matches;
};

export const runRevision = async (input: RevisionInput): Promise<void> => {
  const { runtime, project, run, request, target } = input;
  const channel = run.channel;
  const emit = channel.emit.bind(channel);
  const plan = project.plan;
  const artifact = project.artifact;
  const ownership = project.ownership ?? {};
  const agents = project.agents ?? [];

  if (!plan || !artifact) {
    project.status = "done";
    run.status = "failed";
    run.finishedAt = Date.now();
    emit({ type: "revision.done", revisionId: run.id, success: false, summary: "Projeto sem artefato para editar.", cost: 0, at: Date.now() });
    return;
  }

  let revisedAgentId: string | undefined;
  try {
    const selectedIds = new Set<string>(
      target.nodeIds?.length ? target.nodeIds : target.nodeId ? [target.nodeId] : [],
    );

    if (target.agentId) {
      const agent = agents.find((candidate) => candidate.id === target.agentId);
      if (!agent) throw new Error(`agent ${target.agentId} not found`);
      const owned = Object.entries(ownership)
        .filter(([, entry]) => entry.agentId === target.agentId)
        .map(([id]) => id);
      for (const id of owned) selectedIds.add(id);
      if (!selectedIds.size && agent.sectionId) selectedIds.add(agent.sectionId);
    }

    if (!selectedIds.size && target.sectionId) selectedIds.add(target.sectionId);

    if (target.expand === "text" && (target.nodeIds?.length || target.nodeId)) {
      for (const match of expandSelection(project, [...selectedIds], "text")) selectedIds.add(match.nodeId);
    }

    let selectedNodes = [...selectedIds].map((id) => findNode(artifact, id)).filter((node): node is Node => Boolean(node));
    if (!selectedNodes.length) throw new Error("revision target has no nodes");

    let primarySectionId = target.sectionId ?? sectionForNode(plan, ownership, selectedNodes[0]!.id);
    if (!primarySectionId) throw new Error("revision target has no section");

    const section = plan.sections.find((candidate) => candidate.id === primarySectionId);
    if (!section) throw new Error(`section ${primarySectionId} not found`);

    const sectionNode = findNode(artifact, primarySectionId);
    const firstOwnerId = ownership[selectedNodes[0]!.id]?.agentId;
    const agent =
      agents.find((candidate) => candidate.id === firstOwnerId) ??
      primaryAgent(agents, primarySectionId);
    if (!agent) throw new Error("revision target has no owner agent");
    revisedAgentId = agent.id;

    const allowedNodeIds = new Set<string>();
    if (target.agentId) {
      for (const [id, entry] of Object.entries(ownership)) if (entry.agentId === target.agentId) allowedNodeIds.add(id);
      if (sectionNode) allowedNodeIds.add(sectionNode.id);
    } else {
      for (const node of selectedNodes) for (const item of collectNodes(node)) allowedNodeIds.add(item.id);
    }
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

    const revisionId = run.id;
    emit({ type: "agent.spawned", agent, at: Date.now() });
    emit({
      type: "revision.started",
      revisionId,
      agent,
      sectionId: primarySectionId,
      nodeId: selectedNodes[0]!.id,
      request,
      at: Date.now(),
    });

    const edited = await runtime.editNode({
      plan,
      section,
      node: targetNode,
      targets,
      request,
      allowedNodeIds: [...allowedNodeIds],
      agentId: agent.id,
      agentName: agent.name,
      role: agent.cursorRole,
      parentSessionId: input.parentSessionId,
    });

    const patches: RefinementPatch[] = edited.result.patches;
    if (!patches.length) throw new Error("o agente não retornou nenhuma alteração válida para o escopo selecionado");
    const outside = patches.find((patch) => !allowedNodeIds.has(patch.nodeId));
    if (outside) throw new Error(`alteração fora do escopo selecionado: ${outside.nodeId}`);

    const previous = structuredClone(artifact) as Node;
    const previousHtml = project.html ?? "";
    const previousOwnership = structuredClone(ownership) as Record<string, OwnershipEntry>;
    project.undoStack = [...(project.undoStack ?? []).slice(-19), {
      artifact: previous,
      html: previousHtml,
      ownership: previousOwnership,
      plan: structuredClone(plan),
      agents: structuredClone(agents),
      at: Date.now(),
    }];

    const nextRoot = normalizeAnchors(applyRefinements(artifact, patches), plan);
    const nextOwnership: Record<string, OwnershipEntry> = { ...ownership };
    for (const patch of patches) {
      const owner = ownership[patch.nodeId];
      nextOwnership[patch.nodeId] = owner ?? {
        agentId: agent.id,
        sectionId: primarySectionId,
        cursorRole: agent.cursorRole,
      };
    }

    const nextHtml = pageHtml(plan, nextRoot);
    project.artifact = nextRoot;
    project.html = nextHtml;
    project.ownership = nextOwnership;
    project.status = "done";

    const groups = new Map<string, { agent: AgentInfo; sectionId: string; ops: ReturnType<typeof diffRenderOps> }>();
    for (const patch of patches) {
      const before = findNode(artifact, patch.nodeId);
      const after = findNode(nextRoot, patch.nodeId);
      if (!before || !after) continue;
      const owner = ownership[patch.nodeId];
      const ownerAgent = agents.find((candidate) => candidate.id === owner?.agentId) ?? agent;
      const groupSection = owner?.sectionId ?? sectionForNode(plan, ownership, patch.nodeId) ?? primarySectionId;
      let group = groups.get(ownerAgent.id);
      if (!group) {
        group = { agent: ownerAgent, sectionId: groupSection, ops: [] };
        groups.set(ownerAgent.id, group);
      }
      group.ops.push(...diffRenderOps(before, after, "type"));
    }
    for (const group of groups.values()) {
      if (!group.ops.length) continue;
      emit({
        type: "render.ops",
        batch: { sectionId: group.sectionId, agent: group.agent, ops: group.ops },
        at: Date.now(),
      });
    }

    emit({
      type: "revision.applied",
      revisionId,
      agent,
      sectionId: primarySectionId,
      nodeIds: patches.map((patch) => patch.nodeId),
      nodeCount: collectNodes(nextRoot).length,
      at: Date.now(),
    });
    emit({ type: "preview.sync", html: nextHtml, at: Date.now() });
    emit({ type: "ownership.updated", ownership: nextOwnership, at: Date.now() });

    const audit = await auditHtml(nextHtml);
    emit({
      type: "audit.ready",
      available: audit.available,
      issues: audit.issues.length,
      warning: audit.warning,
      at: Date.now(),
    });

    run.status = "done";
    run.finishedAt = Date.now();
    emit({
      type: "revision.done",
      revisionId,
      agentId: agent.id,
      success: true,
      summary: edited.result.summary || "Alteração aplicada.",
      cost: Math.round((edited.cost ?? 0) * 10000) / 10000,
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
      at: Date.now(),
    });
  }
};

export const undoRevision = (
  project: ProjectRecord,
): { html: string; ownership: Record<string, OwnershipEntry>; plan: BuildPlan; agents: AgentInfo[] } | null => {
  const stack = project.undoStack ?? [];
  const snapshot = stack.pop();
  if (!snapshot) return null;
  project.undoStack = stack;
  project.artifact = snapshot.artifact;
  project.html = snapshot.html;
  project.ownership = snapshot.ownership;
  project.plan = snapshot.plan;
  project.agents = snapshot.agents;
  return { html: snapshot.html, ownership: snapshot.ownership, plan: snapshot.plan, agents: snapshot.agents };
};
