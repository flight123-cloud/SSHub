/** 简单的线条图标（16px，跟随文字颜色） */
type P = { size?: number }

function Svg(props: P & { children: React.ReactNode }) {
  const s = props.size ?? 16
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {props.children}
    </svg>
  )
}

export const IconSplitRight = (p: P) => (
  <Svg {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M8 2.5v11" />
  </Svg>
)
export const IconSplitDown = (p: P) => (
  <Svg {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M1.5 8h13" />
  </Svg>
)
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </Svg>
)
export const IconGear = (p: P) => (
  <Svg {...p}>
    <path d="M12.87 6.17 L14.86 6.61 L14.86 9.39 L12.87 9.83 L12.74 10.15 L13.83 11.87 L11.87 13.83 L10.15 12.74 L9.83 12.87 L9.39 14.86 L6.61 14.86 L6.17 12.87 L5.85 12.74 L4.13 13.83 L2.17 11.87 L3.26 10.15 L3.13 9.83 L1.14 9.39 L1.14 6.61 L3.13 6.17 L3.26 5.85 L2.17 4.13 L4.13 2.17 L5.85 3.26 L6.17 3.13 L6.61 1.14 L9.39 1.14 L9.83 3.13 L10.15 3.26 L11.87 2.17 L13.83 4.13 L12.74 5.85 Z" strokeWidth="1.2" />
    <circle cx="8" cy="8" r="2.1" />
  </Svg>
)
export const IconCommand = (p: P) => (
  <Svg {...p}>
    <path d="M6 6V4.5A1.5 1.5 0 1 0 4.5 6H6zm0 0h4M6 6v4m4-4V4.5A1.5 1.5 0 1 1 11.5 6H10zm0 0v4m0 0h1.5a1.5 1.5 0 1 1-1.5 1.5V10zm0 0H6m0 0v1.5A1.5 1.5 0 1 1 4.5 10H6z" />
  </Svg>
)
export const IconHelp = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M6.2 6.2a1.9 1.9 0 0 1 3.6.6c0 1.3-1.8 1.6-1.8 2.7" />
    <path d="M8 11.6v.1" />
  </Svg>
)
export const IconSparkle = (p: P) => (
  <Svg {...p}>
    <path d="M8 1.5l1.4 4.1 4.1 1.4-4.1 1.4L8 12.5 6.6 8.4 2.5 7l4.1-1.4z" />
    <path d="M13 11.5v3M11.5 13h3" />
  </Svg>
)
export const IconMore = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.4" />
  </Svg>
)
export const IconZoom = (p: P) => (
  <Svg {...p}>
    <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
  </Svg>
)
export const IconBolt = (p: P) => (
  <Svg {...p}>
    <path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" />
  </Svg>
)
