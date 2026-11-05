import {
  applyCriticIssue,
  applyRefinements,
  buildRenderOps,
  collectNodes,
  compilePage,
  fallbackSection,
  findNode,
  normalizeAnchors,
  normalizePlan,
  validateSectionPatch,
  type BuildPlan,
  type CursorPlan,
  type CursorRole,
  type Node,
  type SectionKind,
  type SectionSpec,
} from "@swarm/dsl";
import type { AgentRuntime } from "@swarm/agent-runtime";
import { COLORS, NAMES, type AgentInfo, type OwnershipEntry } from "@swarm/protocol";
import { auditHtml } from "./audit.js";
import type { ProjectRecord, RunRecord } from "./store.js";

export type AddSectionInput = {
  runtime: AgentRuntime;
  project: ProjectRecord;
  run: RunRecord;
  prompt: string;
  title?: string;
  kind?: SectionKind;
  insertIndex: number;
  quality?: "solo" | "split" | "race";
  parentSessionId?: string;
};

type Assignment = {
  agent: AgentInfo;
  role: CursorRole;
  variant?: number;
  lead: boolean;
};

const pageHtml = (plan: BuildPlan, root: Node): string =>
  compilePage({ title: plan.title, description: plan.tagline, plan, root });

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const qualityPlan = (quality: "solo" | "split" | "race" | undefined): CursorPlan => {
  if (quality === "split") return { count: 2, mode: "split", roles: ["layout", "copy"] };
  if (quality === "race") return { count: 2, mode: "race" };
  return { count: 1, mode: "solo" };
};

const makeAgent = (sectionId: string, role: CursorRole, index: number, variant?: number): AgentInfo => ({
  id: variant != null ? `section:${sectionId}:v${variant}` : role === "layout" ? `section:${sectionId}` : `section:${sectionId}:${role}`,
  name: NAMES[index % NAMES.length] ?? `Agent ${index}`,
  color: COLORS[index % COLORS.length] ?? "#0D99FF",
  role: "section",
  sectionId,
  cursorRole: role,
  groupId: `group:${sectionId}`,
  variant,
});

const assignmentsFor = (section: SectionSpec, baseIndex: number): Assignment[] => {
  const plan = section.cursors ?? { count: 1, mode: "solo" as const };
  if (plan.mode === "race" && plan.count > 1) {
    return Array.from({ length: plan.count }, (_, i) => ({
      agent: makeAgent(section.id, "layout", baseIndex + i, i),
      role: "layout" as const,
      variant: i,
      lead: i === 0,
    }));
  }
  if (plan.mode === "split" && plan.count > 1) {
    const roles = plan.roles?.length ? plan.roles : (["layout", "copy"] as CursorRole[]);
    return roles.slice(0, plan.count).map((role, i) => ({
      agent: makeAgent(section.id, role, baseIndex + i),
      role,
      lead: i === 0,
    }));
  }
  return [{ agent: makeAgent(section.id, "layout", baseIndex), role: "layout", lead: true }];
};

const tag = (node: Node, agent: AgentInfo, ownership: Map<string, OwnershipEntry>) => {
  for (const item of collectNodes(node)) {
    ownership.set(item.id, {
      agentId: agent.id,
      sectionId: agent.sectionId ?? "",
      cursorRole: agent.cursorRole,
    });
  }
};

