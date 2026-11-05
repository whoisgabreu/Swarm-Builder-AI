import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import {
  BuildPlanSchema,
  CriticResultSchema,
  NewSectionPlanSchema,
  RefinementResultSchema,
  SectionPatchSchema,
  z,
  type BuildPlan,
  type CriticResult,
  type NewSectionPlan,
  type Node,
  type RefinementResult,
  type SectionPatch,
} from "@swarm/dsl";
import { criticPrompt, editPrompt, planPrompt, planSectionPrompt, refinePrompt, sectionPrompt } from "./prompts.js";
import { startOpencodeServer, type OpencodeServer } from "./server.js";
import type {
  AgentRuntime,
  CriticOutcome,
  CriticRequest,
  EditOutcome,
  EditRequest,
  PlanRequest,
  PlanSectionRequest,
  PlanSectionResult,
  PlanResult,
  RefineOutcome,
  RefineRequest,
  SectionRequest,
  SectionResult,
} from "./types.js";

type ModelRef = { providerID: string; modelID: string };

type StructuredRequest<T> = {
  title: string;
  agent: string;
  prompt: string;
  schema: z.ZodType<T>;
  parentSessionId?: string;
  retryCount?: number;
  model?: ModelRef;
  timeoutMs?: number;
};

const parseModel = (value: string): ModelRef => {
  const slash = value.indexOf("/");
  if (slash === -1) throw new Error(`invalid model "${value}", expected provider/model`);
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
};

const textFromParts = (parts: unknown[]): string =>
  parts
    .map((part) => {
      if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
        return String((part as { text?: string }).text ?? "");
      }
      return "";
    })
    .join("\n")
    .trim();

const jsonFromText = (text: string): unknown => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

const messageError = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const data = error as { name?: string; data?: { message?: string } };
  return data.data?.message ?? data.name ?? null;
};

export type OpenCodeRuntimeOptions = {
  runtimeDir: string;
  port?: number;
  model?: string;
  sectionModel?: string;
  criticModel?: string;
  timeoutMs?: number;
  plannerTimeoutMs?: number;
  sectionTimeoutMs?: number;
  criticTimeoutMs?: number;
  reuseServer?: boolean;
};

export class OpenCodeRuntime implements AgentRuntime {
  readonly name = "opencode";
  readonly runtimeDir: string;
  readonly model: ModelRef;
  readonly sectionModel: ModelRef;
  readonly criticModel: ModelRef;
  readonly timeoutMs: number;
  readonly plannerTimeoutMs: number;
  readonly sectionTimeoutMs: number;
  readonly criticTimeoutMs: number;
  private server: OpencodeServer | null = null;
  private client: ReturnType<typeof createOpencodeClient> | null = null;
  private readonly port?: number;
  private readonly reuseServer: boolean;

  constructor(options: OpenCodeRuntimeOptions) {
    this.runtimeDir = options.runtimeDir;
    this.port = options.port;
    this.reuseServer = options.reuseServer ?? true;
    const base = options.model ?? process.env.SWARM_MODEL ?? "opencode-go/deepseek-v4.1-flash";
    this.model = parseModel(base);
    this.sectionModel = parseModel(options.sectionModel ?? process.env.SWARM_SECTION_MODEL ?? base);
    this.criticModel = parseModel(options.criticModel ?? process.env.SWARM_CRITIC_MODEL ?? base);
    this.timeoutMs = options.timeoutMs ?? Number(process.env.SWARM_AGENT_TIMEOUT_MS ?? 90000);
    this.plannerTimeoutMs =
      options.plannerTimeoutMs ?? Number(process.env.SWARM_PLANNER_TIMEOUT_MS ?? Math.max(this.timeoutMs, 120000));
    this.sectionTimeoutMs = options.sectionTimeoutMs ?? Number(process.env.SWARM_SECTION_TIMEOUT_MS ?? this.timeoutMs);
    this.criticTimeoutMs = options.criticTimeoutMs ?? Number(process.env.SWARM_CRITIC_TIMEOUT_MS ?? Math.max(this.timeoutMs, 240000));
  }

  async open(): Promise<void> {
    if (this.client) return;
    this.server = await startOpencodeServer({
      runtimeDir: this.runtimeDir,
      port: this.port,
      reuse: this.reuseServer,
    });
    this.client = createOpencodeClient({
      baseUrl: this.server.url,
      directory: this.runtimeDir,
      throwOnError: true,
    });
  }

  private requireClient() {
    if (!this.client) throw new Error("OpenCodeRuntime is not open");
    return this.client;
  }

