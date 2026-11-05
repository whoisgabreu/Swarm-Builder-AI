import {
  CREATIVE_FORMATS,
  collectNodes,
  compileArtboard,
  countCreativeNodes,
  fallbackArtboard,
  normalizeCreativePlan,
  validateArtboardPatch,
  type CreativeSetPlan,
  type CursorRole,
  type Node,
} from "@swarm/dsl";
import type { AgentRuntime } from "@swarm/agent-runtime";
import {
  COLORS,
  NAMES,
  type AgentInfo,
  type BuildStatus,
  type CreativeArtboardView,
  type CreativeLayerGroup,
  type CreativeProjectView,
  type CreativeStats,
  type OwnershipEntry,
} from "@swarm/protocol";
import type { RunRecord } from "./store.js";

export type CreativeUndoSnapshot = {
  artifact: Node;
  html: string;
  ownership: Record<string, OwnershipEntry>;
  groups: CreativeLayerGroup[];
  at: number;
};

export type CreativeArtboardRecord = {
  id: string;
  index: number;
  role: CreativeArtboardView["role"];
  html: string;
  status: CreativeArtboardView["status"];
  fallback?: boolean;
  groups: CreativeLayerGroup[];
  cost: number;
  nodes: number;
  artifact?: Node;
  ownership: Record<string, OwnershipEntry>;
  undoStack: CreativeUndoSnapshot[];
};

export type CreativeProjectRecord = {
  id: string;
  prompt: string;
  brand?: string;
  cta?: string;
  formatId: "ig-square" | "ig-portrait";
  cardCount: number;
  status: BuildStatus;
  createdAt: number;
  plan?: CreativeSetPlan;
  artboards: CreativeArtboardRecord[];
  agents?: AgentInfo[];
  ownership?: Record<string, OwnershipEntry>;
  cost: number;
  stats?: CreativeStats;
  error?: string;
  runId?: string;
  parentSessionId?: string;
};

export const creativeProjects = new Map<string, CreativeProjectRecord>();

export const creativeArtboardView = (artboard: CreativeArtboardRecord): CreativeArtboardView => ({
  id: artboard.id,
  index: artboard.index,
  role: artboard.role,
  html: artboard.html,
  status: artboard.status,
  fallback: artboard.fallback,
  groups: artboard.groups,
  cost: artboard.cost,
  nodes: artboard.nodes,
  undoAvailable: artboard.undoStack.length > 0,
});

export const creativeProjectView = (project: CreativeProjectRecord): CreativeProjectView => ({
  id: project.id,
  prompt: project.prompt,
  brand: project.brand,
  cta: project.cta,
  formatId: project.formatId,
  cardCount: project.cardCount,
  status: project.status,
  createdAt: project.createdAt,
  plan: project.plan,
  artboards: project.artboards.map(creativeArtboardView),
  agents: project.agents,
  ownership: project.ownership,
  cost: project.cost,
  stats: project.stats,
  error: project.error,
});

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
};

const agentAt = (index: number, id: string, role: AgentInfo["role"], cursorRole: CursorRole | undefined, sectionId?: string): AgentInfo => ({
  id,
  name: NAMES[index % NAMES.length] ?? `Agent ${index}`,
  color: COLORS[index % COLORS.length] ?? "#0D99FF",
  role,
  sectionId,
  cursorRole,
  groupId: sectionId ? `group:${sectionId}` : undefined,
});

const artboardAgent = (artboardId: string, index: number): AgentInfo =>
  agentAt(index + 1, `artboard:${artboardId}`, "section", "layout", artboardId);

const roleForNode = (node: Node): CursorRole => {
  switch (node.type) {
    case "image":
    case "icon":
      return "media";
    case "heading":
    case "text":
    case "list":
    case "listItem":
      return "copy";
    case "button":
    case "link":
    case "input":
      return "content";
    case "stack":
    case "grid":
    case "section":
      return "layout";
    default:
      return "style";
  }
};

const labelForNode = (node: Node): string => {
  switch (node.type) {
    case "heading":
      return "Título";
    case "text":
      return "Texto";
    case "image":
      return "Imagem";
    case "icon":
      return "Ícone";
    case "button":
    case "link":
      return "CTA";
    case "stack":
    case "grid":
      return "Layout";
    default:
      return "Elemento";
  }
};

const principalLayers = (root: Node): Node[] => {
  const direct = root.children ?? [];
  if (direct.length > 1) return direct;
  const only = direct[0];
  if (only && (only.children?.length ?? 0) > 1) return only.children ?? [];
  return direct;
};

export const assignCreativeOwnership = (input: {
  root: Node;
  artboardId: string;
  artboardAgent: AgentInfo;
  seed: number;
}): { agents: AgentInfo[]; groups: CreativeLayerGroup[]; ownership: Record<string, OwnershipEntry> } => {
  const ownership: Record<string, OwnershipEntry> = {};
  const base: OwnershipEntry = {
    agentId: input.artboardAgent.id,
    sectionId: input.artboardId,
    cursorRole: input.artboardAgent.cursorRole,
  };
  for (const node of collectNodes(input.root)) ownership[node.id] = base;

  const groups: CreativeLayerGroup[] = [];
  const agents: AgentInfo[] = [];
  const layers = principalLayers(input.root).slice(0, 6);
  layers.forEach((layer, index) => {
    const role = roleForNode(layer);
    const agent = agentAt(input.seed + index, `element:${input.artboardId}:${index + 1}`, "section", role, input.artboardId);
    const nodeIds = collectNodes(layer).map((node) => node.id);
    const entry: OwnershipEntry = { agentId: agent.id, sectionId: input.artboardId, cursorRole: role };
    for (const nodeId of nodeIds) ownership[nodeId] = entry;
    agents.push(agent);
    groups.push({
      agentId: agent.id,
      nodeId: layer.id,
      nodeIds,
      role,
      label: labelForNode(layer),
    });
  });
  return { agents, groups, ownership };
};

