/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ochre: "var(--ochre)",
        ink: "var(--ink)",
        paper: "var(--paper)",
        sand: "var(--sand)",
        muted: "var(--muted)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Montserrat", "sans-serif"],
        body: ["var(--font-body)", "Montserrat", "sans-serif"],
      },
    },
  },
  plugins: [],
};
