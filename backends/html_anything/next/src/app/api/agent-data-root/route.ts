import { findAgentDataRoot, templateSkillsDir } from "@/lib/agent-data-root";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports which agent-data root this *process* resolved, and the template-skills
 * directory it enumerates for `/api/templates`.
 *
 * Both the full app and the standalone Plan Editor package supervise a sidecar on
 * the same loopback port, and `startHtmlProcess` adopts whatever is already
 * listening there. Adoption is silent, so a full-app sidecar (86 template skills
 * from the repo's `agent-data/`) served the standalone package's picker, which
 * ships only the three papp skills. The env override the package sets
 * (`PIXELOFFICE_AGENT_DATA`) cannot help: it only reaches a process it spawned.
 * Exposing the resolved root is what lets a supervisor tell "my sidecar, already
 * up" from "someone else's sidecar, wrong templates".
 */
export function GET(): Response {
  return Response.json({
    agentDataRoot: findAgentDataRoot(),
    templateSkillsDir: templateSkillsDir(),
  });
}
