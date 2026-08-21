/** @type {import('jest').Config} */
module.exports = {
  // Integration tests share one Postgres instance and include invariants
  // that only hold with a single admin account (bootstrap), so they must
  // not run across parallel workers.
  maxWorkers: 1,
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
      globalSetup: '<rootDir>/test/integration/globalSetup.js',
    },
  ],
};
