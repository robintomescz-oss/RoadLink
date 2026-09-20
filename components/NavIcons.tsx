import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * Konzistentní sada navigačních ikon RoadLinku.
 * Sdílí vizuální styl s ikonami Global Home (viewBox 48, stroke 3,
 * kulaté konce) — jednotná tloušťka a velikost na spodní liště.
 */
export type NavIconName = "dashboard" | "create" | "mine" | "person";

export function NavIcon({ name, color, size = 24 }: { name: NavIconName; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      {name === "dashboard" ? (
        <>
          <Rect x="7" y="7" width="14" height="14" rx="3" />
          <Rect x="27" y="7" width="14" height="14" rx="3" />
          <Rect x="7" y="27" width="14" height="14" rx="3" />
          <Rect x="27" y="27" width="14" height="14" rx="3" />
        </>
      ) : name === "mine" ? (
        <>
          <Path d="M10 10h18l10 10v18H10z" />
          <Path d="M28 10v10h10" />
          <Path d="M16 28h16" />
          <Path d="M16 35h12" />
        </>
      ) : (
        <>
          <Circle cx="24" cy="16" r="8" />
          <Path d="M9 40c0-8.3 6.7-14 15-14s15 5.7 15 14" />
        </>
      )}
    </Svg>
  );
}
