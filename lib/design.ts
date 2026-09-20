import type { Region } from "react-native-maps";

export const DESIGN = {
  colors: {
    background: "#F6F8FB",
    surface: "#FFFFFF",
    primary: "#102A43",
    primaryDark: "#061525",
    actionBlue: "#2563EB",
    textPrimary: "#17212B",
    textSecondary: "#66788A",
    border: "#E2E8F0",
    success: "#15803D",
    danger: "#DC2626",
    warning: "#D97706",
    primarySoft: "#EAF3FF",
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
  radius: { small: 10, medium: 12, large: 14 },
} as const;

export const DEFAULT_REGION: Region = {
  latitude: 49.8209,
  longitude: 18.2625,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};
