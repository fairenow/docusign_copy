import plugin from 'tailwindcss/plugin'
import defaultTheme from 'tailwindcss/defaultTheme'

/**
 * FLMLNK Sign design tokens. The whole app is written with Tailwind's gray-* and blue-*
 * names, so the premium palette is defined here once: a cool "ink" neutral for gray and a
 * deep cobalt accent for blue. Changing a value here restyles every screen consistently.
 */
const ink = {
  50: '#f8f9fb',
  100: '#f1f3f6',
  200: '#e5e8ee',
  300: '#d1d6df',
  400: '#99a1b2',
  500: '#687185',
  600: '#4a5367',
  700: '#353d50',
  800: '#1f2637',
  900: '#0f1523',
  950: '#080b14'
}

const cobalt = {
  50: '#f0f3ff',
  100: '#e1e7ff',
  200: '#c7d2fe',
  300: '#a1b1fc',
  400: '#7486f7',
  500: '#5063ef',
  600: '#3b4ae0',
  700: '#2f3bc2',
  800: '#29339c',
  900: '#26307b',
  950: '#171c48'
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        gray: ink,
        blue: cobalt,
        ink
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', ...defaultTheme.fontFamily.sans],
        // Page titles and big moments (sign-in, "You're done")
        display: ['"Instrument Serif"', 'ui-serif', 'Georgia', 'serif']
      },
      boxShadow: {
        // Soft, layered shadows: a hairline plus a wide, faint spread
        xs: '0 1px 2px rgba(15, 21, 35, 0.05)',
        sm: '0 1px 2px rgba(15, 21, 35, 0.06), 0 1px 3px rgba(15, 21, 35, 0.04)',
        DEFAULT: '0 1px 2px rgba(15, 21, 35, 0.05), 0 4px 12px -2px rgba(15, 21, 35, 0.06)',
        md: '0 2px 4px rgba(15, 21, 35, 0.04), 0 8px 20px -4px rgba(15, 21, 35, 0.08)',
        lg: '0 4px 8px -2px rgba(15, 21, 35, 0.05), 0 16px 36px -8px rgba(15, 21, 35, 0.14)',
        xl: '0 8px 16px -4px rgba(15, 21, 35, 0.06), 0 28px 56px -12px rgba(15, 21, 35, 0.2)',
        '2xl': '0 32px 72px -16px rgba(15, 21, 35, 0.3)',
        card: '0 0 0 1px rgba(15, 21, 35, 0.06), 0 1px 2px rgba(15, 21, 35, 0.04), 0 4px 14px -4px rgba(15, 21, 35, 0.06)',
        button: 'inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 2px rgba(8, 11, 20, 0.2), 0 2px 6px -2px rgba(8, 11, 20, 0.25)',
        focus: '0 0 0 3px rgba(80, 99, 239, 0.28)'
      },
      borderRadius: {
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.125rem'
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': { from: { opacity: '0', transform: 'translateY(4px) scale(0.98)' }, to: { opacity: '1', transform: 'none' } },
        'sheet-up': { from: { transform: 'translateY(24px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        'toast-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } }
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out both',
        'pop-in': 'pop-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'sheet-up': 'sheet-up 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'toast-in': 'toast-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both'
      }
    },
  },
  plugins: [
    // Touch screens: bigger drag handles (built into Tailwind 4, not 3)
    plugin(({ addVariant }) => addVariant('pointer-coarse', '@media (pointer: coarse)'))
  ],
}
