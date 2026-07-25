/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // This overrides the default sans-serif font for the entire app
        sans: ['Outfit', 'sans-serif'],
      },
      // Applivery's BlueSky design system brand scale (see src/theme.js —
      // same hex values, kept in sync). Lets Tailwind utilities like
      // bg-brand-600, text-brand-700, ring-brand-500, hover:bg-brand-700
      // work directly in className instead of only via inline style={}.
      colors: {
        brand: {
          50: '#edf2ff',
          100: '#dce7ff',
          200: '#bad0ff',
          300: '#7aaaff',
          400: '#3d79ff',
          500: '#1258ff',
          600: '#0241e3',
          700: '#0235c0',
          800: '#052a96',
          900: '#0a276e',
          950: '#071847',
        },
      },
    },
  },
  plugins: [],
}