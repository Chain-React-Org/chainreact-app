/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  testMatch: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
  // Infra-bound tests require the Docker stack from docker-compose.test.yml.
  // They live under __tests__/infra/ and have a `.infra.test.ts` suffix; the
  // default suite skips them so `npm run test:all` works without Docker.
  // Run them via `npm run test:infra` instead. PR-E.
  testPathIgnorePatterns: ["/node_modules/", "/__tests__/infra/"],
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
  setupFilesAfterEnv: ["<rootDir>/test/setup/workflowsV2.ts"],
  collectCoverageFrom: [
    "lib/workflows/variableReferences.ts",
    "lib/workflows/variableResolution.ts",
    "lib/workflows/actions/core/resolveValue.ts",
    "lib/workflows/ai-agent/providerSwapping.ts",
    "lib/workflows/ai-agent/templateMatching.ts",
    "lib/integrations/errorClassificationService.ts",
    "lib/integrations/tokenRefreshService.ts",
    "lib/utils/fetch-with-timeout.ts",
    "lib/security/encryption.ts",
  ],
}
