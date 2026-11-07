import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serves the site from https://<user>.github.io/acoustic-modem/
  base: '/acoustic-modem/',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
