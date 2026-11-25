import { useState, type ReactNode } from 'react'
import axios from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Loader2, MapPin, Megaphone, Pencil, Plus, Trash2, type LucideIcon } from 'lucide-react'
import { apiErrorMessage, del, get, post, put } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Alert } from '@/shared/components/Alert'
import { Modal } from '@/shared/components/Modal'
import { cn, formatDate } from '@/shared/utils'
import { card, EmptyState, inputClass, ListFilters, PageHeader, Pagination, type StatusOption } from '@/features/municipal/components/MunicipalUi'

/**
 * Municipal Office plan Stage 1: a municipal Tourism Office manages its own
 * town's destinations, events and announcements. The endpoints are the shared
 * /tourism-office ones, scoped on the server (Stage 0): the town comes from the
 * officer's account, so these forms never ask for a municipality.
 */

type Row = { id: number } & Record<string, unknown>

interface Option {
  value: string
  label: string
}

interface Field {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'date' | 'url' | 'select' | 'list'
  required?: boolean
  options?: Option[]
  placeholder?: string
  /** Spans both columns of the form grid. */
  wide?: boolean
  step?: string
}

interface Column {
  label: string
  render: (row: Row) => ReactNode
}

interface ContentConfig {
  title: string
  subtitle: string
  /** Singular, lower case: "destination". */
  noun: string
  endpoint: string
  icon: LucideIcon
  searchPlaceholder: string
  statuses: StatusOption[]
  fields: Field[]
  defaults: Record<string, string>
  columns: Column[]
  /** The column that names a row, used in the delete confirmation. */
  nameKey: string
}

interface Paginated {
  data: Row[]
  current_page: number
  last_page: number
  per_page: number
  total: number
}

const STATUS_TONES: Record<string, string> = {
  active: 'bg-[#E6F2EB] text-[#2E8B57]',
  published: 'bg-[#E6F2EB] text-[#2E8B57]',
  upcoming: 'bg-sky-50 text-sky-700',
  ongoing: 'bg-[#E6F2EB] text-[#2E8B57]',
  draft: 'bg-amber-50 text-amber-700',
  inactive: 'bg-gray-100 text-gray-600',
  completed: 'bg-gray-100 text-gray-600',
  archived: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-50 text-red-600',
}

function StatusBadge({ status }: { status?: unknown }) {
  const value = String(status ?? '')
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize', STATUS_TONES[value] ?? 'bg-gray-100 text-gray-600')}>
      {value || '—'}
    </span>
  )
}

function rowToForm(fields: Field[], row: Row): Record<string, string> {
  return Object.fromEntries(
    fields.map((f) => {
      const v = row[f.key]
      if (f.type === 'list') return [f.key, Array.isArray(v) ? v.join('\n') : '']
      if (f.type === 'date') return [f.key, v ? String(v).slice(0, 10) : '']
      return [f.key, v === null || v === undefined ? '' : String(v)]
    })
  )
}

function formToPayload(fields: Field[], form: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((f) => {
      const raw = (form[f.key] ?? '').trim()
      if (f.type === 'list') return [f.key, raw ? raw.split('\n').map((s) => s.trim()).filter(Boolean) : []]
      if (raw === '') return [f.key, f.required ? '' : null]
      if (f.type === 'number') return [f.key, Number(raw)]
      if (f.type === 'select' && /^\d+$/.test(raw) && f.key.endsWith('_id')) return [f.key, Number(raw)]
      return [f.key, raw]
    })
  )
}

