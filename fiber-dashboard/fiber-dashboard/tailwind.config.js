/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "var(--color-bg)",
          surface: "var(--color-bg-surface)",
          card: "var(--color-bg-card)",
          hover: "var(--color-bg-hover)",
        },
        accent: {
          green: "#22c55e",
          amber: "#f59e0b",
          red: "#ef4444",
          blue: "#3b82f6",
        },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          subtle: "var(--color-border-subtle)",
        },
      },
    },
  },
  plugins: [],
};
