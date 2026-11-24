import { Bike, Building2, CircleDollarSign, FileScan, HardDrive, KeyRound, Landmark, Lock, ReceiptText, ShieldCheck, SlidersHorizontal, Stethoscope, Tag, History, UserCheck, Users } from 'lucide-react'
import type { SectionTab } from '@/features/admin/components/AdminSectionTabs'
import type { SettingsSection } from '@/features/admin/components/AdminSettingsLayout'

// Bansud admin modules that group related screens as tabs. Old standalone
// URLs redirect here (see App.tsx), so no functionality was removed.

export const USERS_TABS: SectionTab[] = [
  { to: '/admin/users', label: 'All users', icon: Users, end: true },
  { to: '/admin/users/tourists', label: 'Tourists', icon: UserCheck },
]

export const RIDERS_TABS: SectionTab[] = [
  { to: '/admin/riders', label: 'Rider accounts', icon: Bike, end: true },
  { to: '/admin/riders/fares', label: 'Fare configuration', icon: ReceiptText },
  // Stage C2 (2026-11-18): ride cancellation penalties — list, waive with a reason.
  { to: '/admin/riders/cancellation-fees', label: 'Cancellation fees', icon: CircleDollarSign },
]

export const BUSINESSES_TABS: SectionTab[] = [
  { to: '/admin/businesses', label: 'Businesses', icon: Building2, end: true },
  { to: '/admin/businesses/categories', label: 'Categories', icon: Tag },
]

export const MUNICIPALITIES_TABS: SectionTab[] = [
  { to: '/admin/municipalities', label: 'Municipalities', icon: Landmark, end: true },
  { to: '/admin/municipalities/accounts', label: 'Accounts', icon: ShieldCheck },
]

// Security prevents unauthorised access, Diagnostics finds technical problems,
// Incident History records problems and how they were fixed.
// /admin/settings shows these as buttons; each opens its own page (2026-11-18).
export const SETTINGS_TABS: SettingsSection[] = [
  { to: '/admin/settings/configuration', label: 'Platform Configuration', icon: SlidersHorizontal, description: 'Platform-wide settings and operational policies.' },
  { to: '/admin/settings/access-control', label: 'Access Control', icon: KeyRound, description: 'Roles, permissions and administrative access.' },
  { to: '/admin/settings/document-verification', label: 'Document Verification', icon: FileScan, description: 'OCR and document verification settings.' },
  { to: '/admin/settings/security', label: 'Security', icon: Lock, description: 'Login protection, authentication and security policies — preventing unauthorised access.' },
  { to: '/admin/settings/backup', label: 'Data Backup', icon: HardDrive, description: 'Database backups, restoration and backup history.' },
  { to: '/admin/settings/diagnostics', label: 'System Diagnostics', icon: Stethoscope, description: 'System health, errors and diagnostic checks — finding technical problems.', showTitle: true },
  { to: '/admin/settings/incidents', label: 'Incident History', icon: History, description: 'System incidents, failures and resolution records — tracking problems and how they were fixed.', showTitle: true },
]

/** Old admin URLs → their new home. */
export const ADMIN_REDIRECTS: Record<string, string> = {
  tourists: '/admin/users/tourists',
  'business-categories': '/admin/businesses/categories',
  'municipality-accounts': '/admin/municipalities/accounts',
  roles: '/admin/settings/access-control',
  'system/config': '/admin/settings/configuration',
  'system/ocr-settings': '/admin/settings/document-verification',
  'system/security': '/admin/settings/security',
  'system/backup': '/admin/settings/backup',
  pos: '/admin/reports',
}
