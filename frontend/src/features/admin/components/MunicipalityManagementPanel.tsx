import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Bike, Loader2, Pencil, ShieldCheck, Store, Trash2, UserCheck, UserMinus, UserPlus, Users } from 'lucide-react'
import { Modal } from '@/shared/components/Modal'
import { Alert } from '@/shared/components/Alert'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { apiErrorMessage, del, get } from '@/shared/services/api'
import { formatDate, formatDateTime } from '@/shared/utils'
import { MunicipalityFormModal, type MunicipalityFormValues } from '@/features/admin/components/MunicipalityFormModal'
import { CreateMunicipalAccountModal } from '@/features/admin/components/CreateMunicipalAccountModal'

export interface MunicipalAdmin {
  id: number
  name: string
  email: string
  phone: string | null
  account_status: string
  created_at: string
}

export interface MunicipalityManagementStats {
  all_businesses_count?: number
  pending_businesses_count?: number
  business_owners_count?: number
  riders_count?: number
  pending_riders_count?: number
  tourists_count?: number
  admins_count?: number
}

const card = 'bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism'

/**
 * Bansud Tourism Office (super admin) controls for one municipality:
 * monitoring counts, its Tourism Office accounts, edit and delete.
 */
export function MunicipalityManagementPanel({
  municipality,
  isHome,
  stats,
  admins,
}: {
  municipality: MunicipalityFormValues & { id: number }
  isHome: boolean
  stats: MunicipalityManagementStats
  admins: MunicipalAdmin[]
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [removing, setRemoving] = useState<MunicipalAdmin | null>(null)
  const [notice, setNotice] = useState('')

  const { data: activity } = useQuery({
    queryKey: ['admin-municipality', municipality.id, 'activity'],
    queryFn: () =>
      get<{ data: { id: number; description: string; user_name: string; created_at: string }[] }>('/admin/audit-logs', {
        params: { municipality_id: municipality.id },
      }),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-municipality'] })
    queryClient.invalidateQueries({ queryKey: ['admin-municipalities'] })
  }

  const remove = useMutation({
    mutationFn: (adminId: number) => del(`/admin/municipalities/${municipality.id}/admins/${adminId}`),
    onSuccess: () => {
      setNotice(`${removing?.name} was removed and signed out.`)
      setRemoving(null)
      refresh()
    },
  })

  const destroy = useMutation({
    mutationFn: () => del(`/admin/municipalities/${municipality.id}`),
    onSuccess: () => {
      refresh()
      navigate('/admin/municipalities')
    },
  })

  const tiles = [
    { label: 'Businesses', value: stats.all_businesses_count ?? 0, hint: `${stats.pending_businesses_count ?? 0} pending`, icon: Store },
    { label: 'Business owners', value: stats.business_owners_count ?? 0, icon: Users },
    { label: 'Riders', value: stats.riders_count ?? 0, hint: `${stats.pending_riders_count ?? 0} pending`, icon: Bike },
    { label: 'Tourists served', value: stats.tourists_count ?? 0, icon: UserCheck },
  ]

  return (
    <div className="space-y-6 mb-6">
      {notice && <Alert type="success" message={notice} onDismiss={() => setNotice('')} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map((t) => (
          <div key={t.label} className={`${card} p-4`}>
            <div className="flex items-center gap-2 text-sm text-[#6B7280]">
              <t.icon className="w-4 h-4 text-[#16803C]" aria-hidden="true" />
              {t.label}
            </div>
            <p className="mt-1 text-2xl font-bold text-[#17201A]">{t.value}</p>
            {t.hint && <p className="text-xs text-[#6B7280]">{t.hint}</p>}
          </div>
        ))}
      </div>

      <section className={card} aria-label="Tourism Office accounts">
        <div className="px-5 py-4 border-b border-[#E2E8E3] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#17201A] flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#16803C]" aria-hidden="true" />
              {municipality.name} Tourism Office accounts
            </h2>
            <p className="text-xs text-[#6B7280]">
              {isHome
                ? 'Bansud is managed by the Bansud Tourism Office. Extra accounts here are scoped to Bansud only.'
                : `These accounts manage only ${municipality.name}'s business owners, businesses, riders and tourists.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="px-3 py-2 rounded-xl text-sm font-medium border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] inline-flex items-center gap-1.5"
            >
              <Pencil className="w-4 h-4" /> Edit details
            </button>
            {!isHome && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-2 rounded-xl text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            )}
            <button
              type="button"
              onClick={() => setAdminOpen(true)}
              className="px-3 py-2 rounded-xl text-sm font-semibold bg-[#16803C] text-white hover:bg-[#126B32] inline-flex items-center gap-1.5"
            >
              <UserPlus className="w-4 h-4" /> Add Tourism Office account
            </button>
          </div>
        </div>
        {admins.length === 0 ? (
          <p className="px-5 py-8 text-sm text-center text-[#6B7280]">
            No Tourism Office account yet. Add one so {municipality.name} can manage its own businesses and riders.
          </p>
        ) : (
          <ul className="divide-y divide-[#F0F3F0]">
            {admins.map((a) => (
              <li key={a.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#17201A]">{a.name}</p>
                  <p className="text-xs text-[#6B7280]">
                    {a.email}
                    {a.phone ? ` · ${a.phone}` : ''} · added {formatDate(a.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.account_status} />
                  <button
                    type="button"
                    onClick={() => {
                      remove.reset()
                      setRemoving(a)
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1"
                  >
                    <UserMinus className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card} aria-label="Tourism Office activity">
        <div className="px-5 py-4 border-b border-[#E2E8E3]">
          <h2 className="text-base font-semibold text-[#17201A] flex items-center gap-2">
            <Activity className="w-5 h-5 text-[#16803C]" aria-hidden="true" />
            Recent {municipality.name} Tourism Office activity
          </h2>
          <p className="text-xs text-[#6B7280]">Approvals, suspensions and document decisions made by this municipality.</p>
        </div>
        {!activity || activity.data.length === 0 ? (
          <p className="px-5 py-6 text-sm text-center text-[#6B7280]">No activity recorded yet.</p>
        ) : (
          <ul className="divide-y divide-[#F0F3F0]">
            {activity.data.slice(0, 8).map((log) => (
              <li key={log.id} className="px-5 py-3 text-sm">
                <p className="text-[#17201A]">{log.description}</p>
                <p className="text-xs text-[#6B7280]">
                  {log.user_name} · {formatDateTime(log.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MunicipalityFormModal open={editOpen} initial={municipality} onClose={() => setEditOpen(false)} />
      <CreateMunicipalAccountModal
        open={adminOpen}
        municipality={{ id: municipality.id, name: municipality.name }}
        onClose={() => setAdminOpen(false)}
        onCreated={(email) => {
          setNotice(`Tourism Office account ${email} created. Share the password with the account holder securely.`)
          refresh()
        }}
      />

      <ConfirmModal
        open={removing !== null}
        title={`Remove ${removing?.name ?? ''}?`}
        body={`The account loses access to ${municipality.name}, is suspended, and is signed out of every device.`}
        confirmLabel="Remove account"
        pending={remove.isPending}
        error={remove.isError ? apiErrorMessage(remove.error) : undefined}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
      <ConfirmModal
        open={confirmDelete}
        title={`Delete ${municipality.name}?`}
        body="Only a municipality with no businesses, riders or Tourism Office accounts can be deleted."
        confirmLabel="Delete municipality"
        pending={destroy.isPending}
        error={destroy.isError ? apiErrorMessage(destroy.error) : undefined}
        onCancel={() => {
          destroy.reset()
          setConfirmDelete(false)
        }}
        onConfirm={() => destroy.mutate()}
      />
    </div>
  )
}

function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  pending: boolean
  error?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal show={open} onClose={onCancel} maxWidth="md">
      <div className="p-6 bg-white">
        <h2 className="text-lg font-semibold text-[#17201A]">{title}</h2>
        <p className="mt-1 text-sm text-[#6B7280]">{body}</p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-medium border border-[#E2E8E3] hover:bg-[#F3F8F4]">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 inline-flex items-center gap-2 disabled:opacity-50"
          >
            {pending && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
