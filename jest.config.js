// Jest-Harness fuer die Wissensdatenbank (bootstrap fuer den Mailagent-Modell-
// Feature-Test; vorher gab es keine Testkonfiguration). next/jest kuemmert sich
// um SWC-Transform, tsconfig-Paths und Env-Laden. Komponenten laufen unter jsdom;
// Route-Handler-Tests setzen per Docblock `@jest-environment node`.
const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
};

module.exports = createJestConfig(config);
