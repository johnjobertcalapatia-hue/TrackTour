import DashboardLayout, { NavSection } from './DashboardLayout'
import type { ReactNode } from 'react'

export default function TourismOfficeLayout({ sections, children }: { sections?: NavSection[]; children?: ReactNode }) {
  return (
    <DashboardLayout sections={sections} roleLabel="Tourism Office">
      {children}
    </DashboardLayout>
  )
}
