import { useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft, Copy, Lock, Pencil, Plus, Shield, Trash2, Users, X } from 'lucide-react'
import { apiErrorMessage, del, get, post, put } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { useBusinessOwnerStore } from '../services/business-owner-store'

/** GET /business-owner/roles (Staff Management §6). */
export interface RoleModule {
  key: string
  label: string
  description: string
  permissions: { key: string; label: string }[]
}

export interface RoleRow {
  id: number
  name: string
  description: string | null
  is_custom: boolean
  permissions: string[]
  modules: string[]
  staff_count: number
  staff: { id: number; name: string; status: string }[]
}

interface RolesPage {
  business: { id: number; name: string; category: string | null }
  modules: RoleModule[]
  owner_only: string[]
  built_in: RoleRow[]
  custom: RoleRow[]
  max_custom_roles: number
}

interface Draft {
  id: number | null
  name: string
  description: string
  permissions: string[]
  staffCount: number
}

/** A "manage" permission needs the matching view; mirrors StaffPermissions::IMPLIES. */
const IMPLIES: Record<string, string> = {
  'orders.update': 'orders.view',
  'orders.reject': 'orders.view',
  'menu.manage': 'menu.view',
  'bookings.update': 'bookings.view',
}

export function togglePermission(current: string[], key: string): string[] {
  if (current.includes(key)) {
    // Removing a view removes what depends on it.
    const dependants = Object.entries(IMPLIES).filter(([, view]) => view === key).map(([p]) => p)
    return current.filter((p) => p !== key && !dependants.includes(p))
  }
  const next = [...current, key]
  if (IMPLIES[key] && !next.includes(IMPLIES[key])) next.push(IMPLIES[key])
  return next
}

const card = 'rounded-[20px] border border-[#E2E8E3] bg-white p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)]'
const input = 'w-full rounded-xl border border-[#E2E8E3] bg-white px-3.5 py-2.5 text-sm text-[#17201B] placeholder-[#9CA3AF] focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25'

/**
 * Roles & Permissions (Staff Management §6): the built-in staff roles for the
 * business type (read-only) and the owner's own roles, each managing the
 * modules the owner ticks. Changes apply to every staff member holding the
 * role at once; the server records that in each one's activity.
 */