  async runStructured<T>(request: StructuredRequest<T>): Promise<{ value: T; sessionId: string; cost: number }> {
    await this.open();
    const client = this.requireClient();
    const model = request.model ?? this.model;
    const session = await client.session.create(
      {
        title: request.title,
        parentID: request.parentSessionId,
        agent: request.agent,
        model: { id: model.modelID, providerID: model.providerID },
      },
      { throwOnError: true },
    );
    const sessionId = session.data.id;
    const jsonSchema = z.toJSONSchema(request.schema) as Record<string, unknown>;
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const timeoutMessage = `agent ${request.agent} timed out after ${timeoutMs}ms`;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const prompt = client.session.prompt(
      {
        sessionID: sessionId,
        agent: request.agent,
        model,
        format: {
          type: "json_schema",
          schema: jsonSchema,
          retryCount: request.retryCount ?? 2,
        },
        parts: [{ type: "text", text: request.prompt }],
      },
      { throwOnError: true },
    );
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(timeoutMessage));
        void client.session.abort({ sessionID: sessionId }, { throwOnError: false }).catch(() => {});
      }, timeoutMs);
    });

    let response: Awaited<typeof prompt>;
    try {
      response = await Promise.race([prompt, timeout]);
    } catch (error) {
      throw timedOut ? new Error(timeoutMessage) : error;
    } finally {
      if (timer) clearTimeout(timer);
    }

    const info = response.data.info;
    const error = messageError(info.error);
    if (error) {
      throw new Error(
        `agent ${request.agent} failed: ${error} (finish=${info.finish ?? "unknown"}, tokens=${info.tokens?.total ?? "?"})`,
      );
    }

    let raw = info.structured;
    if (raw == null) raw = jsonFromText(textFromParts(response.data.parts));
    if (raw == null) {
      throw new Error(
        `agent ${request.agent} returned no structured output (finish=${info.finish ?? "unknown"}, tokens=${info.tokens?.total ?? "?"})`,
      );
    }

    const parsed = request.schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `agent ${request.agent} returned invalid JSON: ${parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ")}`,
      );
    }

    return { value: parsed.data, sessionId, cost: info.cost ?? 0 };
  }

  async plan(request: PlanRequest): Promise<PlanResult> {
    const result = await this.runStructured<BuildPlan>({
      title: "Swarm Architect — BuildPlan",
      agent: "swarm-architect",
      prompt: planPrompt(request.brief),
      schema: BuildPlanSchema,
      model: this.model,
      timeoutMs: this.plannerTimeoutMs,
    });
    return { plan: result.value, sessionId: result.sessionId, cost: result.cost };
  }

  async buildSection(request: SectionRequest): Promise<SectionResult> {
    const result = await this.runStructured<SectionPatch>({
      title: `Swarm Section — ${request.section.id}`,
      agent: "swarm-section",
      prompt: sectionPrompt(request),
      schema: SectionPatchSchema,
      parentSessionId: request.parentSessionId,
      model: this.sectionModel,
      timeoutMs: this.sectionTimeoutMs,
    });
    return { patch: result.value, sessionId: result.sessionId, cost: result.cost };
  }

  async planSection(request: PlanSectionRequest): Promise<PlanSectionResult> {
    const result = await this.runStructured<NewSectionPlan>({
      title: "Swarm Section Planner — New Section",
      agent: "swarm-section-planner",
      prompt: planSectionPrompt(request),
      schema: NewSectionPlanSchema,
      parentSessionId: request.parentSessionId,
      model: this.model,
      timeoutMs: this.plannerTimeoutMs,
    });
    return { section: result.value.section, notes: result.value.notes, sessionId: result.sessionId, cost: result.cost };
  }

  async editNode(request: EditRequest): Promise<EditOutcome> {
    const result = await this.runStructured<RefinementResult>({
      title: `Swarm Editor — ${request.section.id}`,
      agent: "swarm-editor",
      prompt: editPrompt(request),
      schema: RefinementResultSchema,
      parentSessionId: request.parentSessionId,
      model: this.sectionModel,
      timeoutMs: this.sectionTimeoutMs,
    });
    return { result: result.value, sessionId: result.sessionId, cost: result.cost };
  }

  async refineSection(request: RefineRequest): Promise<RefineOutcome> {
    const result = await this.runStructured<RefinementResult>({
      title: `Swarm Refiner — ${request.section.id} (${request.role})`,
      agent: "swarm-refiner",
      prompt: refinePrompt(request),
      schema: RefinementResultSchema,
      parentSessionId: request.parentSessionId,
      model: this.sectionModel,
      timeoutMs: this.sectionTimeoutMs,
    });
    return { result: result.value, sessionId: result.sessionId, cost: result.cost };
  }

  async critique(request: CriticRequest): Promise<CriticOutcome> {
    const result = await this.runStructured<CriticResult>({
      title: "Swarm Critic — Review",
      agent: "swarm-critic",
      prompt: criticPrompt(request),
      schema: CriticResultSchema,
      parentSessionId: request.parentSessionId,
      model: this.criticModel,
      timeoutMs: this.criticTimeoutMs,
    });
    return { result: result.value, sessionId: result.sessionId, cost: result.cost };
  }

  async close(): Promise<void> {
    this.client = null;
    this.server?.close();
    this.server = null;
  }
}

export const createOpenCodeRuntime = (options: OpenCodeRuntimeOptions): AgentRuntime =>
  new OpenCodeRuntime(options);

export type { Node };
