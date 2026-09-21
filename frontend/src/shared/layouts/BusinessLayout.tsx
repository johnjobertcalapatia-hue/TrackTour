import DashboardLayout, { NavSection } from './DashboardLayout'
import type { ReactNode } from 'react'

export default function BusinessLayout({ sections, children }: { sections?: NavSection[]; children?: ReactNode }) {
  return (
    <DashboardLayout sections={sections} roleLabel="Business Owner">
      {children}
    </DashboardLayout>
  )
}
