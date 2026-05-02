-- Fix: the FOR ALL policy on workflow_permissions still causes recursion
-- because FOR ALL covers SELECT, and any SELECT on workflow_permissions
-- triggers the policy which calls is_workflow_admin() — even though it's
-- SECURITY DEFINER, the *outer* policy evaluation still recurses.
--
-- Solution: Drop all policies and recreate with explicit per-operation policies.
-- SELECT only checks user_id = auth.uid() (no subquery on self).
-- INSERT/UPDATE/DELETE use the SECURITY DEFINER helper or workflow ownership.

-- Drop all existing policies on workflow_permissions
DROP POLICY IF EXISTS "Users can view their own workflow permissions" ON public.workflow_permissions;
DROP POLICY IF EXISTS "Admins can manage workflow permissions" ON public.workflow_permissions;
DROP POLICY IF EXISTS "Workflow owners can manage permissions" ON public.workflow_permissions;

-- Idempotency: drop the new wp_* policies before recreating, in case
-- a prior partial run / SQL-editor application already created them.
DROP POLICY IF EXISTS "wp_select" ON public.workflow_permissions;
DROP POLICY IF EXISTS "wp_insert" ON public.workflow_permissions;
DROP POLICY IF EXISTS "wp_update" ON public.workflow_permissions;
DROP POLICY IF EXISTS "wp_delete" ON public.workflow_permissions;

-- SELECT: Users can see permissions for workflows they own or permissions granted to them
CREATE POLICY "wp_select"
  ON public.workflow_permissions
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_permissions.workflow_id
        AND w.user_id = auth.uid()
    )
  );

-- INSERT: Workflow owners or existing admins can grant permissions
CREATE POLICY "wp_insert"
  ON public.workflow_permissions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_id
        AND w.user_id = auth.uid()
    )
    OR public.is_workflow_admin(workflow_id, auth.uid())
  );

-- UPDATE: Workflow owners or existing admins can update permissions
CREATE POLICY "wp_update"
  ON public.workflow_permissions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_permissions.workflow_id
        AND w.user_id = auth.uid()
    )
    OR public.is_workflow_admin(workflow_permissions.workflow_id, auth.uid())
  );

-- DELETE: Workflow owners or existing admins can revoke permissions
CREATE POLICY "wp_delete"
  ON public.workflow_permissions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_permissions.workflow_id
        AND w.user_id = auth.uid()
    )
    OR public.is_workflow_admin(workflow_permissions.workflow_id, auth.uid())
  );

NOTIFY pgrst, 'reload schema';
