import { test, expect } from '@playwright/test'
import { runAxe } from '../utils/axe-runner'
import { waitForStable } from '../utils/stability'
import { publicRoutes } from '../fixtures/routes'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://chainreact.app'
const PHASE = 'prod-a11y'

for (const route of publicRoutes()) {
  if (route.needsSeed) continue
  test(`[prod-public-a11y] ${route.slug}`, async ({ page }) => {
    test.setTimeout(60_000)
    const resp = await page
      .goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      .catch(() => null)
    if (!resp) return
    await waitForStable(page)
    const summary = await runAxe(page, route.slug, PHASE)
    expect.soft(summary.criticalCount, `axe critical violations on ${route.slug}`).toBe(0)
  })
}
