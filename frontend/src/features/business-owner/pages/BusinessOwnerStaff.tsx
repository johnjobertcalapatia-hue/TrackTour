import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, del, get, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { formatDate, formatDateTime } from '@/shared/utils'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import { StaffStatusBadge } from '../components/staff/StaffStatusBadge'
import { CopyActivationLink } from '../components/staff/CopyActivationLink'
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Clock,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
  UserX,
  Users,
  type LucideIcon,
} from 'lucide-react'

interface StaffMember {
  id: number
  name: string
  email: string
  role_label: string | null
  status: string
  employee_id: string
  last_login_at: string | null
  created_at: string
}

interface ActivityRow {
  id: number
  action: string
  description: string
  actor_type: 'owner' | 'staff' | 'system'
  actor_name: string | null
  staff_name: string | null
  created_at: string
}

interface Overview {
  counts: { total: number; active: number; pending: number; suspended: number; inactive: number }
  recent_activity: ActivityRow[]
}

interface Invitation {
  id: number
  staff_id: number
  name: string | null
  email: string
  role: string | null
  business: string | null
  state: 'pending' | 'accepted' | 'expired' | 'revoked'
  sent_at: string
  expires_at: string
}

type Tab = 'overview' | 'staff' | 'invitations'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'staff', label: 'All Staff' },
  { key: 'invitations', label: 'Invitations' },
]
const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'inactive', label: 'Deactivated' },
]
const ITEMS_PER_PAGE = 8
const card = 'bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)]'

/**
 * Business owner — Staff Management (Stage 1, docs/staff-management-plan.md):
 * Overview (counts + recent activity), All Staff, Invitations. Staff are
 * invited and set their own password; roles & permissions and full activity
 * logs come in later stages.
 */
export default function BusinessOwnerStaff() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = (TABS.find((t) => t.key === params.get('tab'))?.key) ?? 'overview'
  const setTab = (next: Tab) => setParams(next === 'overview' ? {} : { tab: next }, { replace: true })

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#126B32] lg:text-3xl">Staff Management</h1>
          <p className="mt-1 text-sm text-[#647067]">Manage your employees, their accounts and what they can access.</p>
        </div>
        <button
          onClick={() => navigate('/business-owner/staff/create')}
          className="inline-flex items-center gap-2 rounded-xl bg-[#16803C] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#126B32]"
        >
          <Plus className="h-4 w-4" /> Add Staff
        </button>
      </div>

      <div role="tablist" aria-label="Staff management sections" className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition ${
              tab === t.key ? 'bg-[#16803C] text-white' : 'border border-[#D7E8DB] bg-[#fff] text-[#16803C] hover:bg-[#F3F8F4]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab onOpenStaff={() => setTab('staff')} />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'invitations' && <InvitationsTab />}
    </div>
  )
}