export const runSectionAddition = async (input: AddSectionInput): Promise<void> => {
  const { runtime, project, run, prompt, insertIndex, quality } = input;
  const emit = run.channel.emit.bind(run.channel);
  const plan = project.plan;
  const artifact = project.artifact;
  const agents = project.agents ?? [];
  const ownership = { ...(project.ownership ?? {}) };
  let totalCost = 0;
  let sectionId: string | undefined;

  if (!plan || !artifact) {
    project.status = "done";
    run.status = "failed";
    run.finishedAt = Date.now();
    emit({ type: "section.add.done", success: false, summary: "Projeto sem artefato.", cost: 0, at: Date.now() });
    return;
  }
  if (plan.sections.length >= 12) {
    project.status = "done";
    run.status = "failed";
    run.finishedAt = Date.now();
    emit({ type: "section.add.done", success: false, summary: "Limite de seções atingido.", cost: 0, at: Date.now() });
    return;
  }

  try {
    emit({ type: "section.add.started", prompt, insertIndex, at: Date.now() });

    const planned = await runtime.planSection({
      plan,
      prompt,
      title: input.title,
      kind: input.kind,
      insertIndex,
      quality: quality ?? "solo",
      parentSessionId: input.parentSessionId,
    });
    totalCost += planned.cost ?? 0;

    const temp = normalizePlan({ ...plan, sections: [...plan.sections, planned.section] });
    const spec: SectionSpec = {
      ...temp.sections[temp.sections.length - 1]!,
      cursors: qualityPlan(quality),
    };
    sectionId = spec.id;
    const index = clamp(Math.round(insertIndex), 0, plan.sections.length);
    const nextPlan: BuildPlan = { ...plan, sections: [...plan.sections] };
    nextPlan.sections.splice(index, 0, spec);

    const assignments = assignmentsFor(spec, agents.length || 1);
    const newAgents = assignments.map((assignment) => assignment.agent);
    const nextAgents = [...agents, ...newAgents];
    const newOwnership = new Map<string, OwnershipEntry>(Object.entries(ownership));

    emit({ type: "plan.updated", plan: nextPlan, at: Date.now() });
    emit({
      type: "section.added",
      sectionId: spec.id,
      section: spec,
      index,
      agents: newAgents,
      at: Date.now(),
    });
    for (const agent of newAgents) emit({ type: "agent.spawned", agent, at: Date.now() });

    let sectionNode: Node | null = null;
    let lead = assignments[0]!;

    if (spec.cursors?.mode === "race" && assignments.length > 1) {
      const candidates: Array<{ node: Node; agent: AgentInfo }> = [];
      for (const assignment of assignments) {
        emit({ type: "task.started", taskId: `${spec.id}:v${assignment.variant}`, sectionId: spec.id, agent: assignment.agent, at: Date.now() });
        emit({ type: "variant.started", sectionId: spec.id, agent: assignment.agent, variant: assignment.variant ?? 0, at: Date.now() });
        try {
          const built = await runtime.buildSection({
            plan: nextPlan,
            section: spec,
            before: nextPlan.sections[index - 1],
            after: nextPlan.sections[index + 1],
            parentSessionId: input.parentSessionId,
            variantHint: "Create a fresh, high-quality direction for this new section.",
          });
          totalCost += built.cost ?? 0;
          const checked = validateSectionPatch(built.patch, nextPlan);
          if (!checked.ok) throw new Error(checked.error);
          candidates.push({ node: checked.node, agent: assignment.agent });
        } catch (error) {
          emit({ type: "task.failed", sectionId: spec.id, message: error instanceof Error ? error.message : String(error), at: Date.now() });
        }
      }
      if (candidates.length) {
        const winner = candidates[0]!;
        sectionNode = winner.node;
        lead = assignments.find((assignment) => assignment.agent.id === winner.agent.id) ?? lead;
        for (const candidate of candidates) {
          emit({
            type: candidate === winner ? "variant.selected" : "variant.discarded",
            sectionId: spec.id,
            agent: candidate.agent,
            variant: candidate.agent.variant ?? 0,
            at: Date.now(),
          });
        }
      }
    } else {
      for (let attempt = 0; attempt < 2 && !sectionNode; attempt++) {
        emit({ type: "task.started", taskId: spec.id, sectionId: spec.id, agent: lead.agent, at: Date.now() });
        try {
          const built = await runtime.buildSection({
            plan: nextPlan,
            section: spec,
            before: nextPlan.sections[index - 1],
            after: nextPlan.sections[index + 1],
            parentSessionId: input.parentSessionId,
            retryNote: attempt ? "A nova seção precisa ser menor e mais simples. Máximo 25 nós." : undefined,
          });
          totalCost += built.cost ?? 0;
          const checked = validateSectionPatch(built.patch, nextPlan);
          if (!checked.ok) throw new Error(checked.error);
          sectionNode = checked.node;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          emit({ type: "task.failed", sectionId: spec.id, message, at: Date.now() });
        }
      }
    }

    if (!sectionNode) {
      sectionNode = fallbackSection(spec);
      emit({ type: "task.fallback", sectionId: spec.id, message: "Nova seção usando fallback.", at: Date.now() });
    }
    tag(sectionNode, lead.agent, newOwnership);

    if (lead.role === "layout" && spec.cursors?.mode === "split" && assignments.length > 1) {
      for (const assignment of assignments.slice(1)) {
        emit({ type: "task.started", taskId: `${spec.id}:${assignment.role}`, sectionId: spec.id, agent: assignment.agent, at: Date.now() });
        try {
          const refined = await runtime.refineSection({
            plan: nextPlan,
            section: spec,
            node: sectionNode,
            role: assignment.role,
            parentSessionId: input.parentSessionId,
          });
          totalCost += refined.cost ?? 0;
          const patches = refined.result.patches;
          if (patches.length) {
            sectionNode = applyRefinements(sectionNode, patches);
            for (const patch of patches) {
              newOwnership.set(patch.nodeId, {
                agentId: assignment.agent.id,
                sectionId: spec.id,
                cursorRole: assignment.role,
              });
            }
          }
          emit({ type: "patch.applied", sectionId: spec.id, agentId: assignment.agent.id, nodeCount: collectNodes(sectionNode).length, sessionId: refined.sessionId, at: Date.now() });
        } catch (error) {
          emit({ type: "task.failed", sectionId: spec.id, message: error instanceof Error ? error.message : String(error), at: Date.now() });
        }
      }
    }

    const nextArtifact = structuredClone(artifact);
    const page = nextArtifact.id === "page" ? nextArtifact : findNode(nextArtifact, "page") ?? nextArtifact;
    page.children = page.children ?? [];
    const beforeNodeId = page.children[index]?.id;
    page.children.splice(index, 0, sectionNode);

    const previous = {
      artifact: structuredClone(artifact),
      html: project.html ?? "",
      ownership: structuredClone(project.ownership ?? {}),
      plan: structuredClone(plan),
      agents: structuredClone(agents),
      at: Date.now(),
    };
    project.undoStack = [...(project.undoStack ?? []).slice(-19), previous];

    let root = normalizeAnchors(nextArtifact, nextPlan);
    let html = pageHtml(nextPlan, root);
    const report = await auditHtml(html);
    const scoped = report.issues.filter(
      (issue) => issue.sectionId === spec.id || issue.nodeId === spec.id || issue.nodeId?.startsWith(`${spec.id}-`),
    );
    for (const issue of scoped) {
      if (!issue.autoFix || !issue.patch) continue;
      root = applyCriticIssue(root, issue);
    }
    if (scoped.some((issue) => issue.autoFix && issue.patch)) html = pageHtml(nextPlan, root);

    project.plan = nextPlan;
    project.artifact = root;
    project.html = html;
    project.agents = nextAgents;
    project.ownership = Object.fromEntries(newOwnership);
    project.status = "done";

    emit({
      type: "render.ops",
      batch: {
        sectionId: spec.id,
        agent: lead.agent,
        ops: buildRenderOps(sectionNode, "page", { beforeNodeId }),
      },
      at: Date.now(),
    });
    emit({ type: "preview.sync", html, at: Date.now() });
    emit({ type: "ownership.updated", ownership: project.ownership, at: Date.now() });
    emit({ type: "audit.ready", available: report.available, issues: scoped.length, warning: report.warning, at: Date.now() });

    run.status = "done";
    run.finishedAt = Date.now();
    emit({
      type: "section.add.done",
      sectionId: spec.id,
      success: true,
      summary: `Seção ${spec.title} adicionada após a posição ${index}.`,
      cost: Math.round(totalCost * 10000) / 10000,
      at: Date.now(),
    });
  } catch (error) {
    project.status = "done";
    run.status = "failed";
    run.finishedAt = Date.now();
    emit({ type: "plan.updated", plan, at: Date.now() });
    emit({
      type: "section.add.done",
      sectionId,
      success: false,
      summary: error instanceof Error ? error.message : String(error),
      cost: Math.round(totalCost * 10000) / 10000,
      at: Date.now(),
    });
  }
};
