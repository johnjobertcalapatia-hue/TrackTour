import { Suspense } from 'react'
import { createPortal } from 'react-dom'
import { Outlet, useLocation, Link } from 'react-router-dom'
import TouristHeader from '@/features/tourist/components/layout/TouristHeader'
import TouristSidebar from '@/features/tourist/components/layout/TouristSidebar'
import { TOURIST_NAV_ITEMS, useActiveTouristNav } from '@/features/tourist/components/layout/tourist-nav'
import { cn } from '@/shared/utils'
import { useVisibleBottomInset } from '@/shared/hooks/use-visible-bottom-inset'

export default function TouristLayout() {
  const location = useLocation()
  const activeTo = useActiveTouristNav()
  // Anchors the bottom bar to the bottom of the VISIBLE screen (see the hook).
  const bottomInset = useVisibleBottomInset()

  return (
    <div className="tourist-ui clay-ui min-h-screen bg-[#F4F8F3] lg:flex">
      {/* Desktop sidebar: full height, brand + navigation */}
      <div className="hidden lg:block sticky top-0 h-screen overflow-y-auto shrink-0 z-[2001]">
        <TouristSidebar />
      </div>

      {/* Header + page content */}
      <div className="flex-1 min-w-0">
        <TouristHeader />
        <main className="tourist-main min-w-0 px-4 pt-4 sm:px-6 sm:pt-6">
          <Suspense fallback={
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-[#087F3F] border-t-transparent rounded-full animate-spin" />
            </div>
          }>
            {/* Keyed wrapper re-runs the enter animation on every page change. */}
            <div key={location.pathname + location.search} className="tourist-page-enter">
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>

      {/* Mobile / tablet bottom navigation: same items as the desktop sidebar.
          ALWAYS on screen (never hidden on scroll). Rendered straight into
          <body> so nothing in the page (transforms, filters, stacking) can
          take it off the screen; it keeps the tourist theme classes. */}
      {typeof document !== 'undefined' && createPortal(
      <nav
        aria-label="Tourist bottom navigation"
        className="tourist-ui clay-ui tourist-bottom-nav fixed bottom-0 left-0 right-0 z-[2000] bg-white border-t border-[#E5E9E7] lg:hidden safe-bottom"
        data-bottom-inset={bottomInset}
        style={bottomInset > 0 ? { transform: `translate3d(0, ${-bottomInset}px, 0)` } : undefined}
      >
        <div className="tourist-bottom-nav-grid grid grid-cols-7 px-1 sm:px-3 max-w-3xl md:max-w-4xl mx-auto">
          {TOURIST_NAV_ITEMS.map((item) => {
            const active = item.to === activeTo
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'tourist-bottom-nav-link min-w-0 flex flex-col items-center justify-center gap-0.5 sm:gap-1 px-0.5 transition-colors',
                  active ? 'text-[#087F3F]' : 'text-[#56615B] hover:text-[#17201B]',
                )}
              >
                <span
                  className={cn(
                    'tourist-bottom-nav-pill flex items-center justify-center rounded-full transition-colors',
                    active && 'bg-[#E3F4E9]',
                  )}
                  aria-hidden="true"
                >
                  <item.icon className="tourist-bottom-nav-icon" />
                </span>
                <span className={cn('tourist-bottom-nav-label max-w-full truncate', active ? 'font-bold' : 'font-medium')}>
                  <span className="sm:hidden">{item.shortLabel}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                </span>
              </Link>
            )
          })}
        </div>
      </nav>,
      document.body,
      )}
    </div>
  )
}
