import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, MapPin, Search, ShieldAlert, ShieldCheck, UserMinus, UserPlus, Users } from 'lucide-react'
import { apiErrorMessage, del, get, post } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { Alert } from '@/shared/components/Alert'
import { Modal } from '@/shared/components/Modal'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { useDebounce } from '@/shared/hooks/use-debounce'
import { API_ENDPOINTS } from '@/shared/constants'
import { formatDate } from '@/shared/utils'
import { CreateMunicipalAccountModal } from '@/features/admin/components/CreateMunicipalAccountModal'

interface MunicipalAccount {
  id: number
  name: string
  email: string
  phone: string | null
  account_status: string
  created_at: string
  municipality_id: number | null
  municipality: string | null
}

interface AccountsResponse {
  data: MunicipalAccount[]
  meta: {
    current_page: number
    last_page: number
    per_page: number
    total: number
    stats: { total: number; active: number; suspended: number; unassigned: number; municipalities_without_account: number }
  }
}

const card = 'bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism'
const control =
  'bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/40 focus:border-[#16803C] px-3 py-2.5'

export default function AdminMunicipalityAccounts() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [municipality, setMunicipality] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [removing, setRemoving] = useState<MunicipalAccount | null>(null)
  const [assigning, setAssigning] = useState<MunicipalAccount | null>(null)
  const [assignTo, setAssignTo] = useState('')
  const [notice, setNotice] = useState('')
  const debounced = useDebounce(search)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-municipality-accounts', debounced, municipality, status, page],
    queryFn: () =>
      get<AccountsResponse>(API_ENDPOINTS.ADMIN.MUNICIPALITY_ACCOUNTS, {
        params: { search: debounced || undefined, municipality_id: municipality || undefined, status: status || undefined, page },
      }),
    placeholderData: keepPreviousData,
  })

  const { data: municipalities } = useQuery({
    queryKey: ['admin-municipalities', 'options'],
    queryFn: () => get<{ data: { id: number; name: string; is_home?: boolean; admins_count?: number }[] }>(API_ENDPOINTS.ADMIN.MUNICIPALITIES, { params: { per_page: 100 } }),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-municipality-accounts'] })
    queryClient.invalidateQueries({ queryKey: ['admin-municipalities'] })
    queryClient.invalidateQueries({ queryKey: ['admin-municipality'] })
  }

  const remove = useMutation({
    mutationFn: (account: MunicipalAccount) => del(`/admin/municipalities/${account.municipality_id}/admins/${account.id}`),
    onSuccess: (_d, account) => {
      setNotice(`${account.name} was removed from ${account.municipality} and signed out.`)
      setRemoving(null)
      refresh()
    },
  })

  const assign = useMutation({
    mutationFn: ({ account, municipalityId }: { account: MunicipalAccount; municipalityId: string }) =>
      post<{ municipality: string }>(`${API_ENDPOINTS.ADMIN.MUNICIPALITY_ACCOUNTS}/${account.id}/assign`, { municipality_id: Number(municipalityId) }),
    onSuccess: (result, { account }) => {
      setNotice(`${account.email} now manages ${result.municipality}.`)
      setAssigning(null)
      refresh()
    },
  })

  const stats = data?.meta.stats
  const accounts = data?.data ?? []
  const meta = data?.meta

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Municipality Accounts</h1>
          <p className="mt-1 text-sm lg:text-base text-[#6B7280]">
            Tourism Office accounts for each municipality under the Bansud Tourism Office. Each account manages only its own municipality.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="self-start sm:self-auto px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#16803C] text-white hover:bg-[#126B32] inline-flex items-center gap-2"
        >
          <UserPlus className="w-4 h-4" /> Create municipality account
        </button>
      </div>

      {notice && <Alert type="success" message={notice} onDismiss={() => setNotice('')} />}
      {stats && stats.municipalities_without_account > 0 && (
        <Alert type="warning" message={`${stats.municipalities_without_account} municipality(ies) have no active Tourism Office account yet.`} />
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Accounts', value: stats?.total ?? 0, icon: Users },
          { label: 'Active', value: stats?.active ?? 0, icon: ShieldCheck },
          { label: 'Suspended', value: stats?.suspended ?? 0, icon: ShieldAlert },
          { label: 'Not assigned', value: stats?.unassigned ?? 0, icon: MapPin },
        ].map((t) => (
          <div key={t.label} className={`${card} p-4`}>
            <div className="flex items-center gap-2 text-sm text-[#6B7280]">
              <t.icon className="w-4 h-4 text-[#16803C]" aria-hidden="true" /> {t.label}
            </div>
            <p className="mt-1 text-2xl font-bold text-[#17201A]">{t.value}</p>
          </div>
        ))}
      </div>

      <div className={`${card} p-4 mb-5 grid grid-cols-1 md:grid-cols-[1fr_220px_180px] gap-3`}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
          <input
            type="search"
            aria-label="Search accounts"
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className={`${control} w-full pl-10`}
          />
        </div>
        <select aria-label="Filter by municipality" value={municipality} onChange={(e) => { setMunicipality(e.target.value); setPage(1) }} className={control}>
          <option value="">All municipalities</option>
          {(municipalities?.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
          <option value="unassigned">Not assigned</option>
        </select>
        <select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className={control}>
          <option value="">All statuses</option>
          <option value="approved">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : accounts.length === 0 ? (
        <div className={`${card} p-12 text-center text-[#6B7280]`}>No municipality accounts match these filters.</div>
      ) : (
        <div className={`${card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4] text-left text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                  <th className="px-5 py-3">Account</th>
                  <th className="px-5 py-3">Municipality</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F3F0]">
                {accounts.map((a) => (
                  <tr key={a.id} className="hover:bg-[#F6F8F4]">
                    <td className="px-5 py-3">
                      <p className="font-medium text-[#17201A]">{a.name}</p>
                      <p className="text-xs text-[#6B7280]">{a.email}{a.phone ? ` · ${a.phone}` : ''}</p>
                    </td>
                    <td className="px-5 py-3">
                      {a.municipality_id ? (
                        <Link to={`/admin/municipalities/${a.municipality_id}`} className="text-[#16803C] font-medium hover:underline">
                          {a.municipality}
                        </Link>
                      ) : (
                        <span className="text-amber-700 text-xs font-semibold">Not assigned</span>
                      )}
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={a.account_status} /></td>
                    <td className="px-5 py-3 text-[#6B7280] whitespace-nowrap">{formatDate(a.created_at)}</td>
                    <td className="px-5 py-3 text-right">
                      {a.municipality_id ? (
                        <button
                          type="button"
                          onClick={() => { remove.reset(); setRemoving(a) }}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1"
                        >
                          <UserMinus className="w-3.5 h-3.5" /> Remove
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { assign.reset(); setAssignTo(''); setAssigning(a) }}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#16803C] text-white hover:bg-[#126B32]"
                        >
                          Assign & reactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {meta && meta.last_page > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-[#6B7280]">
          <span>Page {meta.current_page} of {meta.last_page}</span>
          <div className="flex gap-2">
            <button type="button" disabled={meta.current_page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-lg border border-[#D7E8DB] disabled:opacity-40">Previous</button>
            <button type="button" disabled={meta.current_page === meta.last_page} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-lg border border-[#D7E8DB] disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      <CreateMunicipalAccountModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(email, name) => {
          setNotice(`Tourism Office account ${email} created for ${name}. Share the password with the account holder securely.`)
          refresh()
        }}
      />

      <Modal show={removing !== null} onClose={() => setRemoving(null)} maxWidth="md">
        <div className="p-6 bg-white">
          <h2 className="text-lg font-semibold text-[#17201A]">Remove {removing?.name}?</h2>
          <p className="mt-1 text-sm text-[#6B7280]">
            The account loses access to {removing?.municipality}, is suspended, and is signed out of every device. You can assign it again later.
          </p>
          {remove.isError && <p className="mt-3 text-sm text-red-600">{apiErrorMessage(remove.error)}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setRemoving(null)} className="px-4 py-2 rounded-xl text-sm font-medium border border-[#E2E8E3] hover:bg-[#F3F8F4]">Cancel</button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate(removing)}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 inline-flex items-center gap-2 disabled:opacity-50"
            >
              {remove.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Remove account
            </button>
          </div>
        </div>
      </Modal>

      <Modal show={assigning !== null} onClose={() => setAssigning(null)} maxWidth="md">
        <form
          className="p-6 bg-white"
          onSubmit={(e) => {
            e.preventDefault()
            if (assigning && assignTo) assign.mutate({ account: assigning, municipalityId: assignTo })
          }}
        >
          <h2 className="text-lg font-semibold text-[#17201A]">Assign {assigning?.name}</h2>
          <p className="mt-1 text-sm text-[#6B7280]">The account is reactivated and manages only the municipality you choose.</p>
          <label htmlFor="assign-municipality" className="block mt-4 text-sm font-medium text-[#17201A]">Municipality</label>
          <select id="assign-municipality" required value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={`${control} mt-1 w-full`}>
            <option value="">Select a municipality…</option>
            {(municipalities?.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {assign.isError && <p className="mt-3 text-sm text-red-600">{apiErrorMessage(assign.error)}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setAssigning(null)} className="px-4 py-2 rounded-xl text-sm font-medium border border-[#E2E8E3] hover:bg-[#F3F8F4]">Cancel</button>
            <button type="submit" disabled={assign.isPending || !assignTo} className="px-4 py-2 rounded-xl text-sm font-semibold bg-[#16803C] text-white hover:bg-[#126B32] inline-flex items-center gap-2 disabled:opacity-50">
              {assign.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Assign & reactivate
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
