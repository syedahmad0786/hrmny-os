/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ochre: "#E47300",
        ink: "#0A0908",
        paper: "#F7F4EF",
        sand: "#E8E0D4",
        muted: "#6B6560",
      },
      fontFamily: {
        display: ["var(--font-display)", "Montserrat", "sans-serif"],
        body: ["var(--font-body)", "Montserrat", "sans-serif"],
      },
    },
  },
  plugins: [],
};