export default function BusinessOwnerRoles() {
  const queryClient = useQueryClient()
  const businessId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deleting, setDeleting] = useState<RoleRow | null>(null)
  const [viewing, setViewing] = useState<RoleRow | null>(null)
  const [notice, setNotice] = useState('')

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['bo-roles', businessId],
    queryFn: () => get<RolesPage>(`/business-owner/roles${businessId ? `?business_id=${businessId}` : ''}`),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['bo-roles'] })
    queryClient.invalidateQueries({ queryKey: ['bo-staff-roles'] })
  }

  if (isLoading) return <DashboardSkeleton />
  if (isError || !data) {
    return (
      <div className={`${card} flex items-center gap-3 text-sm text-[#B91C1C]`}>
        <AlertCircle className="h-5 w-5" /> {apiErrorMessage(error, 'Could not load roles.')}
      </div>
    )
  }

  const moduleLabel = (key: string) => data.modules.find((m) => m.key === key)?.label
    ?? key.replace(/_/g, ' ')
  const atLimit = data.custom.length >= data.max_custom_roles
  const openNew = (from?: RoleRow) => setDraft({
    id: null,
    name: from ? `${from.name} (copy)`.slice(0, 50) : '',
    description: from?.description ?? '',
    permissions: from ? from.permissions.filter((p) => data.modules.some((m) => m.permissions.some((x) => x.key === p))) : [],
    staffCount: 0,
  })

  const roleCard = (role: RoleRow) => (
    <div key={role.id} className={card} data-testid={`role-${role.id}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E2E8E3] bg-[#F3F8F4]">
            <Shield className="h-5 w-5 text-[#16803C]" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-[#17201A]">{role.name}</h3>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${role.is_custom ? 'bg-[#EAF6ED] text-[#126B32]' : 'bg-[#F1F5F9] text-[#475569]'}`}>
                {role.is_custom ? 'Custom' : 'Built-in'}
              </span>
            </div>
            {role.description && <p className="mt-0.5 text-sm text-[#647067]">{role.description}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {role.modules.length === 0
                ? <span className="text-xs text-[#9CA3AF]">No modules</span>
                : role.modules.map((m) => (
                  <span key={m} className="rounded-lg border border-[#E2E8E3] bg-[#F6F8F4] px-2 py-0.5 text-xs text-[#374151]">{moduleLabel(m)}</span>
                ))}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => setViewing(role)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-[#647067] hover:bg-[#F3F8F4]">
            <Users className="h-4 w-4" /> {role.staff_count} staff
          </button>
          {role.is_custom ? (
            <>
              <button type="button" aria-label={`Edit ${role.name}`} onClick={() => setDraft({ id: role.id, name: role.name, description: role.description ?? '', permissions: role.permissions, staffCount: role.staff_count })} className="rounded-lg p-2 text-[#16803C] hover:bg-[#EAF6ED]">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" aria-label={`Delete ${role.name}`} onClick={() => setDeleting(role)} className="rounded-lg p-2 text-[#B91C1C] hover:bg-[#FEF2F2]">
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          ) : (
            <button type="button" disabled={atLimit} onClick={() => openNew(role)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[#16803C] hover:bg-[#EAF6ED] disabled:opacity-40">
              <Copy className="h-4 w-4" /> Duplicate
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div>
      <Link to="/business-owner/dashboard" className="mb-6 inline-flex items-center gap-2 text-sm text-[#647067] transition hover:text-[#17201A]">
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </Link>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#126B32] lg:text-3xl">User Roles &amp; Permissions</h1>
          <p className="mt-1 text-sm text-[#647067]">Choose what each staff role can manage at {data.business.name}.</p>
        </div>
        <button type="button" disabled={atLimit} onClick={() => openNew()} className="inline-flex items-center gap-2 self-start rounded-xl bg-[#16803C] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#126B32] disabled:opacity-50">
          <Plus className="h-4 w-4" /> Add role
        </button>
      </div>

      {notice && (
        <div role="status" className="mb-4 flex items-center justify-between rounded-xl border border-[#BBE5C8] bg-[#EAF6ED] px-4 py-2.5 text-sm text-[#126B32]">
          {notice}
          <button type="button" aria-label="Dismiss" onClick={() => setNotice('')}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-8">
          <section>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[#647067]">Staff roles</h2>
            <p className="mb-3 text-xs text-[#647067]">Ready-made for this type of business. Duplicate one to make your own version.</p>
            <div className="space-y-3">
              {data.built_in.length === 0
                ? <p className="text-sm text-[#647067]">No ready-made roles for this type of business.</p>
                : data.built_in.map(roleCard)}
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[#647067]">Your roles</h2>
            <p className="mb-3 text-xs text-[#647067]">{data.custom.length} of {data.max_custom_roles} roles</p>
            <div className="space-y-3">
              {data.custom.length === 0 ? (
                <div className={`${card} text-center`}>
                  <p className="text-sm text-[#647067]">You haven't added any roles yet.</p>
                  <button type="button" onClick={() => openNew()} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#16803C] hover:text-[#126B32]">
                    <Plus className="h-4 w-4" /> Add a role
                  </button>
                </div>
              ) : data.custom.map(roleCard)}
            </div>
          </section>
        </div>

        <aside className={`${card} h-fit`}>
          <div className="mb-2 flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#647067]" />
            <h2 className="text-sm font-semibold text-[#17201A]">Owner only</h2>
          </div>
          <p className="mb-3 text-xs text-[#647067]">No role can do these, whatever you choose.</p>
          <ul className="space-y-2">
            {data.owner_only.map((label) => (
              <li key={label} className="flex items-start gap-2 text-sm text-[#4B5563]">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" /> {label}
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {draft && (
        <RoleEditor
          draft={draft}
          businessId={data.business.id}
          modules={data.modules}
          onClose={() => setDraft(null)}
          onSaved={(message) => { setDraft(null); setNotice(message); refresh() }}
        />
      )}

      {deleting && (
        <DeleteRole role={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); setNotice(`${deleting.name} was deleted.`); refresh() }} />
      )}

      <Modal show={viewing !== null} onClose={() => setViewing(null)} maxWidth="md">
        {viewing && (
          <div className="bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#17201A]">{viewing.name}</h2>
              <button type="button" aria-label="Close" onClick={() => setViewing(null)}><X className="h-5 w-5 text-[#647067]" /></button>
            </div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#647067]">Can do</h3>
            <ul className="mb-5 space-y-1 text-sm text-[#374151]">
              {data.modules.flatMap((m) => m.permissions).filter((p) => viewing.permissions.includes(p.key)).map((p) => (
                <li key={p.key}>• {p.label}</li>
              ))}
            </ul>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#647067]">Staff with this role</h3>
            {viewing.staff.length === 0 ? <p className="text-sm text-[#647067]">Nobody yet.</p> : (
              <ul className="space-y-1.5">
                {viewing.staff.map((s) => (
                  <li key={s.id} className="flex items-center justify-between text-sm">
                    <Link to={`/business-owner/staff/${s.id}`} className="text-[#16803C] hover:underline">{s.name}</Link>
                    <span className="text-xs capitalize text-[#647067]">{s.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function RoleEditor({ draft, businessId, modules, onClose, onSaved }: {
  draft: Draft
  businessId: number
  modules: RoleModule[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [name, setName] = useState(draft.name)
  const [description, setDescription] = useState(draft.description)
  const [permissions, setPermissions] = useState<string[]>(draft.permissions)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')

  const save = useMutation({
    mutationFn: () => {
      const body = { business_id: businessId, name, description, permissions }
      return draft.id ? put<RoleRow>(`/business-owner/roles/${draft.id}`, body) : post<RoleRow>('/business-owner/roles', body)
    },
    onSuccess: (role) => onSaved(draft.id ? `${role.name} was updated.` : `${role.name} was added.`),
    onError: (err) => {
      const fieldErrors = axios.isAxiosError(err) ? (err.response?.data as { errors?: Record<string, string[]> })?.errors : undefined
      if (fieldErrors) {
        const mapped: Record<string, string> = {}
        for (const [field, messages] of Object.entries(fieldErrors)) mapped[field.startsWith('permissions') ? 'permissions' : field] = messages[0] ?? ''
        setErrors(mapped)
        setFormError('')
      } else {
        setFormError(apiErrorMessage(err, 'Could not save the role.'))
      }
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const local: Record<string, string> = {}
    if (name.trim().length < 2) local.name = 'Give the role a name (at least 2 characters).'
    if (permissions.length === 0) local.permissions = 'Choose at least one module this role can manage.'
    setErrors(local)
    if (Object.keys(local).length === 0) save.mutate()
  }

  const toggleModule = (module: RoleModule) => {
    const keys = module.permissions.map((p) => p.key)
    const allOn = keys.every((k) => permissions.includes(k))
    setPermissions(allOn ? permissions.filter((p) => !keys.includes(p)) : [...new Set([...permissions, ...keys])])
  }

  return (
    <Modal show onClose={onClose} maxWidth="2xl">
      <form onSubmit={submit} className="bg-white" noValidate>
        <div className="flex items-center justify-between border-b border-[#E2E8E3] px-6 py-4">
          <h2 className="text-lg font-semibold text-[#17201A]">{draft.id ? 'Edit role' : 'Add role'}</h2>
          <button type="button" aria-label="Close" onClick={onClose}><X className="h-5 w-5 text-[#647067]" /></button>
        </div>

        <div className="max-h-[65vh] space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <label htmlFor="role-name" className="mb-1.5 block text-sm font-medium text-[#4B5563]">Role name</label>
            <input id="role-name" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cashier" className={input} />
            {errors.name && <p className="mt-1 text-xs text-[#B91C1C]">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="role-description" className="mb-1.5 block text-sm font-medium text-[#4B5563]">Description <span className="text-[#9CA3AF]">(optional)</span></label>
            <input id="role-description" value={description} maxLength={255} onChange={(e) => setDescription(e.target.value)} placeholder="What this person does" className={input} />
            {errors.description && <p className="mt-1 text-xs text-[#B91C1C]">{errors.description}</p>}
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-[#4B5563]">Modules this role can manage</legend>
            <p className="mb-3 text-xs text-[#647067]">Tick a module to allow everything in it, or choose single actions.</p>
            <div className="space-y-2.5">
              {modules.map((module) => {
                const keys = module.permissions.map((p) => p.key)
                const on = keys.filter((k) => permissions.includes(k)).length
                return (
                  <div key={module.key} className={`rounded-xl border px-4 py-3 ${on > 0 ? 'border-[#16803C] bg-[#F3FAF5]' : 'border-[#E2E8E3]'}`}>
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        aria-label={module.label}
                        checked={on === keys.length}
                        ref={(el) => { if (el) el.indeterminate = on > 0 && on < keys.length }}
                        onChange={() => toggleModule(module)}
                        className="mt-0.5 h-4 w-4 accent-[#16803C]"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-[#17201A]">{module.label}</span>
                        <span className="block text-xs text-[#647067]">{module.description}</span>
                      </span>
                    </label>
                    {keys.length > 1 && (
                      <div className="ml-7 mt-2 space-y-1.5">
                        {module.permissions.map((p) => (
                          <label key={p.key} className="flex cursor-pointer items-center gap-2 text-sm text-[#374151]">
                            <input type="checkbox" checked={permissions.includes(p.key)} onChange={() => setPermissions(togglePermission(permissions, p.key))} className="h-3.5 w-3.5 accent-[#16803C]" />
                            {p.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {errors.permissions && <p className="mt-2 text-xs text-[#B91C1C]">{errors.permissions}</p>}
          </fieldset>

          {draft.staffCount > 0 && (
            <p className="flex items-start gap-2 rounded-xl bg-[#FFF7E6] px-3.5 py-2.5 text-sm text-[#8A5A00]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              This changes access for {draft.staffCount} staff {draft.staffCount === 1 ? 'member' : 'members'} right away.
            </p>
          )}
          {formError && <p className="text-sm text-[#B91C1C]">{formError}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#E2E8E3] px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-[#647067] hover:bg-[#F3F8F4]">Cancel</button>
          <button type="submit" disabled={save.isPending} className="rounded-xl bg-[#16803C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#126B32] disabled:opacity-60">
            {save.isPending ? 'Saving…' : draft.id ? 'Save changes' : 'Add role'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteRole({ role, onClose, onDeleted }: { role: RoleRow; onClose: () => void; onDeleted: () => void }) {
  const remove = useMutation({ mutationFn: () => del(`/business-owner/roles/${role.id}`), onSuccess: onDeleted })
  const held = role.staff_count > 0

  return (
    <Modal show onClose={onClose} maxWidth="md">
      <div className="bg-white p-6">
        <h2 className="text-lg font-semibold text-[#17201A]">Delete {role.name}?</h2>
        {held ? (
          <>
            <p className="mt-2 text-sm text-[#647067]">Give these staff another role first:</p>
            <ul className="mt-2 space-y-1">
              {role.staff.map((s) => (
                <li key={s.id}><Link to={`/business-owner/staff/${s.id}/edit`} className="text-sm text-[#16803C] hover:underline">{s.name}</Link></li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-sm text-[#647067]">Nobody has this role. This can't be undone.</p>
        )}
        {remove.isError && <p className="mt-3 text-sm text-[#B91C1C]">{apiErrorMessage(remove.error, 'Could not delete the role.')}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-[#647067] hover:bg-[#F3F8F4]">Cancel</button>
          <button type="button" disabled={held || remove.isPending} onClick={() => remove.mutate()} className="rounded-xl bg-[#B91C1C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#991B1B] disabled:opacity-50">
            {remove.isPending ? 'Deleting…' : 'Delete role'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
