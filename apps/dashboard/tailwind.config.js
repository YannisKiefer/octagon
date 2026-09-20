/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Backed by the CSS custom properties in app/globals.css.
        canvas: "var(--bg-window)",
        sidebar: "var(--bg-sidebar)",
        surface: "var(--bg-surface)",
        raised: "var(--bg-raised)",
        hover: "var(--bg-hover)",
        selected: "var(--bg-selected)",
        ink: {
          DEFAULT: "var(--text-primary)",
          dim: "var(--text-secondary)",
          mute: "var(--text-muted)",
        },
        hairline: "var(--border-subtle)",
        "hairline-strong": "var(--border-strong)",
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          soft: "var(--accent-soft)",
        },
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--error)",
      },
      fontFamily: {
        sans: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif",
      },
      borderRadius: {
        control: "var(--radius-control)",
        card: "var(--radius-card)",
        composer: "var(--radius-composer)",
      },
    },
  },
  plugins: [],
}
