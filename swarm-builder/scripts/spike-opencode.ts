import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { BuildPlanSchema, SectionPatchSchema, normalizePlan } from "@swarm/dsl";
import { OpenCodeRuntime, createMockRuntime } from "@swarm/agent-runtime";

const here = dirname(fileURLToPath(import.meta.url));
const runtimeDir = resolve(here, "../runtime");
const args = process.argv.slice(2);
const mock = args.includes("--mock");
const briefIndex = args.indexOf("--brief");
const brief =
  (briefIndex >= 0 ? args[briefIndex + 1] : undefined) ??
  "Landing page para uma ferramenta de IA que transforma briefs em páginas prontas, com tom premium e foco em conversão.";

const runtime = mock
  ? createMockRuntime()
  : new OpenCodeRuntime({ runtimeDir, port: Number(process.env.SWARM_OPENCODE_PORT ?? 4097) });

const started = performance.now();
try {
  console.log(`[spike] runtime=${runtime.name} mock=${mock}`);
  const planStart = performance.now();
  const planned = await runtime.plan({ brief });
  const plan = normalizePlan(BuildPlanSchema.parse(planned.plan));
  console.log(
    `[spike] plan ok in ${Math.round(performance.now() - planStart)}ms: "${plan.title}" (${plan.sections.length} sections)`,
  );

  const section = plan.sections[0];
  if (!section) throw new Error("plan has no sections");
  const sectionStart = performance.now();
  const built = await runtime.buildSection({ plan, section, parentSessionId: planned.sessionId });
  const patch = SectionPatchSchema.parse(built.patch);
  console.log(
    `[spike] section ok in ${Math.round(performance.now() - sectionStart)}ms: ${patch.sectionId} (${patch.node.children?.length ?? 0} children)`,
  );
  console.log(JSON.stringify({ plan, patch }, null, 2));
  console.log(`[spike] done in ${Math.round(performance.now() - started)}ms`);
} catch (error) {
  console.error("[spike] failed", error);
  process.exitCode = 1;
} finally {
  await runtime.close();
}
