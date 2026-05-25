/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        sidebar: "var(--color-sidebar)",
        surface: "var(--color-surface)",
        "surface-secondary": "var(--color-surface-secondary)",
        border: "var(--color-border)",
        "border-light": "var(--color-border-light)",
        accent: "#007AFF",
        "accent-hover": "#0056CC",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-tertiary": "var(--color-text-tertiary)",
        success: "#34C759",
        warning: "#FF9500",
        error: "#FF3B30",
        info: "#5AC8FA",
        orange: "#FF9500",
        purple: "#AF52DE",
        teal: "#5AC8FA",
      },
      boxShadow: {
        "apple-sm": "0 1px 3px var(--shadow-color, rgba(0,0,0,0.06))",
        apple: "0 2px 8px var(--shadow-color, rgba(0,0,0,0.08))",
        "apple-lg": "0 4px 16px var(--shadow-color, rgba(0,0,0,0.1))",
      },
      borderRadius: {
        apple: "10px",
        "apple-lg": "14px",
      },
    },
  },
  plugins: [],
};
