import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, del, get, patch, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { formatDate, formatDateTime } from '@/shared/utils'
import { StaffStatusBadge } from '../components/staff/StaffStatusBadge'
import { CopyActivationLink } from '../components/staff/CopyActivationLink'
import { Activity, ArrowLeft, CalendarDays, KeyRound, Mail, Pencil, Phone, Send, ShieldCheck, Trash2, UserCheck, UserMinus, UserX } from 'lucide-react'

interface StaffProfile {
  id: number
  name: string
  email: string
  employee_id: string
  mobile_number: string | null
  address: string | null
  role_label: string | null
  status: string
  date_hired: string | null
  employment_status: string | null
  last_login_at: string | null
  created_at: string
  business: { business_name?: string; name?: string } | null
  granted_permissions: { key: string; module: string; label: string }[]
  invitation: { state: string; sent_at: string; expires_at: string; accepted_at: string | null } | null
  activity: { id: number; description: string; actor_type: string; actor_name: string | null; created_at: string }[]
}

type Confirm = { kind: 'suspended' | 'inactive' | 'remove' } | null

const card = 'bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)]'
const secondaryBtn = 'inline-flex items-center gap-2 rounded-xl border border-[#D7E8DB] bg-white px-4 py-2 text-sm font-medium text-[#16803C] transition hover:bg-[#F3F8F4] disabled:opacity-50'

/**
 * Staff profile (Staff Management Stage 1): details, role and what it allows,
 * account status, invitation, activity history, and the owner's actions.
 */
