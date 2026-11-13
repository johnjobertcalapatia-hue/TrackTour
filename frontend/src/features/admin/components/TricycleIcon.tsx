import type { SVGProps } from 'react'

// Tricycle (motorcycle with a covered sidecar) drawn in the lucide line style;
// lucide has no tricycle icon.
export function TricycleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 15V7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v8" />
      <path d="M2 10h10" />
      <path d="M12 15h3l2-5h2" />
      <path d="M2 15h2.5M9.5 15H12" />
      <circle cx="7" cy="16.5" r="2.5" />
      <circle cx="19" cy="16.5" r="2.5" />
    </svg>
  )
}
