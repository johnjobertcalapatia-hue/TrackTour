import DashboardLayout, { NavSection } from './DashboardLayout'
import type { ReactNode } from 'react'

export default function RiderLayout({ sections, children }: { sections?: NavSection[]; children?: ReactNode }) {
  return (
    <DashboardLayout sections={sections} roleLabel="Rider">
      {children}
    </DashboardLayout>
  )
}
