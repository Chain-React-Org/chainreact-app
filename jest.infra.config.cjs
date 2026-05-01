/**
 * Jest config for infrastructure-bound tests (PR-E).
 *
 * Discovers `*.infra.test.ts` files under `__tests__/infra/`. These
 * tests require the docker-compose.test.yml stack to be running:
 *   npm run test:infra:up
 *   npm run test:infra
 *   npm run test:infra:down
 *
 * The default jest config (jest.config.cjs) deliberately ignores the
 * `infra/` directory so `npm run test:all` doesn't fail when Docker
 * isn't running. CI runs both configs as separate jobs.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__/infra"],
  testMatch: ["**/*.infra.test.ts"],
  transform: {
    "^.+\\.(t|j)sx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.json",
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  // Infra tests open real network connections. A worker leak that
  // doesn't shut down a `pg.Client` cleanly would normally hang Jest;
  // forceExit=true is the pragmatic choice.
  forceExit: true,
  // Single worker so the shared MailHog message queue + stripe-mock
  // singleton don't contend with each other across tests.
  maxWorkers: 1,
}
