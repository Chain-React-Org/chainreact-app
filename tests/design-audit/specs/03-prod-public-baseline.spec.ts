import { test, expect } from '@playwright/test'
import { captureRoute } from '../utils/capture'
import { collectConsole } from '../utils/console-collector'
import { publicRoutes } from '../fixtures/routes'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://chainreact.app'
const PHASE = 'prod-baseline'

test.describe('Prod public-routes baseline', () => {
  test.describe.configure({ mode: 'serial' })

  for (const route of publicRoutes()) {
    if (route.needsSeed) continue
    test(`[prod] ${route.slug}`, async ({ page }) => {
      test.setTimeout(120_000)
      const con = collectConsole(page, route.slug, PHASE)
      const resp = await page
        .goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 25_000 })
        .catch(() => null)
      if (resp && resp.ok()) {
        await captureRoute(page, route.slug, PHASE, { watchSkeletons: false })
      }
      con.flush()
      expect(page.url()).toContain(BASE)
    })
  }
})
