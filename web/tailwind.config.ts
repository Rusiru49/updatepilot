import type { Config } from "tailwindcss";

const v = (name: string) => `var(--color-${name})`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: v("primary"), hover: v("primary-hover"), soft: v("primary-soft") },
        "on-primary": v("on-primary"),
        background: v("background"),
        surface: v("surface"),
        border: v("border"),
        foreground: v("foreground"),
        muted: v("muted"),
        success: { DEFAULT: v("success"), soft: v("success-soft") },
        info: { DEFAULT: v("info"), soft: v("info-soft") },
        warning: { DEFAULT: v("warning"), soft: v("warning-soft") },
        danger: { DEFAULT: v("danger"), soft: v("danger-soft") },
        neutral: { DEFAULT: v("neutral"), soft: v("neutral-soft") },
      },
      borderRadius: { md: "6px", lg: "10px" },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
    },
  },
} satisfies Config;