export const runCreativeBuild = async (input: {
  runtime: AgentRuntime;
  project: CreativeProjectRecord;
  run: RunRecord;
  concurrency?: number;
}): Promise<void> => {
  const { runtime, project, run, concurrency = 3 } = input;
  const emit = run.channel.emit.bind(run.channel);
  const started = Date.now();
  let totalCost = 0;
  let fallbacks = 0;

  project.status = "planning";
  run.status = "planning";
  project.cost = 0;
  project.stats = undefined;
  project.ownership = {};
  emit({ type: "creative.started", projectId: project.id, prompt: project.prompt, at: Date.now() });

  try {
    const planned = await runtime.planCreativeSet({
      prompt: project.prompt,
      brand: project.brand,
      cta: project.cta,
      formatId: project.formatId,
      cardCount: project.cardCount,
    });
    totalCost += planned.cost ?? 0;
    const plan = normalizeCreativePlan(planned.plan, project.cardCount);
    project.plan = plan;
    project.parentSessionId = planned.sessionId;
    project.status = "building";
    run.status = "building";
    const format = CREATIVE_FORMATS[plan.formatId];
    const artboardAgents = plan.artboards.map((artboard, index) => artboardAgent(artboard.id, index));
    const director: AgentInfo = { id: "creative-director", name: "Director", color: "#F24E1E", role: "architect" };
    project.agents = [director, ...artboardAgents];
    project.artboards = plan.artboards.map((artboard, index) => ({
      id: artboard.id,
      index,
      role: artboard.role,
      html: "",
      status: "working",
      groups: [],
      cost: 0,
      nodes: 0,
      ownership: {},
      undoStack: [],
    }));
    emit({ type: "creative.plan", plan, agents: project.agents, artboards: plan.artboards, at: Date.now() });

    await mapLimit(plan.artboards, concurrency, async (artboard, index) => {
      const primaryAgent = artboardAgents[index]!;
      emit({ type: "creative.artboard.started", artboardId: artboard.id, index, agent: primaryAgent, at: Date.now() });
      let node: Node | null = null;
      let fallback = false;
      let lastError = "";
      let cardCost = 0;
      for (let attempt = 0; attempt < 2 && !node; attempt++) {
        try {
          const built = await runtime.buildArtboard({
            plan,
            artboard,
            index,
            before: plan.artboards[index - 1],
            after: plan.artboards[index + 1],
            retryNote: attempt ? "Keep the card simpler: at most 40 nodes, one focal point." : undefined,
          });
          cardCost += built.cost ?? 0;
          const checked = validateArtboardPatch(built.patch, plan);
          if (!checked.ok) throw new Error(checked.error);
          node = checked.node;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      if (!node) {
        node = fallbackArtboard(artboard, plan);
        fallback = true;
        fallbacks++;
      }
      const assignment = assignCreativeOwnership({
        root: node,
        artboardId: artboard.id,
        artboardAgent: primaryAgent,
        seed: 2 + index * 7,
      });
      const html = compileArtboard({
        title: `${plan.title} — ${artboard.id}`,
        plan,
        root: node,
        width: format.width,
        height: format.height,
      });
      const nodes = countCreativeNodes(node);
      const record: CreativeArtboardRecord = {
        id: artboard.id,
        index,
        role: artboard.role,
        html,
        status: "done",
        fallback,
        groups: assignment.groups,
        cost: Math.round(cardCost * 10000) / 10000,
        nodes,
        artifact: node,
        ownership: assignment.ownership,
        undoStack: [],
      };
      project.artboards[index] = record;
      totalCost += cardCost;
      project.cost = Math.round(totalCost * 10000) / 10000;
      const nextOwnership = { ...(project.ownership ?? {}), ...assignment.ownership };
      project.ownership = nextOwnership;
      const nextAgents = [...(project.agents ?? [])];
      for (const agent of assignment.agents) {
        if (!nextAgents.some((item) => item.id === agent.id)) nextAgents.push(agent);
        emit({ type: "agent.spawned", agent, at: Date.now() });
      }
      project.agents = nextAgents;
      emit({ type: "ownership.updated", ownership: nextOwnership, at: Date.now() });
      emit({
        type: "creative.artboard.done",
        artboardId: artboard.id,
        index,
        role: artboard.role,
        html,
        agent: primaryAgent,
        agents: [primaryAgent, ...assignment.agents],
        groups: assignment.groups,
        cost: record.cost,
        totalCost: project.cost,
        nodes,
        fallback,
        at: Date.now(),
      });
      if (fallback && lastError) {
        // fallback is still a delivered card; the error is recorded in the event payload
      }
    });

    project.status = "done";
    run.status = "done";
    run.finishedAt = Date.now();
    project.cost = Math.round(totalCost * 10000) / 10000;
    project.stats = {
      artboards: project.artboards.length,
      nodes: project.artboards.reduce((sum, artboard) => sum + artboard.nodes, 0),
      cost: project.cost,
      durationMs: Date.now() - started,
      fallbacks,
      model: runtime.name,
    };
    emit({
      type: "creative.done",
      artboards: project.artboards.map(creativeArtboardView),
      stats: project.stats,
      at: Date.now(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    project.status = "failed";
    project.error = message;
    run.status = "failed";
    run.finishedAt = Date.now();
    emit({ type: "creative.failed", message, at: Date.now() });
  }
};
