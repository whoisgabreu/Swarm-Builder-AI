import type { ArtboardPatch, ArtboardSpec, BuildPlan, CreativeFormatId, CreativeSetPlan, CriticResult, CursorRole, Node, RefinementResult, Responsive, SectionKind, SectionPatch, SectionSpec } from "@swarm/dsl";

export type PlanRequest = {
  brief: string;
};

export type PlanResult = {
  plan: BuildPlan;
  sessionId: string;
  cost?: number;
};

export type SectionRequest = {
  plan: BuildPlan;
  section: SectionSpec;
  before?: Pick<SectionSpec, "id" | "kind" | "title">;
  after?: Pick<SectionSpec, "id" | "kind" | "title">;
  parentSessionId?: string;
  retryNote?: string;
  variantHint?: string;
};

export type SectionResult = {
  patch: SectionPatch;
  sessionId: string;
  cost?: number;
};

export type CriticAuditIssue = {
  nodeId?: string;
  sectionId?: string;
  severity: "high" | "medium" | "low";
  category: "layout" | "copy" | "a11y" | "visual" | "content";
  message: string;
  autoFix: boolean;
  patch?: {
    text?: string;
    src?: string;
    alt?: string;
    href?: string;
    style?: Record<string, string>;
    responsive?: Responsive;
  };
};

export type CreativeSetRequest = {
  prompt: string;
  brand?: string;
  cta?: string;
  formatId: CreativeFormatId;
  cardCount: number;
  parentSessionId?: string;
};

export type CreativeSetResult = {
  plan: CreativeSetPlan;
  sessionId: string;
  cost?: number;
};

export type ArtboardRequest = {
  plan: CreativeSetPlan;
  artboard: ArtboardSpec;
  index: number;
  before?: ArtboardSpec;
  after?: ArtboardSpec;
  parentSessionId?: string;
  retryNote?: string;
};

export type ArtboardResult = {
  patch: ArtboardPatch;
  sessionId: string;
  cost?: number;
};

export type PlanSectionRequest = {
  plan: BuildPlan;
  prompt: string;
  title?: string;
  kind?: SectionKind;
  insertIndex: number;
  quality?: "solo" | "split" | "race";
  parentSessionId?: string;
};

export type PlanSectionResult = {
  section: SectionSpec;
  notes?: string;
  sessionId: string;
  cost?: number;
};

export type RefineRequest = {
  plan: BuildPlan;
  section: SectionSpec;
  node: Node;
  role: CursorRole;
  parentSessionId?: string;
};

export type RefineOutcome = {
  result: RefinementResult;
  sessionId: string;
  cost?: number;
};

export type EditRequest = {
  plan: BuildPlan;
  section: SectionSpec;
  node: Node;
  request: string;
  allowedNodeIds: string[];
  targets?: Array<{
    nodeId: string;
    ownerAgentId: string;
    ownerName?: string;
    text?: string;
    role?: CursorRole;
  }>;
  agentId: string;
  agentName: string;
  role?: CursorRole;
  parentSessionId?: string;
  surface?: "page" | "artboard";
  format?: { width: number; height: number };
};

export type EditOutcome = {
  result: RefinementResult;
  sessionId: string;
  cost?: number;
};

export type CriticRequest = {
  plan: BuildPlan;
  root: Node;
  parentSessionId?: string;
  auditIssues?: CriticAuditIssue[];
  renderReport?: unknown;
};

export type CriticOutcome = {
  result: CriticResult;
  sessionId: string;
  cost?: number;
};

export interface AgentRuntime {
  readonly name: string;
  plan(request: PlanRequest): Promise<PlanResult>;
  planCreativeSet(request: CreativeSetRequest): Promise<CreativeSetResult>;
  buildArtboard(request: ArtboardRequest): Promise<ArtboardResult>;
  planSection(request: PlanSectionRequest): Promise<PlanSectionResult>;
  buildSection(request: SectionRequest): Promise<SectionResult>;
  refineSection(request: RefineRequest): Promise<RefineOutcome>;
  editNode(request: EditRequest): Promise<EditOutcome>;
  critique(request: CriticRequest): Promise<CriticOutcome>;
  close(): Promise<void>;
}

export type RuntimeEvent =
  | { type: "agent.thinking"; sessionId: string; agent: string }
  | { type: "agent.streaming"; sessionId: string; agent: string }
  | { type: "agent.idle"; sessionId: string; agent: string }
  | { type: "agent.error"; sessionId: string; agent: string; message: string };

export type RuntimeEventListener = (event: RuntimeEvent) => void;
