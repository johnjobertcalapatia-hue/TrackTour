import { NavLink, Outlet, useLocation } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/shared/utils'

export interface SectionTab {
  to: string
  label: string
  icon?: LucideIcon
  /** Exact match (for the section's index tab). */
  end?: boolean
  /** One line under the tab bar saying what this module is for. */
  description?: string
}

/**
 * Tab bar for a Bansud admin module that groups related screens (e.g.
 * Businesses → Categories, Municipalities → Accounts, Settings → Access
 * Control). The tab content is the nested route.
 */
export default function AdminSectionTabs({ label, title, description, tabs }: { label: string; title?: string; description?: string; tabs: SectionTab[] }) {
  const { pathname } = useLocation()
  const current = tabs.find((t) => (t.end ? pathname === t.to : pathname === t.to || pathname.startsWith(`${t.to}/`)))
  return (
    <div className="space-y-5">
      {title && (
        <header>
          <h1 className="text-2xl font-bold text-[#1C2B22] lg:text-3xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-[#66736B]">{description}</p>}
        </header>
      )}
      <nav aria-label={label} className="no-scrollbar -mb-1 flex gap-1 overflow-x-auto border-b border-[#E7E2D6]">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition',
                isActive ? 'border-[#2E8B57] text-[#1C2B22]' : 'border-transparent text-[#66736B] hover:border-[#CFE5D7] hover:text-[#1C2B22]'
              )
            }
          >
            {({ isActive }) => (
              <>
                {t.icon && <t.icon className={cn('h-4 w-4', isActive ? 'text-[#2E8B57]' : 'text-[#9AA39D]')} aria-hidden="true" />}
                {t.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      {current?.description && (
        <p className="flex items-center gap-2 text-sm text-[#3F4B43]" aria-label={`${current.label}: about this section`}>
          {current.icon && <current.icon className="h-4 w-4 text-[#2E8B57]" aria-hidden="true" />}
          <span className="font-semibold text-[#1C2B22]">{current.label}</span>
          <span className="text-[#66736B]">— {current.description}</span>
        </p>
      )}
      <Outlet />
    </div>
  )
}