function ContentManager({ config }: { config: ContentConfig }) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Row | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<Record<string, string>>(config.defaults)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const listKey = ['municipal', 'content', config.endpoint, page, search, status]
  const { data, isLoading, error } = useQuery({
    queryKey: listKey,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) })
      if (search) params.set('search', search)
      if (status) params.set('status', status)
      return get<Paginated>(`${config.endpoint}?${params}`)
    },
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['municipal', 'content', config.endpoint] })

  const save = useMutation({
    mutationFn: () => {
      const payload = formToPayload(config.fields, form)
      return editing ? put(`${config.endpoint}/${editing.id}`, payload) : post(config.endpoint, payload)
    },
    onSuccess: () => {
      setNotice({ type: 'success', message: `${capitalize(config.noun)} ${editing ? 'updated' : 'created'}.` })
      setFormOpen(false)
      refresh()
    },
    onError: (e) => {
      if (axios.isAxiosError(e) && e.response?.status === 422) {
        setErrors((e.response.data as { errors?: Record<string, string[]> }).errors ?? {})
        return
      }
      setNotice({ type: 'error', message: apiErrorMessage(e, `Could not save the ${config.noun}.`) })
      setFormOpen(false)
    },
  })

  const remove = useMutation({
    mutationFn: (row: Row) => del(`${config.endpoint}/${row.id}`),
    onSuccess: () => {
      setNotice({ type: 'success', message: `${capitalize(config.noun)} deleted.` })
      setDeleting(null)
      refresh()
    },
    onError: (e) => {
      setNotice({ type: 'error', message: apiErrorMessage(e, `Could not delete the ${config.noun}.`) })
      setDeleting(null)
    },
  })

  const openForm = (row: Row | null) => {
    setEditing(row)
    setForm(row ? { ...config.defaults, ...rowToForm(config.fields, row) } : config.defaults)
    setErrors({})
    setFormOpen(true)
  }

  const missingRequired = config.fields.some((f) => f.required && !(form[f.key] ?? '').trim())
  const rows = data?.data ?? []

  return (
    <div>
      <PageHeader
        title={config.title}
        subtitle={config.subtitle}
        actions={
          <button
            type="button"
            onClick={() => openForm(null)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#2E8B57] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#257347]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add {config.noun}
          </button>
        }
      />

      {notice && (
        <div className="mb-4">
          <Alert key={notice.message} type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />
        </div>
      )}

      <ListFilters
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1) }}
        placeholder={config.searchPlaceholder}
        status={status}
        onStatus={(v) => { setStatus(v); setPage(1) }}
        options={config.statuses}
      />

      {isLoading ? (
        <DashboardSkeleton />
      ) : error ? (
        <Alert type="error" message={apiErrorMessage(error, `Could not load ${config.title.toLowerCase()}.`)} />
      ) : rows.length === 0 ? (
        <EmptyState icon={config.icon} message={`No ${config.title.toLowerCase()} yet.`} />
      ) : (
        <div className={cn(card, 'overflow-hidden')}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E7E2D6] bg-[#FAF7F0]">
                  {config.columns.map((c) => (
                    <th key={c.label} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[#66736B]">{c.label}</th>
                  ))}
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[#66736B]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0ECE2]">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-[#FAF7F0]/60">
                    {config.columns.map((c) => (
                      <td key={c.label} className="px-5 py-3 text-[#1C2B22]">{c.render(row)}</td>
                    ))}
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => openForm(row)} className="rounded-lg p-2 text-[#2E8B57] hover:bg-[#E6F2EB]" aria-label={`Edit ${String(row[config.nameKey])}`}>
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => setDeleting(row)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label={`Delete ${String(row[config.nameKey])}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination meta={data ? { ...data, stats: {} } : undefined} onPage={setPage} noun={`${config.noun}s`} />

      <Modal show={formOpen} onClose={() => !save.isPending && setFormOpen(false)} maxWidth="2xl">
        <form
          className="p-6"
          onSubmit={(e) => {
            e.preventDefault()
            setErrors({})
            save.mutate()
          }}
        >
          <h2 className="text-lg font-semibold text-[#1C2B22]">{editing ? `Edit ${config.noun}` : `Add ${config.noun}`}</h2>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {config.fields.map((f) => (
              <label key={f.key} className={cn('block', (f.wide || f.type === 'textarea' || f.type === 'list') && 'sm:col-span-2')}>
                <span className="mb-1.5 block text-xs font-medium text-[#2E8B57]">
                  {f.label}
                  {f.required && ' *'}
                </span>
                {f.type === 'textarea' || f.type === 'list' ? (
                  <textarea
                    rows={f.type === 'list' ? 3 : 4}
                    value={form[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    className={inputClass}
                  />
                ) : f.type === 'select' ? (
                  <select value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className={inputClass}>
                    {!f.required || !form[f.key] ? <option value="">Select…</option> : null}
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type}
                    step={f.step}
                    value={form[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    className={inputClass}
                  />
                )}
                {errors[f.key]?.[0] && <span className="mt-1 block text-xs text-red-600">{errors[f.key]?.[0]}</span>}
              </label>
            ))}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => setFormOpen(false)} disabled={save.isPending} className="rounded-xl border border-[#E7E2D6] px-4 py-2.5 text-sm font-medium text-[#1C2B22] hover:bg-[#FAF7F0]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={missingRequired || save.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2E8B57] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#257347] disabled:opacity-50"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {editing ? 'Save changes' : `Create ${config.noun}`}
            </button>
          </div>
        </form>
      </Modal>

      <Modal show={deleting !== null} onClose={() => !remove.isPending && setDeleting(null)} maxWidth="md">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-[#1C2B22]">Delete {config.noun}?</h2>
          <p className="mt-2 text-sm text-[#66736B]">
            “{String(deleting?.[config.nameKey] ?? '')}” will be removed for good. Tourists will no longer see it.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(null)} disabled={remove.isPending} className="rounded-xl border border-[#E7E2D6] px-4 py-2.5 text-sm font-medium text-[#1C2B22] hover:bg-[#FAF7F0]">
              Keep it
            </button>
            <button
              type="button"
              onClick={() => deleting && remove.mutate(deleting)}
              disabled={remove.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {remove.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Delete
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const text = (key: string) => (row: Row) => String(row[key] ?? '—')

// ─── Destinations ────────────────────────────────────────────────────────

export function MunicipalDestinations() {
  const { data: categories } = useQuery({
    queryKey: ['municipal', 'tourism-categories'],
    queryFn: () => get<{ id: number; name: string }[]>('/tourism-office/categories'),
    staleTime: 10 * 60_000,
  })
  const categoryOptions = (categories ?? []).map((c) => ({ value: String(c.id), label: c.name }))

  return (
    <ContentManager
      config={{
        title: 'Destinations',
        subtitle: 'Tourist spots in your municipality that tourists can discover.',
        noun: 'destination',
        endpoint: '/tourism-office/destinations',
        icon: MapPin,
        searchPlaceholder: 'Search by name or address',
        statuses: [
          { value: '', label: 'All' },
          { value: 'active', label: 'Active' },
          { value: 'draft', label: 'Draft' },
          { value: 'inactive', label: 'Inactive' },
        ],
        nameKey: 'name',
        defaults: { status: 'draft' },
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true, wide: true },
          { key: 'category_id', label: 'Category', type: 'select', required: true, options: categoryOptions },
          { key: 'status', label: 'Status', type: 'select', required: true, options: [
            { value: 'draft', label: 'Draft (hidden from tourists)' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ] },
          { key: 'description', label: 'Description', type: 'textarea', required: true },
          { key: 'address', label: 'Address', type: 'text', required: true, wide: true },
          { key: 'latitude', label: 'Latitude', type: 'number', required: true, step: 'any', placeholder: 'e.g. 12.8642' },
          { key: 'longitude', label: 'Longitude', type: 'number', required: true, step: 'any', placeholder: 'e.g. 121.4547' },
          { key: 'opening_hours', label: 'Opening hours', type: 'text', placeholder: 'e.g. 8:00 AM – 5:00 PM' },
          { key: 'entrance_fee', label: 'Entrance fee (₱)', type: 'number', step: '0.01' },
          { key: 'contact_number', label: 'Contact number', type: 'text' },
          { key: 'images', label: 'Photo links', type: 'list', placeholder: 'One image link (https://…) per line' },
          { key: 'amenities', label: 'Amenities', type: 'list', placeholder: 'One per line, e.g. Parking' },
        ],
        columns: [
          { label: 'Destination', render: (r) => <span className="font-medium">{String(r.name)}</span> },
          { label: 'Category', render: (r) => (r.category as { name?: string } | null)?.name ?? '—' },
          { label: 'Address', render: text('address') },
          { label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ],
      }}
    />
  )
}

// ─── Events ──────────────────────────────────────────────────────────────

export function MunicipalEvents() {
  return (
    <ContentManager
      config={{
        title: 'Events',
        subtitle: 'Festivals and activities happening in your municipality.',
        noun: 'event',
        endpoint: '/tourism-office/events',
        icon: CalendarDays,
        searchPlaceholder: 'Search by name or location',
        statuses: [
          { value: '', label: 'All' },
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'ongoing', label: 'Ongoing' },
          { value: 'completed', label: 'Completed' },
          { value: 'cancelled', label: 'Cancelled' },
        ],
        nameKey: 'name',
        defaults: { status: 'upcoming' },
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true, wide: true },
          { key: 'description', label: 'Description', type: 'textarea', required: true },
          { key: 'location', label: 'Location', type: 'text', required: true, wide: true },
          { key: 'start_date', label: 'Start date', type: 'date', required: true },
          { key: 'end_date', label: 'End date', type: 'date', required: true },
          { key: 'image', label: 'Image link', type: 'url', placeholder: 'https://…' },
          { key: 'status', label: 'Status', type: 'select', required: true, options: [
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'ongoing', label: 'Ongoing' },
            { value: 'completed', label: 'Completed' },
            { value: 'cancelled', label: 'Cancelled' },
          ] },
        ],
        columns: [
          { label: 'Event', render: (r) => <span className="font-medium">{String(r.name)}</span> },
          { label: 'Location', render: text('location') },
          { label: 'Dates', render: (r) => `${formatDate(String(r.start_date))} – ${formatDate(String(r.end_date))}` },
          { label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ],
      }}
    />
  )
}

// ─── Announcements ───────────────────────────────────────────────────────

const ANNOUNCEMENT_TYPES = ['general', 'emergency', 'event', 'weather', 'health', 'safety']

export function MunicipalAnnouncements() {
  return (
    <ContentManager
      config={{
        title: 'Announcements',
        subtitle: 'News and advisories for tourists visiting your municipality.',
        noun: 'announcement',
        endpoint: '/tourism-office/announcements',
        icon: Megaphone,
        searchPlaceholder: 'Search by title or content',
        statuses: [
          { value: '', label: 'All' },
          { value: 'published', label: 'Published' },
          { value: 'draft', label: 'Draft' },
          { value: 'archived', label: 'Archived' },
        ],
        nameKey: 'title',
        defaults: { status: 'draft', type: 'general' },
        fields: [
          { key: 'title', label: 'Title', type: 'text', required: true, wide: true },
          { key: 'type', label: 'Type', type: 'select', required: true, options: ANNOUNCEMENT_TYPES.map((t) => ({ value: t, label: capitalize(t) })) },
          { key: 'status', label: 'Status', type: 'select', required: true, options: [
            { value: 'draft', label: 'Draft (hidden from tourists)' },
            { value: 'published', label: 'Published' },
            { value: 'archived', label: 'Archived' },
          ] },
          { key: 'content', label: 'Message', type: 'textarea', required: true },
        ],
        columns: [
          { label: 'Title', render: (r) => <span className="font-medium">{String(r.title)}</span> },
          { label: 'Type', render: (r) => <span className="capitalize">{String(r.type ?? '—')}</span> },
          { label: 'Published', render: (r) => (r.published_at ? formatDate(String(r.published_at)) : '—') },
          { label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ],
      }}
    />
  )
}
