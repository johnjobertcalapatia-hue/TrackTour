import DashboardLayout, { NavSection } from './DashboardLayout'
import type { ReactNode } from 'react'

export default function StaffLayout({ sections, children }: { sections?: NavSection[]; children?: ReactNode }) {
  return (
    // Use the 'tourism' theme so staff navigation matches the business-owner palette
    <DashboardLayout sections={sections} roleLabel="Staff" theme="tourism">
      {children}
    </DashboardLayout>
  )
}
