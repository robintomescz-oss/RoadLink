// RoadLink UI foundation V1 — centralized design tokens.
// New screens should use these tokens. Existing styles are intentionally
// left untouched; adopt tokens incrementally to avoid visual regressions.

export const colors = {
  navy: "#102A43",
  blue: "#1976D2",
  actionBlue: "#2563EB",
  lightBlue: "#EAF3FF",
  background: "#F6F8FB",
  surface: "#FFFFFF",
  primaryText: "#17212B",
  secondaryText: "#66788A",
  border: "#E2E8F0",
  success: "#15803D",
  warning: "#D97706",
  danger: "#DC2626",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  input: 12,
  card: 16,
  button: 12,
} as const;

export const typography = {
  brand: { fontSize: 28, fontWeight: "bold" as const },
  screenTitle: { fontSize: 24, fontWeight: "bold" as const },
  section: { fontSize: 18, fontWeight: "600" as const },
  body: { fontSize: 15 },
  secondary: { fontSize: 13 },
  smallLabel: { fontSize: 12, fontWeight: "600" as const },
} as const;
