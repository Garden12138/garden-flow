/** @type {import('tailwindcss').Config} */
const semanticColor = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // We'll control dark mode manually or via system preference class
  theme: {
    extend: {
      // The app root is 14px. Use explicit text sizes so rem-based defaults do not shrink controls.
      fontSize: {
        xs: ['12px', { lineHeight: '18px' }],
        sm: ['14px', { lineHeight: '21px' }],
        base: ['14px', { lineHeight: '22px' }],
        lg: ['18px', { lineHeight: '26px' }],
        xl: ['20px', { lineHeight: '28px' }],
        '2xl': ['24px', { lineHeight: '32px' }],
        '3xl': ['30px', { lineHeight: '36px' }],
      },
      colors: {
        // Semantic names based on theme.md
        background: semanticColor('--color-background'),
        surface: {
          primary: semanticColor('--color-surface-primary'),
          secondary: semanticColor('--color-surface-secondary'),
          elevated: semanticColor('--color-surface-elevated'),
        },
        border: semanticColor('--color-border'),
        divider: semanticColor('--color-divider'),
        text: {
          primary: semanticColor('--color-text-primary'),
          secondary: semanticColor('--color-text-secondary'),
          tertiary: semanticColor('--color-text-tertiary'),
        },
        accent: {
          primary: semanticColor('--color-accent-primary'),
          hover: semanticColor('--color-accent-hover'),
          muted: semanticColor('--color-accent-muted'),
          secondary: semanticColor('--color-accent-secondary'),
          'secondary-muted': semanticColor('--color-accent-secondary-muted'),
          gold: semanticColor('--color-accent-gold'),
        },
        status: {
          success: semanticColor('--color-status-success'),
          warning: semanticColor('--color-status-warning'),
          error: semanticColor('--color-status-error'),
        },
        brand: {
          iris: semanticColor('--color-brand-iris'),
          leaf: semanticColor('--color-brand-leaf'),
          gold: semanticColor('--color-brand-gold'),
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"Noto Sans SC"', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', "Liberation Mono", "Courier New", 'monospace'],
      }
    },
  },
  plugins: [],
}
