/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--color-bg) / <alpha-value>)",
        sidebar: "rgb(var(--color-sidebar) / var(--color-sidebar-alpha, 1))",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-secondary": "rgb(var(--color-surface-secondary) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        "border-light": "rgb(var(--color-border-light) / <alpha-value>)",
        accent: "#007AFF",
        "accent-hover": "#0056CC",
        "text-primary": "rgb(var(--color-text-primary) / <alpha-value>)",
        "text-secondary": "rgb(var(--color-text-secondary) / <alpha-value>)",
        "text-tertiary": "rgb(var(--color-text-tertiary) / <alpha-value>)",
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