export default function BusinessOwnerStaffShow() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string; link?: string | null } | null>(null)

  const { data: staff, isLoading } = useQuery({
    queryKey: ['bo-staff-member', id],
    queryFn: () => get<StaffProfile>(`/business-owner/staff/${id}`),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['bo-staff-member', id] })
    queryClient.invalidateQueries({ queryKey: ['bo-staff'] })
    queryClient.invalidateQueries({ queryKey: ['bo-staff-overview'] })
    queryClient.invalidateQueries({ queryKey: ['bo-staff-invitations'] })
  }
  const fail = (e: unknown, fallback: string) => setNotice({ type: 'error', text: apiErrorMessage(e, fallback) })

  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'inactive' | 'suspended') => patch(`/business-owner/staff/${id}/status`, { status }),
    onSuccess: (_r, status) => {
      setConfirm(null)
      setNotice({ type: 'ok', text: status === 'active' ? 'Account reactivated. They can sign in again.' : `Account ${status === 'suspended' ? 'suspended' : 'deactivated'}. They have been signed out.` })
      refresh()
    },
    onError: (e) => { setConfirm(null); fail(e, 'Could not change the account status.') },
  })
  const resend = useMutation({
    mutationFn: () => post<{ mail_sent: boolean; activation_url: string | null }>(`/business-owner/staff/${id}/resend-invitation`),
    onSuccess: (res) => {
      setNotice(res.mail_sent
        ? { type: 'ok', text: 'A new invitation was sent. The previous link no longer works.' }
        : { type: 'error', text: 'The email could not be sent. Share this activation link with them:', link: res.activation_url })
      refresh()
    },
    onError: (e) => fail(e, 'Could not resend the invitation.'),
  })
  const resetLink = useMutation({
    mutationFn: () => post(`/business-owner/staff/${id}/send-password-reset`),
    onSuccess: () => { setNotice({ type: 'ok', text: 'A password reset link was emailed to them.' }); refresh() },
    onError: (e) => fail(e, 'Could not send the password reset link.'),
  })
  const remove = useMutation({
    mutationFn: () => del(`/business-owner/staff/${id}`),
    onSuccess: () => { refresh(); navigate('/business-owner/staff?tab=staff') },
    onError: (e) => { setConfirm(null); fail(e, 'Could not remove this staff member.') },
  })

  if (isLoading) return <DashboardSkeleton />
  if (!staff) return <div className="py-20 text-center text-[#647067]">Staff member not found.</div>

  const busy = setStatus.isPending || resend.isPending || resetLink.isPending || remove.isPending
  const businessName = staff.business?.business_name ?? staff.business?.name
  const modules = staff.granted_permissions.reduce<Record<string, string[]>>((acc, p) => {
    (acc[p.module] ??= []).push(p.label)
    return acc
  }, {})

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/business-owner/staff?tab=staff" className="mb-6 inline-flex items-center gap-2 text-sm text-[#647067] transition hover:text-[#17201A]">
        <ArrowLeft className="h-4 w-4" /> Back to Staff
      </Link>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#EAF6ED] text-2xl font-bold text-[#16803C]">
            {staff.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#126B32] lg:text-3xl">{staff.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-sm text-[#647067]">{staff.role_label ?? 'No role'}</span>
              <StaffStatusBadge status={staff.status} />
            </div>
          </div>
        </div>
        <button onClick={() => navigate(`/business-owner/staff/${staff.id}/edit`)} className={secondaryBtn}>
          <Pencil className="h-4 w-4" /> Edit details & role
        </button>
      </div>

      {notice && (
        <div role="status" className={`mb-6 rounded-xl border px-4 py-3 text-sm ${notice.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {notice.text}
          {notice.link && <CopyActivationLink url={notice.link} />}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section aria-label="Personal information" className={`${card} p-6`}>
            <h2 className="mb-4 text-lg font-semibold text-[#17201A]">Personal information</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Fact icon={Mail} label="Email" value={staff.email} />
              <Fact icon={Phone} label="Mobile" value={staff.mobile_number ?? '—'} />
              <Fact icon={ShieldCheck} label="Employee ID" value={staff.employee_id} />
              <Fact icon={CalendarDays} label="Date hired" value={staff.date_hired ? formatDate(staff.date_hired) : '—'} />
            </dl>
          </section>

          <section aria-label="Role and access" className={`${card} p-6`}>
            <h2 className="mb-1 text-lg font-semibold text-[#17201A]">Role & access</h2>
            <p className="mb-4 text-sm text-[#647067]">
              {staff.role_label ?? 'No role'}{businessName ? ` at ${businessName}` : ''}. Staff only see your business and only what their role allows.
            </p>
            {staff.granted_permissions.length === 0 ? (
              <p className="rounded-xl bg-[#F6F8F4] px-4 py-3 text-sm text-[#647067]">This role has no order, booking or menu access yet.</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(modules).map(([module, labels]) => (
                  <div key={module}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#647067]">{module}</p>
                    <ul className="mt-1 space-y-1">
                      {labels.map((l) => <li key={l} className="flex items-center gap-2 text-sm text-[#17201A]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{l}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section aria-label="Activity history" className={card}>
            <h2 className="flex items-center gap-2 border-b border-[#E2E8E3] px-6 py-4 text-lg font-semibold text-[#17201A]"><Activity className="h-4 w-4 text-[#16803C]" /> Activity history</h2>
            {staff.activity.length === 0 ? (
              <p className="px-6 py-6 text-sm text-[#647067]">No activity yet.</p>
            ) : (
              <ul className="divide-y divide-[#E2E8E3]">
                {staff.activity.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-4 px-6 py-3">
                    <div>
                      <p className="text-sm text-[#17201A]">{a.description}</p>
                      <p className="text-xs text-[#647067]">{a.actor_type === 'owner' ? 'By you' : a.actor_type === 'staff' ? 'By the staff member' : 'System'}</p>
                    </div>
                    <span className="shrink-0 text-xs text-[#647067]">{formatDateTime(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section aria-label="Account" className={`${card} p-6`}>
            <h2 className="mb-4 text-lg font-semibold text-[#17201A]">Account</h2>
            <dl className="space-y-3 text-sm">
              <div><dt className="text-[#647067]">Status</dt><dd className="mt-1"><StaffStatusBadge status={staff.status} /></dd></div>
              <div><dt className="text-[#647067]">Added</dt><dd className="text-[#17201A]">{formatDateTime(staff.created_at)}</dd></div>
              <div><dt className="text-[#647067]">Last sign-in</dt><dd className="text-[#17201A]">{staff.last_login_at ? formatDateTime(staff.last_login_at) : 'Never'}</dd></div>
              {staff.invitation && staff.status === 'pending' && (
                <div>
                  <dt className="text-[#647067]">Invitation</dt>
                  <dd className="text-[#17201A]">
                    <StaffStatusBadge status={staff.invitation.state} />
                    <span className="mt-1 block text-xs text-[#647067]">
                      Sent {formatDateTime(staff.invitation.sent_at)}{staff.invitation.state === 'pending' ? ` · expires ${formatDateTime(staff.invitation.expires_at)}` : ''}
                    </span>
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-5 flex flex-col gap-2">
              {staff.status === 'pending' && (
                <button onClick={() => resend.mutate()} disabled={busy} className={secondaryBtn}><Send className="h-4 w-4" /> Resend invitation</button>
              )}
              {staff.status === 'active' && (
                <>
                  <button onClick={() => resetLink.mutate()} disabled={busy} className={secondaryBtn}><KeyRound className="h-4 w-4" /> Send password reset link</button>
                  <button onClick={() => setConfirm({ kind: 'suspended' })} disabled={busy} className={secondaryBtn}><UserX className="h-4 w-4" /> Suspend</button>
                  <button onClick={() => setConfirm({ kind: 'inactive' })} disabled={busy} className={secondaryBtn}><UserMinus className="h-4 w-4" /> Deactivate</button>
                </>
              )}
              {(staff.status === 'suspended' || staff.status === 'inactive') && (
                <button onClick={() => setStatus.mutate('active')} disabled={busy} className={secondaryBtn}><UserCheck className="h-4 w-4" /> Reactivate</button>
              )}
              <button onClick={() => setConfirm({ kind: 'remove' })} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50">
                <Trash2 className="h-4 w-4" /> Remove from team
              </button>
            </div>
          </section>
        </aside>
      </div>

      <Modal show={confirm !== null} onClose={() => setConfirm(null)} maxWidth="sm">
        <div className="p-6">
          <h3 className="mb-2 text-lg font-semibold text-[#17201A]">
            {confirm?.kind === 'remove' ? 'Remove this staff member?' : confirm?.kind === 'suspended' ? 'Suspend this account?' : 'Deactivate this account?'}
          </h3>
          <p className="mb-6 text-sm text-[#647067]">
            {confirm?.kind === 'remove'
              ? `${staff.name} will be signed out and lose access permanently. Their activity history is kept.`
              : `${staff.name} will be signed out at once and cannot sign in until you reactivate the account.`}
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setConfirm(null)} className="rounded-xl border border-[#D7E8DB] bg-white px-4 py-2 text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4]">Cancel</button>
            <button
              onClick={() => (confirm?.kind === 'remove' ? remove.mutate() : confirm && setStatus.mutate(confirm.kind))}
              disabled={busy}
              className="rounded-xl bg-[#B91C1C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#991B1B] disabled:opacity-50"
            >
              {confirm?.kind === 'remove' ? 'Remove' : confirm?.kind === 'suspended' ? 'Suspend' : 'Deactivate'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Fact({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F3F8F4] text-[#16803C]"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <dt className="text-xs text-[#647067]">{label}</dt>
        <dd className="truncate text-sm font-medium text-[#17201A]">{value}</dd>
      </div>
    </div>
  )
}
