import { handleRouteError, parseJsonBody } from "@/lib/api/responses";
import { getOrCreateDemoUser } from "@/lib/demo-user";
import { interactionService } from "@/lib/interactions";
import { recordInteractionSchema } from "@/lib/interactions/schemas";

export const dynamic = "force-dynamic";

export interface RecordInteractionResponse {
  interaction: {
    id: string;
    projectId: string;
    type: string;
    weight: number;
    dwellMs: number | null;
    createdAt: string;
  };
  session: {
    id: string;
    startedAt: string;
    lastActiveAt: string;
    created: boolean;
  };
}

/**
 * POST /api/interactions — record a behavioural signal for the demo user.
 * The client sends `projectId`, `type` and optionally `dwellMs`; the server
 * resolves the user and the active session and applies the configured weight.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = recordInteractionSchema.parse(await parseJsonBody(request));
    const user = await getOrCreateDemoUser();
    const result = await interactionService.record({
      userId: user.id,
      projectId: body.projectId,
      type: body.type,
      dwellMs: body.dwellMs ?? null,
    });
    const response: RecordInteractionResponse = {
      interaction: {
        id: result.interaction.id,
        projectId: result.interaction.projectId,
        type: result.interaction.type,
        weight: result.interaction.weight,
        dwellMs: result.interaction.dwellMs,
        createdAt: result.interaction.createdAt.toISOString(),
      },
      session: {
        id: result.session.id,
        startedAt: result.session.startedAt.toISOString(),
        lastActiveAt: result.session.lastActiveAt.toISOString(),
        created: result.sessionCreated,
      },
    };
    return Response.json(response, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
