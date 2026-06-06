import { getDemands } from '@/lib/db/demands';
import { requireAuth, requireRole } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError } from '@/lib/api-utils';

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const roleCheck = await requireRole(request, ['supplier', 'admin']);
    if ('error' in roleCheck) return roleCheck.error;

    const demands = await getDemands({ status: 'collecting_proposals' });
    return apiSuccess(demands);
  } catch (error) {
    return handleApiError(error);
  }
}
