/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0f0f0f",
          surface: "#1a1a1a",
          card: "#1e1e1e",
          hover: "#252525",
        },
        accent: {
          green: "#22c55e",
          amber: "#f59e0b",
          red: "#ef4444",
          blue: "#3b82f6",
        },
        border: {
          DEFAULT: "#2a2a2a",
          subtle: "#222222",
        },
      },
    },
  },
  plugins: [],
};
