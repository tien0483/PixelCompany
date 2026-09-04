import { NextRequest, NextResponse } from "next/server";
import { requireJsonContentType } from "@/lib/security/host-validation";
import { buildDiffEditPrompt, buildEditPrompt } from "@/lib/templates/build-edit-prompt";
import { loadSkill } from "@/lib/templates/loader";
import { assemblePrompt } from "@/lib/templates/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  templateId: string;
  content: string;
  format?: string;
  /** Prior HTML + prior content → diff-edit prompt instead of full assemble. */
  editFromHtml?: string;
  editFromContent?: string;
  /**
   * Prior HTML + a unified diff of the source document → the leaner diff-edit prompt. Preferred
   * over `editFromContent`, which makes the model derive the delta from two full documents.
   */
  editDiff?: string;
};

/**
 * Template + prompt service only. The PixelOffice runtime invokes the agent;
 * this route never spawns a CLI.
 */
export async function POST(req: NextRequest) {
  const contentTypeError = requireJsonContentType(req);
  if (contentTypeError) return contentTypeError;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  const {
    templateId,
    content,
    format = "text",
    editFromHtml,
    editFromContent,
    editDiff,
  } = body;
  if (!templateId || !content) {
    return new Response("missing required fields: templateId, content", {
      status: 400,
    });
  }
  const skill = loadSkill(templateId);
  if (!skill) {
    return new Response(`unknown template: ${templateId}`, { status: 400 });
  }

  const prompt =
    editFromHtml && editDiff
      ? buildDiffEditPrompt({
          templateName: skill.zhName,
          templateAspect: skill.aspectHint,
          diff: editDiff,
          oldHtml: editFromHtml,
          format,
        })
      : editFromHtml && editFromContent
      ? buildEditPrompt({
          templateName: skill.zhName,
          templateAspect: skill.aspectHint,
          newContent: content,
          oldContent: editFromContent,
          oldHtml: editFromHtml,
          format,
        })
      : assemblePrompt({
          body: skill.body,
          content,
          format,
          designDirectives: skill.designDirectives,
          language: skill.language,
          allowRead: skill.allowRead,
        });

  return NextResponse.json({
    prompt,
    template: {
      id: skill.id,
      zhName: skill.zhName,
      enName: skill.enName,
      emoji: skill.emoji,
      description: skill.description,
      category: skill.category,
      scenario: skill.scenario,
      aspectHint: skill.aspectHint,
      featured: skill.featured,
      recommended: skill.recommended,
      tags: skill.tags,
      // The runtime turns this into an explicit `--allowedTools` list, so it has
      // to travel with the prompt rather than staying a server-side detail.
      allowRead: skill.allowRead,
      example: skill.example,
    },
  });
}
