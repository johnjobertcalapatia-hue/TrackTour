export function ApplicationLogo({ className = 'w-20 h-20' }: { className?: string }) {
  return (
    <img
      src="/assets/logo/tracktour.png"
      alt="TrackTour Logo"
      className={`${className} object-contain`}
    />
  )
}
