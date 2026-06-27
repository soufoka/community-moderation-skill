import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['skills/community-moderation/tests/**/*.test.ts'],
    environment: 'node',
  },
});
