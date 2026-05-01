/**
 * Daily retention sweep for the session_side_effects table (PR-C4, Q4).
 *
 * Deletes rows whose `fired_at` is older than
 * `SESSION_SIDE_EFFECTS_RETENTION_DAYS` (default: 30). Sessions that
 * are hard-deleted from `workflow_execution_sessions` cascade their
 * idempotency rows automatically via the FK; this sweep covers
 * sessions that are kept for audit but whose side-effect markers are
 * past the retention window.
 *
 * Auth: requireCronAuth (matches CLAUDE.md Section 7 admin/cron policy).
 *
 * Design: learning/docs/session-side-effects-design.md §6.1, §7 step 4.
 */

import { NextRequest } from 'next/server'
import { jsonResponse, errorResponse } from '@/lib/utils/api-response'
import { requireCronAuth } from '@/lib/utils/cron-auth'
import { createSupabaseServiceClient } from '@/utils/supabase/server'
import { logger } from '@/lib/utils/logger'

const DEFAULT_RETENTION_DAYS = 30

export async function GET(request: NextRequest) {
  const auth = requireCronAuth(request)
  if (!auth.authorized) return auth.response

  try {
    const retentionDays =
      Number(process.env.SESSION_SIDE_EFFECTS_RETENTION_DAYS) ||
      DEFAULT_RETENTION_DAYS
    const cutoff = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString()

    logger.info('[clean-session-side-effects] Starting retention sweep', {
      retentionDays,
      cutoff,
    })

    const supabase = await createSupabaseServiceClient()
    const { data: deleted, error } = await supabase
      .from('session_side_effects')
      .delete()
      .lt('fired_at', cutoff)
      .select('id')

    if (error) {
      logger.error(
        '[clean-session-side-effects] Retention sweep failed',
        { error: error.message },
      )
      return errorResponse('Failed to clean session_side_effects', 500, {
        details: error.message,
      })
    }

    const deletedCount = deleted?.length ?? 0
    logger.info('[clean-session-side-effects] Sweep complete', {
      deletedCount,
      retentionDays,
    })

    return jsonResponse({
      success: true,
      deletedCount,
      retentionDays,
    })
  } catch (error: any) {
    logger.error('[clean-session-side-effects] Unexpected error', {
      error: error?.message,
    })
    return errorResponse('Failed to clean session_side_effects', 500, {
      details: error?.message,
    })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
