import type { ReactNode } from 'react'
import { BarChart3, BookOpen, CalendarCheck, ClipboardList, CreditCard, LayoutDashboard, Megaphone, UserRound } from 'lucide-react'
import BusinessOwnerShell, { type ShellNavSection } from '@/features/business-owner/components/shell/BusinessOwnerShell'
import { BusinessPortalProvider } from '@/features/business-owner/services/business-portal'
import { getInitials, toAssetUrl } from '@/shared/utils'
import { useStaffPermissions, type StaffPermission } from '../services/use-staff-permissions'

interface StaffNavItem { to: string; label: string; icon: ReactNode; permission: StaffPermission }

const SECTIONS: { label: string; items: StaffNavItem[] }[] = [
  { label: 'Operations', items: [
    { to: '/staff/orders', label: 'Orders', icon: <ClipboardList />, permission: 'orders.view' },
    { to: '/staff/bookings', label: 'Bookings', icon: <CalendarCheck />, permission: 'bookings.view' },
  ] },
  { label: 'Menu & Promotions', items: [
    { to: '/staff/menu', label: 'Menu', icon: <BookOpen />, permission: 'menu.view' },
    { to: '/staff/promotions', label: 'Deals & Posts', icon: <Megaphone />, permission: 'promotions.manage' },
  ] },
  { label: 'Finance', items: [
    { to: '/staff/reports', label: 'Sales & Reports', icon: <BarChart3 />, permission: 'finance.view' },
    { to: '/staff/expenses', label: 'Expenses', icon: <CreditCard />, permission: 'finance.view' },
  ] },
]

/** The staff member's restaurant in the sidebar (no switcher: one business). */
function StaffBusinessCard({ name, category, logo, role }: { name: string; category?: string | null; logo?: string | null; role: string }) {
  const src = logo ? toAssetUrl(logo) : ''
  return (
    <div className="mx-3 flex items-center gap-3 rounded-[18px] border border-[#ffffff26] bg-[#ffffff0f] p-3" data-testid="staff-business-card">
      {src ? (
        <img src={src} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-[#ffffff33]" />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1F7A45] text-sm font-bold text-white">{getInitials(name)}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-sm font-bold leading-snug text-white">{name}</span>
        <span className="mt-1 flex flex-wrap gap-1">
          <span className="rounded-full bg-[#F4C430] px-2 py-0.5 text-[11px] font-bold text-[#3A2A00]">Staff</span>
          {category && <span className="rounded-full bg-[#2E9A57] px-2 py-0.5 text-[11px] font-semibold text-white">{category}</span>}
        </span>
        <span className="mt-1 block truncate text-[11px] text-[#C8E6D2]">{role}</span>
      </span>
    </div>
  )
}

/**
 * Staff portal shell (Staff Management Stage 1 + §5; owner look 2026-11-24).
 * The owner portal's green sidebar and header, with the staff member's one
 * restaurant, their name and role, and only the menu items their roles allow
 * (GET /staff/me). The owner's pages render here with prefix /staff; the
 * backend checks every request.
 */
export default function StaffLayout() {
  const { can, data } = useStaffPermissions()

  const sections: ShellNavSection[] = [
    { items: [{ to: '/staff/dashboard', label: 'Dashboard', icon: <LayoutDashboard /> }] },
    ...SECTIONS.map((section) => ({
      label: section.label,
      items: section.items.filter((item) => can(item.permission)).map(({ permission: _p, ...item }) => item),
    })).filter((section) => section.items.length > 0),
    { label: 'Account', items: [{ to: '/staff/profile', label: 'My Profile', icon: <UserRound /> }] },
  ]

  const business = data?.business
  const staff = data?.staff
  const businessName = business?.name ?? 'Your business'
  const role = staff?.role ?? 'Staff'

  return (
    <BusinessPortalProvider
      value={{
        prefix: '/staff',
        isStaff: true,
        businessId: business?.id ?? null,
        businesses: business ? [{ id: business.id, name: business.name, category: business.category ?? undefined, logo: business.logo }] : [],
        can: (permission) => can(permission as StaffPermission),
      }}
    >
      <BusinessOwnerShell
        sections={sections}
        portal={{
          homeTo: '/staff/dashboard',
          navLabel: 'Staff menu',
          businessCard: <StaffBusinessCard name={businessName} category={business?.category} logo={business?.logo} role={role} />,
          sideCard: null,
          header: {
            title: businessName,
            subtitle: staff?.employee_id ? `Staff portal · ${staff.employee_id}` : 'Staff portal',
          },
          person: { name: staff?.full_name ?? '', roleLabel: role, photo: staff?.profile_picture ?? null },
          menu: [{ to: '/staff/profile', label: 'My Profile', icon: <UserRound /> }],
        }}
      />
    </BusinessPortalProvider>
  )
}
