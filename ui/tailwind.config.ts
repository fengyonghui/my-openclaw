import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
        },
      },
      borderRadius: {
        xl2: '1rem',
        xl3: '1.5rem',
      },
      boxShadow: {
        soft: '0 8px 24px rgba(15, 23, 42, 0.06)',
      },
    },
  },
  plugins: [],
} satisfies Config;
