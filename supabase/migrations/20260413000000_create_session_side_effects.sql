-- PR-C4 — within-session idempotency registry for action handlers.
--
-- Records "this side effect already fired" markers keyed on
-- (execution_session_id, node_id, action_type). Handlers use this to
-- short-circuit replay within the same session: an engine restart, a
-- transient retry, or an explicit replay returns the cached
-- ActionResult instead of re-firing the side effect.
--
-- Design: learning/docs/session-side-effects-design.md
-- Contract: learning/docs/handler-contracts.md Q4

CREATE TABLE IF NOT EXISTS public.session_side_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_session_id text NOT NULL,
  node_id text NOT NULL,
  action_type text NOT NULL,
  provider text NOT NULL,
  external_id text,
  result_snapshot jsonb NOT NULL,
  payload_hash text NOT NULL,
  fired_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_side_effects_unique_key
    UNIQUE (execution_session_id, node_id, action_type),
  CONSTRAINT session_side_effects_session_fk
    FOREIGN KEY (execution_session_id)
    REFERENCES public.workflow_execution_sessions(id)
    ON DELETE CASCADE
);

-- Retention sweep: DELETE FROM session_side_effects WHERE fired_at < <cutoff>.
CREATE INDEX IF NOT EXISTS session_side_effects_fired_at_idx
  ON public.session_side_effects (fired_at);

-- Per-provider analytics (e.g., "how many Stripe replays in the last hour?").
CREATE INDEX IF NOT EXISTS session_side_effects_provider_fired_at_idx
  ON public.session_side_effects (provider, fired_at);

ALTER TABLE public.session_side_effects ENABLE ROW LEVEL SECURITY;

-- Service role: full access. Handlers + cron read/write via service role.
CREATE POLICY "Service role full access on session_side_effects"
  ON public.session_side_effects
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Authenticated users: SELECT-only on their own sessions' rows. Joined
-- through workflow_execution_sessions.user_id. Mirrors the parent table's
-- access model — users may inspect via admin debug tooling but never
-- write.
CREATE POLICY "Users can read own session_side_effects"
  ON public.session_side_effects
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workflow_execution_sessions s
      WHERE s.id = session_side_effects.execution_session_id
        AND s.user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
