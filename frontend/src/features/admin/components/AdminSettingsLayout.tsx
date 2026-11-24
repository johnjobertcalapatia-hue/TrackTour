import { Link, Outlet, useLocation } from 'react-router-dom'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import type { SectionTab } from '@/features/admin/components/AdminSectionTabs'

export interface SettingsSection extends SectionTab {
  /** The page has no title of its own, so the layout shows one. */
  showTitle?: boolean
}

const SETTINGS_HOME = '/admin/settings'

/**
 * Admin Settings (2026-11-18): /admin/settings is a page of buttons, one per
 * settings area; each opens its own page with a way back. No tab bar.
 */
export default function AdminSettingsLayout({ sections }: { sections: SettingsSection[] }) {
  const { pathname } = useLocation()
  const current = sections.find((s) => pathname === s.to || pathname.startsWith(`${s.to}/`))

  if (!current) return <Outlet />

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          to={SETTINGS_HOME}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[#E7E2D6] bg-white px-3 py-1.5 font-medium text-[#1C2B22] hover:bg-[#FAF7F0]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Settings
        </Link>
        <ChevronRight className="h-4 w-4 text-[#9AA39D]" aria-hidden="true" />
        <span aria-current="page" className="font-semibold text-[#1C2B22]">{current.label}</span>
      </nav>
      {current.showTitle && (
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[#1C2B22] lg:text-3xl">
            {current.icon && <current.icon className="h-7 w-7 text-[#2E8B57]" aria-hidden="true" />}
            {current.label}
          </h1>
          {current.description && <p className="mt-1 text-sm text-[#66736B]">{current.description}</p>}
        </header>
      )}
      <Outlet />
    </div>
  )
}

/** /admin/settings: one button per settings area. */
export function AdminSettingsHome({ sections }: { sections: SettingsSection[] }) {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-[#1C2B22] lg:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-[#66736B]">Platform configuration, access control and system administration.</p>
      </header>
      <nav aria-label="Settings sections">
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((s) => (
            <li key={s.to}>
              <Link
                to={s.to}
                className="group flex h-full items-start gap-3 rounded-2xl border border-[#E7E2D6] bg-white p-4 transition hover:border-[#2E8B57]/40 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2E8B57]"
              >
                {s.icon && (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E6F2EB]">
                    <s.icon className="h-5 w-5 text-[#2E8B57]" aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-[#1C2B22]">{s.label}</span>
                  {s.description && <span className="mt-0.5 block text-sm text-[#66736B]">{s.description}</span>}
                </span>
                <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-[#9AA39D] transition group-hover:translate-x-0.5 group-hover:text-[#2E8B57]" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
