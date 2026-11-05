import type { BuildPlan, CursorRole, Style } from "@swarm/dsl";

export type AgentRole = "architect" | "section" | "critic";

export type AgentInfo = {
  id: string;
  name: string;
  color: string;
  role: AgentRole;
  sectionId?: string;
  cursorRole?: CursorRole;
  groupId?: string;
  variant?: number;
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

export type RenderBatch = {
  sectionId: string;
  agent: AgentInfo;
  ops: RenderOp[];
};

export type OwnershipEntry = {
  agentId: string;
  sectionId: string;
  cursorRole?: CursorRole;
};

export type RunStats = {
  sections: number;
  nodes: number;
  cost: number;
  durationMs: number;
  failed?: number;
  fallbacks?: number;
  issues?: number;
  fixed?: number;
  model?: string;
};

export type BuildEvent =
  | { type: "run.started"; runId: string; projectId: string; prompt: string; at: number }
  | { type: "plan.ready"; plan: BuildPlan; agents: AgentInfo[]; at: number }
  | { type: "plan.updated"; plan: BuildPlan; at: number }
  | { type: "agent.spawned"; agent: AgentInfo; at: number }
  | { type: "task.started"; taskId: string; sectionId: string; agent: AgentInfo; at: number }
  | { type: "variant.started"; sectionId: string; agent: AgentInfo; variant: number; at: number }
  | { type: "variant.selected"; sectionId: string; agent: AgentInfo; variant: number; at: number }
  | { type: "variant.discarded"; sectionId: string; agent: AgentInfo; variant: number; at: number }
  | {
      type: "patch.applied";
      sectionId: string;
      agentId: string;
      nodeCount: number;
      sessionId: string;
      fallback?: boolean;
      at: number;
    }
  | { type: "task.failed"; sectionId: string; message: string; at: number }
  | { type: "task.fallback"; sectionId: string; message: string; at: number }
  | { type: "preview.updated"; html: string; at: number }
  | { type: "preview.sync"; html: string; force?: boolean; at: number }
  | { type: "render.ops"; batch: RenderBatch; at: number }
  | { type: "ownership.updated"; ownership: Record<string, OwnershipEntry>; at: number }
  | { type: "audit.ready"; available: boolean; issues: number; warning?: string; at: number }
  | {
      type: "critic.issue";
      issueId: string;
      nodeId?: string;
      sectionId?: string;
      agent: AgentInfo;
      severity: "high" | "medium" | "low";
      category: string;
      message: string;
      autoFix: boolean;
      at: number;
    }
  | { type: "fix.started"; issueId: string; nodeId?: string; sectionId?: string; agent: AgentInfo; message: string; at: number }
  | { type: "fix.applied"; issueId: string; nodeId?: string; sectionId?: string; agent: AgentInfo; nodeCount: number; at: number }
  | { type: "fix.done"; issueId: string; sectionId?: string; agentId: string; success: boolean; at: number }
  | { type: "critique.ready"; summary: string; issues: number; fixed: number; html: string; at: number }
  | { type: "critique.verified"; summary: string; remaining: number; html: string; at: number }
  | {
      type: "revision.started";
      revisionId: string;
      agent: AgentInfo;
      sectionId?: string;
      nodeId?: string;
      request: string;
      at: number;
    }
  | {
      type: "revision.applied";
      revisionId: string;
      agent: AgentInfo;
      sectionId?: string;
      nodeIds: string[];
      nodeCount: number;
      at: number;
    }
  | { type: "revision.done"; revisionId: string; agentId?: string; success: boolean; summary: string; cost: number; at: number }
  | { type: "revision.undone"; revisionId?: string; at: number }
  | { type: "section.add.started"; prompt: string; insertIndex: number; at: number }
  | { type: "section.added"; sectionId: string; section: import("@swarm/dsl").SectionSpec; index: number; agents: AgentInfo[]; at: number }
  | { type: "section.add.done"; sectionId?: string; success: boolean; summary: string; cost: number; at: number }
  | { type: "run.done"; html: string; stats: RunStats; at: number }
  | { type: "run.failed"; message: string; at: number };

export type SequencedEvent = BuildEvent & { seq: number };

export type BuildStatus = "idle" | "planning" | "building" | "reviewing" | "done" | "failed" | "aborted";

export type ProjectView = {
  id: string;
  prompt: string;
  status: BuildStatus;
  createdAt: number;
  plan?: BuildPlan;
  html?: string;
  error?: string;
  ownership?: Record<string, OwnershipEntry>;
};

export const NAMES = [
  "Ada",
  "Linus",
  "Grace",
  "Alan",
  "Margaret",
  "Ken",
  "Barbara",
  "Dennis",
  "Radia",
  "Guido",
  "Frances",
  "Bjarne",
  "Hedy",
  "Tim",
  "Katherine",
  "Edsger",
  "Joan",
  "Donald",
  "Sophie",
  "Niklaus",
];

export const COLORS = [
  "#F24E1E",
  "#A259FF",
  "#1ABCFE",
  "#0ACF83",
  "#FF7262",
  "#FFC700",
  "#9747FF",
  "#E8467C",
  "#14AE5C",
  "#0D99FF",
  "#FF8A00",
  "#00B5CE",
];