function OverviewTab({ onOpenStaff }: { onOpenStaff: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['bo-staff-overview'], queryFn: () => get<Overview>('/business-owner/staff/overview') })
  if (isLoading) return <DashboardSkeleton />
  const counts = data?.counts ?? { total: 0, active: 0, pending: 0, suspended: 0, inactive: 0 }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        <StatCard icon={Users} label="Total staff" value={counts.total} hint="Registered accounts" />
        <StatCard icon={UserCheck} label="Active staff" value={counts.active} hint="Can sign in now" />
        <StatCard icon={Mail} label="Pending invitations" value={counts.pending} hint="Not activated yet" tone="amber" />
        <StatCard icon={UserX} label="Suspended" value={counts.suspended} hint={counts.inactive ? `${counts.inactive} deactivated` : 'No access'} tone="red" />
      </div>

      <section aria-label="Recent activity" className={card}>
        <div className="flex items-center justify-between border-b border-[#E2E8E3] px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[#17201A]"><Activity className="h-4 w-4 text-[#16803C]" /> Recent activity</h2>
          <button onClick={onOpenStaff} className="text-sm font-medium text-[#16803C] hover:underline">View all staff</button>
        </div>
        {(data?.recent_activity ?? []).length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[#647067]">No staff activity yet. Add your first staff member to get started.</p>
        ) : (
          <ul className="divide-y divide-[#E2E8E3]">
            {data!.recent_activity.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-[#17201A]">{a.description}</p>
                  <p className="mt-0.5 text-xs text-[#647067]">{a.actor_type === 'owner' ? 'By you' : a.actor_type === 'staff' ? `By ${a.actor_name ?? 'staff'}` : 'System'}</p>
                </div>
                <span className="shrink-0 text-xs text-[#647067]">{formatDateTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className={`${card} flex items-start gap-3 p-5`}>
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#16803C]" />
        <p className="text-sm text-[#4B5563]">
          Staff set their own password through an invitation link that works once and expires after 72 hours. Suspending or removing a staff
          member signs them out at once. Each staff member only sees what their role allows, for your business only.
        </p>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, hint, tone = 'emerald' }: { icon: LucideIcon; label: string; value: number; hint: string; tone?: 'emerald' | 'amber' | 'red' }) {
  // Round, filled icons as on the redesigned owner dashboard.
  const tint = tone === 'amber' ? 'bg-[#E9A100] text-white' : tone === 'red' ? 'bg-[#DC2626] text-white' : 'bg-[#16803C] text-white'
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[#647067]">{label}</p>
        <span className={`flex h-11 w-11 items-center justify-center rounded-full ${tint}`}><Icon className="h-5 w-5" /></span>
      </div>
      <p className="mt-2 text-3xl font-bold text-[#17201A]" data-testid={`stat-${label}`}>{value}</p>
      <p className="mt-1 text-xs text-[#647067]">{hint}</p>
    </div>
  )
}

function StaffTab() {
  const navigate = useNavigate()
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['bo-staff', selectedBusinessId],
    queryFn: () => get<{ staff: StaffMember[]; status_counts: Record<string, number> }>(
      `/business-owner/staff${selectedBusinessId ? `?business_id=${selectedBusinessId}` : ''}`,
    ),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.staff ?? []).filter((s) => (status === 'all' || s.status === status)
      && (!q || s.name.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q) || s.employee_id?.toLowerCase().includes(q)))
  }, [data, status, search])

  if (isLoading) return <DashboardSkeleton />

  const counts = data?.status_counts ?? {}
  const total = (data?.staff ?? []).length
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const current = Math.min(page, totalPages)
  const paginated = filtered.slice((current - 1) * ITEMS_PER_PAGE, current * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => {
            const n = f.key === 'all' ? total : (counts[f.key] ?? 0)
            return (
              <button
                key={f.key}
                onClick={() => { setStatus(f.key); setPage(1) }}
                aria-pressed={status === f.key}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${status === f.key ? 'bg-[#16803C] text-white' : 'border border-[#D7E8DB] bg-[#fff] text-[#4B5563] hover:bg-[#F3F8F4]'}`}
              >
                {f.label} · {n}
              </button>
            )
          })}
        </div>
        <label className="relative block w-full lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search staff…"
            aria-label="Search staff"
            className="w-full rounded-xl border border-[#E2E8E3] bg-white py-2.5 pl-9 pr-3 text-sm focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25"
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className={`${card} p-12 text-center`}>
          <Users className="mx-auto mb-4 h-12 w-12 text-[#647067]" />
          <p className="text-[#647067]">{total === 0 ? 'No staff members yet.' : 'No staff match this filter.'}</p>
        </div>
      ) : (
        <>
          <div className={`${card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                    {['Employee', 'Role', 'Status', 'Last sign-in', 'Added'].map((h) => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[#647067] lg:px-6">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E3]">
                  {paginated.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => navigate(`/business-owner/staff/${s.id}`)}
                      className="cursor-pointer transition-colors hover:bg-[#F6F8F4]"
                      data-testid={`staff-row-${s.id}`}
                    >
                      <td className="whitespace-nowrap px-5 py-3 lg:px-6">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EAF6ED] text-xs font-bold text-[#16803C]">
                            {s.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-[#17201A]">{s.name}</p>
                            <p className="text-xs text-[#647067]">{s.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-[#4B5563] lg:px-6">{s.role_label ?? '—'}</td>
                      <td className="whitespace-nowrap px-5 py-3 lg:px-6"><StaffStatusBadge status={s.status} /></td>
                      <td className="whitespace-nowrap px-5 py-3 text-[#647067] lg:px-6">{s.last_login_at ? formatDateTime(s.last_login_at) : 'Never'}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-[#647067] lg:px-6">{formatDate(s.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-[#647067]">
              Showing {(current - 1) * ITEMS_PER_PAGE + 1}–{Math.min(current * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button aria-label="Previous page" onClick={() => setPage(current - 1)} disabled={current === 1} className="rounded-lg border border-[#D7E8DB] bg-white p-2 text-[#16803C] transition hover:bg-[#F3F8F4] disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <span className="text-sm text-[#647067]">Page {current} of {totalPages}</span>
                <button aria-label="Next page" onClick={() => setPage(current + 1)} disabled={current === totalPages} className="rounded-lg border border-[#D7E8DB] bg-white p-2 text-[#16803C] transition hover:bg-[#F3F8F4] disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function InvitationsTab() {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string; link?: string | null } | null>(null)
  const [revokeId, setRevokeId] = useState<number | null>(null)
  const { data, isLoading } = useQuery({ queryKey: ['bo-staff-invitations'], queryFn: () => get<{ invitations: Invitation[] }>('/business-owner/staff/invitations') })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['bo-staff-invitations'] })
    queryClient.invalidateQueries({ queryKey: ['bo-staff-overview'] })
  }
  const resend = useMutation({
    mutationFn: (staffId: number) => post<{ mail_sent: boolean; activation_url: string | null }>(`/business-owner/staff/${staffId}/resend-invitation`),
    onSuccess: (res) => {
      setNotice(res.mail_sent
        ? { type: 'ok', text: 'A new invitation was sent. The previous link no longer works.' }
        : { type: 'error', text: 'The email could not be sent. Share this activation link with them:', link: res.activation_url })
      refresh()
    },
    onError: (e) => setNotice({ type: 'error', text: apiErrorMessage(e, 'Could not resend the invitation.') }),
  })
  const revoke = useMutation({
    mutationFn: (id: number) => del(`/business-owner/staff/invitations/${id}`),
    onSuccess: () => { setNotice({ type: 'ok', text: 'Invitation cancelled. The link no longer works.' }); setRevokeId(null); refresh() },
    onError: (e) => { setNotice({ type: 'error', text: apiErrorMessage(e, 'Could not cancel the invitation.') }); setRevokeId(null) },
  })

  if (isLoading) return <DashboardSkeleton />
  const invitations = data?.invitations ?? []

  return (
    <div className="space-y-4">
      {notice && (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${notice.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {notice.text}
          {notice.link && <CopyActivationLink url={notice.link} />}
        </div>
      )}

      {invitations.length === 0 ? (
        <div className={`${card} p-12 text-center`}>
          <Mail className="mx-auto mb-4 h-12 w-12 text-[#647067]" />
          <p className="text-[#647067]">No invitations yet.</p>
        </div>
      ) : (
        <div className={`${card} overflow-hidden`}>
          <ul className="divide-y divide-[#E2E8E3]">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`invitation-${i.id}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-[#17201A]">{i.name ?? i.email}</p>
                    <StaffStatusBadge status={i.state} />
                  </div>
                  <p className="mt-0.5 text-xs text-[#647067]">{i.email} · {i.role ?? 'Staff'}{i.business ? ` · ${i.business}` : ''}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-[#647067]">
                    <Clock className="h-3 w-3" /> Sent {formatDateTime(i.sent_at)}{i.state === 'pending' ? ` · expires ${formatDateTime(i.expires_at)}` : ''}
                  </p>
                </div>
                {(i.state === 'pending' || i.state === 'expired') && (
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => resend.mutate(i.staff_id)} disabled={resend.isPending} className="rounded-xl border border-[#D7E8DB] bg-white px-3 py-2 text-xs font-semibold text-[#16803C] transition hover:bg-[#F3F8F4] disabled:opacity-50">
                      Resend
                    </button>
                    {i.state === 'pending' && (
                      <button onClick={() => setRevokeId(i.id)} className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50">
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal show={revokeId !== null} onClose={() => setRevokeId(null)} maxWidth="sm">
        <div className="p-6">
          <h3 className="mb-2 text-lg font-semibold text-[#17201A]">Cancel invitation?</h3>
          <p className="mb-6 text-sm text-[#647067]">The activation link will stop working. You can send a new invitation later.</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setRevokeId(null)} className="rounded-xl border border-[#D7E8DB] bg-white px-4 py-2 text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4]">Keep</button>
            <button onClick={() => revokeId && revoke.mutate(revokeId)} disabled={revoke.isPending} className="rounded-xl bg-[#B91C1C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#991B1B] disabled:opacity-50">Cancel invitation</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
