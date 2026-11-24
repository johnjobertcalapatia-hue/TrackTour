/**
 * Staff account status (Staff Management Stage 1). Design system badges:
 * emerald = active, amber = pending; red = suspended, gray = deactivated.
 */
export type StaffStatus = 'pending' | 'active' | 'inactive' | 'suspended' | 'archived'

const STYLES: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  pending: { label: 'Invitation pending', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  suspended: { label: 'Suspended', className: 'bg-red-50 text-red-700 border border-red-200' },
  inactive: { label: 'Deactivated', className: 'bg-gray-100 text-gray-600 border border-gray-200' },
  archived: { label: 'Removed', className: 'bg-gray-100 text-gray-600 border border-gray-200' },
  // Invitation states
  expired: { label: 'Expired', className: 'bg-gray-100 text-gray-600 border border-gray-200' },
  accepted: { label: 'Accepted', className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  revoked: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border border-gray-200' },
}

export function StaffStatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? { label: status, className: 'bg-gray-100 text-gray-600 border border-gray-200' }

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${style.className}`}>
      {style.label}
    </span>
  )
}

export function staffStatusLabel(status: string): string {
  return STYLES[status]?.label ?? status
}
