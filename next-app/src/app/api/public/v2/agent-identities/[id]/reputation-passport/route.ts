import {
  apiSuccess,
  corsHeaders,
  handleApiError,
} from '@/lib/api-utils';
import prisma from '@/lib/db/client';
import {
  getReputationPassport,
  ReputationPassportError,
} from '@/lib/reputation/reputation-passport.mjs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  void request;

  try {
    const { id } = await params;
    const passport = await getReputationPassport(prisma, {
      agentIdentityId: id,
    });
    return apiSuccess(passport);
  } catch (error) {
    if (
      error instanceof ReputationPassportError &&
      error.code === 'REPUTATION_PASSPORT_AGENT_NOT_FOUND'
    ) {
      return Response.json(
        { error: 'AgentIdentity 不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
