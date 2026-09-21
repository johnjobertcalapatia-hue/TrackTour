import DashboardLayout, { NavSection } from './DashboardLayout'
import type { ReactNode } from 'react'

interface Props {
  sections?: NavSection[]
  roleLabel?: string
  children?: ReactNode
}

export default function AdminLayout({ sections, roleLabel = 'Admin', children }: Props) {
  // DashboardLayout already handles navigation and Outlet; allow passing children via Outlet in routes.
  return (
    <DashboardLayout sections={sections} roleLabel={roleLabel}>
      {children}
    </DashboardLayout>
  )
}
