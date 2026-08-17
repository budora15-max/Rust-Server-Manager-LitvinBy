/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0f1115',
        surface: '#161920',
        accent: '#e05638',
        textMain: '#f3f4f6',
        textMuted: '#9ca3af'
      }
    },
  },
  plugins: [],
}
