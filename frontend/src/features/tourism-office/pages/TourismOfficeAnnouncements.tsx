import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDate } from '@/shared/utils'
import { Megaphone, Plus, Pencil, Trash2, X } from 'lucide-react'

interface Announcement {
  id: number
  title: string
  content: string
  type: string
  status: string
  published_at: string | null
  municipality: { id: number; name: string }
  created_at: string
}

interface Municipality {
  id: number
  name: string
}

interface PaginatedData {
  data: Announcement[]
  current_page: number
  last_page: number
  per_page: number
  total: number
}

const defaultForm = {
  title: '',
  content: '',
  type: 'general' as string,
  municipality_id: '',
  status: 'draft' as string,
}

const TYPE_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'event', label: 'Event' },
  { value: 'weather', label: 'Weather' },
  { value: 'health', label: 'Health' },
  { value: 'safety', label: 'Safety' },
]

export default function TourismOfficeAnnouncements() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [form, setForm] = useState(defaultForm)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['to-announcements', page, search, statusFilter, typeFilter],
    queryFn: () => get<PaginatedData>(`/tourism-office/announcements?page=${page}&search=${search}&status=${statusFilter}&type=${typeFilter}`),
  })

  const { data: munData } = useQuery({
    queryKey: ['to-municipalities'],
    queryFn: () => get<{ data: Municipality[] }>('/tourism-office/municipalities'),
  })

  const openModal = (a?: Announcement) => {
    if (a) {
      setEditing(a)
      setForm({
        title: a.title,
        content: a.content,
        type: a.type,
        municipality_id: String(a.municipality?.id ?? ''),
        status: a.status,
      })
    } else {
      setEditing(null)
      setForm(defaultForm)
    }
    setShowModal(true)
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title,
        content: form.content,
        type: form.type,
        municipality_id: parseInt(form.municipality_id),
        status: form.status,
        published_at: form.status === 'published' ? new Date().toISOString() : null,
      }
      return editing
        ? put(`/tourism-office/announcements/${editing.id}`, payload)
        : post('/tourism-office/announcements', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['to-announcements'] })
      setShowModal(false)
      setEditing(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => del(`/tourism-office/announcements/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['to-announcements'] })
      setConfirmDelete(null)
    },
  })

  const announcements = data?.data ?? []
  const totalPages = data?.last_page ?? 1

  const typeColor = (type: string) => {
    const map: Record<string, string> = {
      emergency: 'bg-red-900/20 text-red-300 border border-red-800/50',
      weather: 'bg-blue-900/20 text-blue-300 border border-blue-800/50',
      health: 'bg-amber-900/20 text-amber-300 border border-amber-800/50',
      safety: 'bg-orange-900/20 text-orange-300 border border-orange-800/50',
      event: 'bg-purple-900/20 text-purple-300 border border-purple-800/50',
    }
    return map[type] ?? 'bg-gray-800 text-gray-400 border border-gray-700/50'
  }

  return (
    <div>
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">Announcements</h1>
          <p className="mt-1 text-sm text-gray-400">Manage tourism announcements and notices</p>
        </div>
        <button onClick={() => openModal()} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition">
          <Plus className="w-4 h-4" /> Add Announcement
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Search announcements..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="flex-1 bg-gray-900/60 border border-gray-700/50 rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-600/50"
        />
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }} className="bg-gray-900/60 border border-gray-700/50 rounded-xl px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50">
          <option value="">All Types</option>
          {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }} className="bg-gray-900/60 border border-gray-700/50 rounded-xl px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50">
          <option value="">All Status</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {isLoading ? <DashboardSkeleton /> : announcements.length === 0 ? (
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-12 text-center">
          <Megaphone className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No announcements found.</p>
        </div>
      ) : (
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800/50 bg-gray-800/30">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Title</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Type</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Municipality</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Published</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {announcements.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-100">{a.title}</p>
                      <p className="text-xs text-gray-500 truncate max-w-[250px]">{a.content}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${typeColor(a.type)}`}>{a.type}</span>
                    </td>
                    <td className="px-5 py-3 text-gray-300">{a.municipality?.name ?? '-'}</td>
                    <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{a.published_at ? formatDate(a.published_at) : '-'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        a.status === 'published' ? 'bg-emerald-900/20 text-emerald-300 border border-emerald-800/50' :
                        a.status === 'archived' ? 'bg-gray-800 text-gray-400 border border-gray-700/50' :
                        'bg-yellow-900/20 text-yellow-300 border border-yellow-800/50'
                      }`}>{a.status}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openModal(a)} className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-800 rounded-lg transition"><Pencil className="w-4 h-4" /></button>
                        {confirmDelete === a.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => deleteMutation.mutate(a.id)} className="text-xs bg-red-600 text-white px-2 py-1 rounded-lg">Yes</button>
                            <button onClick={() => setConfirmDelete(null)} className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded-lg">No</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(a.id)} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded-lg transition"><Trash2 className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800/50">
              <p className="text-sm text-gray-400">Page {data?.current_page} of {totalPages}</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm border border-gray-700 rounded-lg text-gray-400 hover:bg-gray-800 disabled:opacity-40 transition">Prev</button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 text-sm border border-gray-700 rounded-lg text-gray-400 hover:bg-gray-800 disabled:opacity-40 transition">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700/50 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800/50">
              <h2 className="text-lg font-semibold text-gray-100">{editing ? 'Edit Announcement' : 'Add Announcement'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Title *</label>
                <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Content *</label>
                <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={4} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Type *</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50">
                    {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Municipality *</label>
                  <select value={form.municipality_id} onChange={(e) => setForm({ ...form, municipality_id: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50">
                    <option value="">Select</option>
                    {(munData?.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50">
                  <option value="draft">Draft</option>
                  <option value="published">Publish Now</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800/50">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition">Cancel</button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!form.title || !form.content || !form.municipality_id || saveMutation.isPending}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition"
              >
                {saveMutation.isPending ? 'Saving...' : editing ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
