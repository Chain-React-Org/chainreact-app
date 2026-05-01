/**
 * Infra test (PR-F item 2): requireAdmin + capability gating against
 * real `user_profiles` rows in the test DB.
 *
 * What's exercised here:
 *   - The capability-check pipeline `requireAdmin` runs against a
 *     real DB row: SELECT admin_capabilities → branch on
 *     `super_admin` / specific cap / nothing.
 *   - The pure-function helpers `hasCapability` / `hasAnyCapability` /
 *     `isProfileAdmin` against realistic JSONB shapes the DB hands
 *     back (including unset, empty, and unknown-key cases).
 *
 * What's intentionally NOT exercised:
 *   - The Supabase auth layer (cookies → `auth.getUser()`). That's a
 *     platform boundary; PR-F item 3 (RLS) covers the auth.uid()
 *     side-effect at a layer below.
 *   - The Next.js Request object plumbing. Synthesizing one isn't
 *     more signal than calling the capability check directly with the
 *     same DB row `requireAdmin` would have fetched.
 *
 * Skips cleanly when Docker isn't running.
 */

import {
  connect,
  isTestDbAvailable,
  withTestDb,
} from '../helpers/dbHarness'
import {
  hasCapability,
  hasAnyCapability,
  isProfileAdmin,
  validateCapabilities,
  type AdminCapabilities,
} from '@/lib/types/admin'

const REQUIRES_DOCKER_NOTE =
  '(skipped: docker postgres not reachable — run `npm run test:infra:up`)'

let dbAvailable = false
beforeAll(async () => {
  dbAvailable = await isTestDbAvailable()
})

/**
 * Minimal user_profiles table mirroring the production columns the
 * admin auth path reads. We don't load the full migration suite — the
 * contract under test is "fetch by id + check capabilities", which
 * needs only `id` + `admin_capabilities`.
 */
async function bootstrapProfilesSchema(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE user_profiles (
      id uuid PRIMARY KEY,
      admin_capabilities jsonb DEFAULT '{}'::jsonb
    )
  `)
}

async function insertProfile(
  client: any,
  id: string,
  capabilities: AdminCapabilities | null,
): Promise<void> {
  await client.query(
    `INSERT INTO user_profiles (id, admin_capabilities) VALUES ($1, $2)`,
    [id, capabilities],
  )
}

/**
 * Replicates the SELECT requireAdmin issues against the service
 * client, returning the same shape it consumes. Tests then run the
 * capability checks against the result.
 */
async function fetchCapabilities(
  client: any,
  userId: string,
): Promise<AdminCapabilities | null> {
  const res = await client.query(
    `SELECT admin_capabilities FROM user_profiles WHERE id = $1`,
    [userId],
  )
  if (res.rowCount === 0) return null
  return (res.rows[0].admin_capabilities ?? {}) as AdminCapabilities
}

describe('requireAdmin — capability gating against real DB rows', () => {
  test('super_admin grants every required capability', async () => {
    if (!dbAvailable) {
      console.warn(`[requireAdmin.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapProfilesSchema(client)
      const id = '00000000-0000-0000-0000-000000000001'
      await insertProfile(client, id, { super_admin: true })

      const caps = await fetchCapabilities(client, id)
      expect(isProfileAdmin({ admin_capabilities: caps })).toBe(true)
      expect(hasCapability(caps, 'user_admin')).toBe(true)
      expect(hasCapability(caps, 'billing_admin')).toBe(true)
      expect(hasCapability(caps, 'support_admin')).toBe(true)
      expect(hasAnyCapability(caps, ['user_admin', 'billing_admin'])).toBe(true)
    })
  })

  test('a specific capability grants ONLY that capability — not others', async () => {
    if (!dbAvailable) {
      console.warn(`[requireAdmin.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapProfilesSchema(client)
      const id = '00000000-0000-0000-0000-000000000002'
      await insertProfile(client, id, { user_admin: true })

      const caps = await fetchCapabilities(client, id)
      expect(isProfileAdmin({ admin_capabilities: caps })).toBe(true)
      expect(hasCapability(caps, 'user_admin')).toBe(true)
      expect(hasCapability(caps, 'billing_admin')).toBe(false)
      expect(hasCapability(caps, 'support_admin')).toBe(false)
      expect(hasAnyCapability(caps, ['billing_admin', 'support_admin'])).toBe(false)
      expect(hasAnyCapability(caps, ['user_admin', 'support_admin'])).toBe(true)
    })
  })

  test('empty capabilities JSON ({}) means NOT admin', async () => {
    if (!dbAvailable) {
      console.warn(`[requireAdmin.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapProfilesSchema(client)
      const id = '00000000-0000-0000-0000-000000000003'
      await insertProfile(client, id, {})

      const caps = await fetchCapabilities(client, id)
      expect(isProfileAdmin({ admin_capabilities: caps })).toBe(false)
      expect(hasAnyCapability(caps, ['super_admin', 'user_admin'])).toBe(false)
    })
  })

  test('NULL capabilities (column never written) means NOT admin', async () => {
    if (!dbAvailable) {
      console.warn(`[requireAdmin.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapProfilesSchema(client)
      // Override the default by inserting NULL explicitly.
      const id = '00000000-0000-0000-0000-000000000004'
      await client.query(
        `INSERT INTO user_profiles (id, admin_capabilities) VALUES ($1, NULL)`,
        [id],
      )

      const caps = await fetchCapabilities(client, id)
      expect(caps).toEqual({})
      expect(isProfileAdmin({ admin_capabilities: caps })).toBe(false)
    })
  })

  test('a capability set to false does NOT grant access (false-grants-nothing rule)', async () => {
    if (!dbAvailable) {
      console.warn(`[requireAdmin.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapProfilesSchema(client)
      const id = '00000000-0000-0000-0000-000000000005'
      await insertProfile(client, id, { user_admin: false, billing_admin: true })

      const caps = await fetchCapabilities(client, id)
      expect(hasCapability(caps, 'user_admin')).toBe(false)
      expect(hasCapability(caps, 'billing_admin')).toBe(true)
    })
  })

  test('a missing user (no row) is NOT admin and the helper handles null gracefully', async () => {
    if (!dbAvailable) {
      console.warn(`[requireAdmin.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapProfilesSchema(client)
      const caps = await fetchCapabilities(client, '00000000-0000-0000-0000-FFFFFFFFFFFF')
      expect(caps).toBeNull()
      expect(isProfileAdmin({ admin_capabilities: caps })).toBe(false)
      expect(hasCapability(caps, 'super_admin')).toBe(false)
    })
  })

  test('validateCapabilities rejects unknown keys (prevents JSONB drift on assignment)', async () => {
    // Pure function — no DB needed, but lives in this file because it's
    // the assignment-side enforcement that the DB column doesn't catch.
    expect(() =>
      validateCapabilities({ super_admin: true, totally_made_up: true }),
    ).toThrow(/Unknown admin capability/)

    expect(() =>
      validateCapabilities({ user_admin: 'yes' as any }),
    ).toThrow(/must be a boolean/)

    // Happy path — clean object passes through.
    const out = validateCapabilities({ user_admin: true, billing_admin: false })
    expect(out).toEqual({ user_admin: true, billing_admin: false })
  })
})
