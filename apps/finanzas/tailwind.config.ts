import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0d1117',
        panel: '#151b23',
        edge: '#232c38',
        muted: '#8b98a9',
        brand: '#4b93e8',
        good: '#2fa14d',
        warn: '#b87d0a',
        bad: '#e5484d',
      },
    },
  },
  plugins: [],
} satisfies Config
