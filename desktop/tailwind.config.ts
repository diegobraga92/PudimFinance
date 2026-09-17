import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Design tokens live as RGB-triplet CSS variables in `src/index.css`, so both
 * light and dark themes share the same Tailwind color scale. Each color below
 * is consumed as `rgb(var(--token) / <alpha-value>)`.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1440px' },
    },
    extend: {
      colors: {
        border: 'rgb(var(--border) / <alpha-value>)',
        input: 'rgb(var(--input) / <alpha-value>)',
        ring: 'rgb(var(--ring) / <alpha-value>)',
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-hover': 'rgb(var(--surface-hover) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        'muted-foreground': 'rgb(var(--muted-foreground) / <alpha-value>)',
        dim: 'rgb(var(--dim) / <alpha-value>)',
        primary: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          foreground: 'rgb(var(--primary-foreground) / <alpha-value>)',
          hover: 'rgb(var(--primary-hover) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          foreground: 'rgb(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'rgb(var(--destructive) / <alpha-value>)',
          foreground: 'rgb(var(--destructive-foreground) / <alpha-value>)',
        },
        income: 'rgb(var(--income) / <alpha-value>)',
        expense: 'rgb(var(--expense) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        success: {
          DEFAULT: 'rgb(var(--success) / <alpha-value>)',
          foreground: 'rgb(var(--success-foreground) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--danger) / <alpha-value>)',
          foreground: 'rgb(var(--danger-foreground) / <alpha-value>)',
        },
        purple: 'rgb(var(--purple) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        'surface-elevated': 'rgb(var(--surface-elevated) / <alpha-value>)',
      },
      /**
       * Radius scale: cards sit at 16px (`rounded-lg`), controls/buttons at 8px
       * (`rounded-md`), chips/nav pills at 6px (`rounded-sm`). Inner panels such
       * as the dashed empty state use an explicit `rounded-[12px]`.
       */
      borderRadius: {
        xl: 'calc(var(--radius) + 4px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 8px)',
        sm: 'calc(var(--radius) - 10px)',
      },
      /**
       * Plus Jakarta Sans is bundled through `@fontsource-variable` (imported in
       * `main.tsx`), so the app never depends on a system font being installed.
       * Its `$`/`R$` glyphs are evenly proportioned and it ships tabular figures
       * (`tnum`), which every money column relies on.
       */
      fontFamily: {
        sans: [
          '"Plus Jakarta Sans Variable"',
          '"Plus Jakarta Sans"',
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        popover: '0 10px 38px -10px rgb(0 0 0 / 0.12), 0 8px 20px -15px rgb(0 0 0 / 0.18)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(8px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-in-from-right': {
          from: { transform: 'translateX(12%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-in-from-left': {
          from: { transform: 'translateX(-12%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-in-right': 'slide-in-right 180ms ease-out',
        'slide-in-from-right': 'slide-in-from-right 200ms ease-out',
        'slide-in-from-left': 'slide-in-from-left 200ms ease-out',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
