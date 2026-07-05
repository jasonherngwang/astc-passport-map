// One stroke-drawn icon set — every glyph in the app comes from here so the
// weight and corner style stay consistent across chips, pins, and popups.

interface IconProps {
  size?: number
}

export function TicketIcon({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.4" y="7.2" width="17.2" height="9.6" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15.2 7.2v9.6" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 2.4" />
    </svg>
  )
}

export function HouseIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 11.2L12 5l7.5 6.2M6.5 10.4V18.6h11v-8.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function StarIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.3l2.6 5.2 5.8.85-4.2 4.1 1 5.75L12 16.5l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CheckIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.6l4.4 4.2L19 7.2"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function IdCardIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5.5" width="18" height="13" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8.4" cy="11" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6.2 15.4c.55-1.5 3.85-1.5 4.4 0M13.6 10h4.6M13.6 13.2h3.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function CloseIcon({ size = 9 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function ChevronIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2 7.5L6 3.5L10 7.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
