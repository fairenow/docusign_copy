import plugin from 'tailwindcss/plugin'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        signature: ['"Brush Script MT"', 'cursive'],
      }
    },
  },
  plugins: [
    // Touch screens: bigger drag handles (built into Tailwind 4, not 3)
    plugin(({ addVariant }) => addVariant('pointer-coarse', '@media (pointer: coarse)'))
  ],
}
