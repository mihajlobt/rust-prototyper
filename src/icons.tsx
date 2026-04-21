// Shared icon set — tiny inline SVGs, 14px default.
import type { SVGProps, ReactNode, JSX } from "react";

interface IconProps {
  d: string | ReactNode;
  size?: number;
  fill?: string;
  stroke?: string;
  sw?: number;
  style?: React.CSSProperties;
}

const I = ({ d, size = 14, fill = "none", stroke = "currentColor", sw = 1.6, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}>
    {typeof d === "string" ? <path d={d} /> : d}
  </svg>
);

type IconComponent = (p: Partial<IconProps> & { size?: number; style?: React.CSSProperties }) => JSX.Element;

export const Icons = {
  input:      (p) => <I {...p} d="M4 12h12M12 8l4 4-4 4M20 4v16" />,
  output:     (p) => <I {...p} d="M20 12H8M12 8l-4 4 4 4M4 4v16" />,
  sparkles:   (p) => <I {...p} d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3zM19 15l.8 1.7L21 18l-1.7.8L18.5 21l-.8-1.2L16 18l1.7-1.3L18.5 15zM5 3l.6 1.3L7 5l-1.4.7L5 7l-.6-1.3L3 5l1.4-.7L5 3z" />,
  list:       (p) => <I {...p} d="M4 6h16M4 12h16M4 18h12" />,
  palette:    (p) => <I {...p} d="M12 3a9 9 0 100 18h1a2 2 0 000-4h-1a2 2 0 010-4h3a4 4 0 004-4v-1A5 5 0 0014 3h-2z" />,
  cube:       (p) => <I {...p} d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9" />,
  flow:       (p) => <I {...p} d="M6 4h4v4H6zM14 10h4v4h-4zM6 16h4v4H6zM10 6h8M10 18h8M18 8v8" />,
  chip:       (p) => <I {...p} d="M5 5h14v14H5zM8 8h8v8H8zM2 9v6M22 9v6M9 2h6M9 22h6" />,
  play:       (p) => <I {...p} d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none" />,
  stop:       (p) => <I {...p} d="M6 6h12v12H6z" fill="currentColor" stroke="none" />,
  save:       (p) => <I {...p} d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 14h8" />,
  search:     (p) => <I {...p} d="M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.5-4.5" />,
  plus:       (p) => <I {...p} d="M12 5v14M5 12h14" />,
  trash:      (p) => <I {...p} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  folder:     (p) => <I {...p} d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" />,
  file:       (p) => <I {...p} d="M6 3h8l5 5v13H6zM14 3v5h5" />,
  dots:       (p) => <I {...p} d="M5 12h.01M12 12h.01M19 12h.01" sw={3} />,
  chevR:      (p) => <I {...p} d="M9 6l6 6-6 6" />,
  chevD:      (p) => <I {...p} d="M6 9l6 6 6-6" />,
  x:          (p) => <I {...p} d="M6 6l12 12M18 6L6 18" />,
  check:      (p) => <I {...p} d="M5 12l5 5 10-11" />,
  cog:        (p) => <I {...p} d="M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 13.5l1.6.9-2 3.5-1.9-.5a7 7 0 01-1.9 1.1l-.3 2h-4l-.3-2a7 7 0 01-1.9-1.1l-1.9.5-2-3.5 1.6-.9a7 7 0 010-2.2L3 10.4l2-3.5 1.9.5a7 7 0 011.9-1.1l.3-2h4l.3 2a7 7 0 011.9 1.1l1.9-.5 2 3.5-1.6.9a7 7 0 010 2.2z" />,
  zap:        (p) => <I {...p} d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  link:       (p) => <I {...p} d="M10 14a4 4 0 005.6 0l3-3a4 4 0 00-5.6-5.6l-1 1M14 10a4 4 0 00-5.6 0l-3 3a4 4 0 005.6 5.6l1-1" />,
  cpu:        (p) => <I {...p} d="M5 7a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V7zM9 9h6v6H9zM2 10v4M22 10v4M10 2h4M10 22h4" />,
  terminal:   (p) => <I {...p} d="M3 4h18v16H3zM7 9l3 3-3 3M13 15h5" />,
  layers:     (p) => <I {...p} d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 18l9 5 9-5" />,
  grid:       (p) => <I {...p} d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  split:      (p) => <I {...p} d="M4 4h7v16H4zM13 4h7v16h-7z" />,
  eye:        (p) => <I {...p} d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z" />,
  fit:        (p) => <I {...p} d="M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6" />,
  zoomIn:     (p) => <I {...p} d="M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.5-4.5M8 11h6M11 8v6" />,
  zoomOut:    (p) => <I {...p} d="M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.5-4.5M8 11h6" />,
  branch:     (p) => <I {...p} d="M6 3v18M18 3a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3zM18 9v2a4 4 0 01-4 4h-4a4 4 0 00-4 4M6 6a3 3 0 100-6 3 3 0 000 6zM6 24a3 3 0 100-6 3 3 0 000 6z" sw={1.4} />,
  book:       (p) => <I {...p} d="M4 5a2 2 0 012-2h12v18H6a2 2 0 01-2-2V5zM4 17a2 2 0 012-2h12" />,
  db:         (p) => <I {...p} d="M4 6c0-1.5 3.6-3 8-3s8 1.5 8 3-3.6 3-8 3-8-1.5-8-3zM4 6v6c0 1.5 3.6 3 8 3s8-1.5 8-3V6M4 12v6c0 1.5 3.6 3 8 3s8-1.5 8-3v-6" />,
  send:       (p) => <I {...p} d="M4 12l16-8-6 18-3-7-7-3z" />,
  dot:        (p) => <I {...p} d="M12 12h.01" sw={4} />,
  clip:       (p) => <I {...p} d="M21 11l-9.5 9.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-9.5 9.5a2 2 0 01-3-3L15 7" />,
  image:      (p) => <I {...p} d="M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4" />,
  copy:       (p) => <I {...p} d="M8 8h11v13H8zM5 5v12M5 5h11" />,
  upload:     (p) => <I {...p} d="M12 15V4M7 9l5-5 5 5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />,
} satisfies Record<string, IconComponent>;

export default Icons;
