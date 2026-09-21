import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDate } from '@/shared/utils'
import { Calendar, Plus, Pencil, Trash2, X } from 'lucide-react'

interface Event {
  id: number
  name: string
  description: string
  location: string
  start_date: string
  end_date: string
  image: string | null
  status: string
  municipality: { id: number; name: string }
  created_at: string
}

interface Municipality {
  id: number
  name: string
}

interface PaginatedData {
  data: Event[]
  current_page: number
  last_page: number
  per_page: number
  total: number
}

const defaultForm = {
  name: '',
  description: '',
  location: '',
  start_date: '',
  end_date: '',
  municipality_id: '',
  image: '',
  status: 'upcoming' as string,
}

export default function TourismOfficeEvents() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Event | null>(null)
  const [form, setForm] = useState(defaultForm)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['to-events', page, search, statusFilter],
    queryFn: () => get<PaginatedData>(`/tourism-office/events?page=${page}&search=${search}&status=${statusFilter}`),
  })

  const { data: munData } = useQuery({
    queryKey: ['to-municipalities'],
    queryFn: () => get<{ data: Municipality[] }>('/tourism-office/municipalities'),
  })

  const openModal = (evt?: Event) => {
    if (evt) {
      setEditing(evt)
      setForm({
        name: evt.name,
        description: evt.description,
        location: evt.location,
        start_date: evt.start_date ? evt.start_date.slice(0, 16) : '',
        end_date: evt.end_date ? evt.end_date.slice(0, 16) : '',
        municipality_id: String(evt.municipality?.id ?? ''),
        image: evt.image ?? '',
        status: evt.status,
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
        name: form.name,
        description: form.description,
        location: form.location,
        start_date: form.start_date,
        end_date: form.end_date,
        municipality_id: parseInt(form.municipality_id),
        image: form.image || null,
        status: form.status,
      }
      return editing
        ? put(`/tourism-office/events/${editing.id}`, payload)
        : post('/tourism-office/events', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['to-events'] })
      setShowModal(false)
      setEditing(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => del(`/tourism-office/events/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['to-events'] })
      setConfirmDelete(null)
    },
  })

  const events = data?.data ?? []
  const totalPages = data?.last_page ?? 1

  return (
    <div>
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">Events</h1>
          <p className="mt-1 text-sm text-gray-400">Manage tourism events and activities</p>
        </div>
        <button onClick={() => openModal()} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition">
          <Plus className="w-4 h-4" /> Add Event
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Search events..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="flex-1 bg-gray-900/60 border border-gray-700/50 rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-600/50"
        />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }} className="bg-gray-900/60 border border-gray-700/50 rounded-xl px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50">
          <option value="">All Status</option>
          <option value="upcoming">Upcoming</option>
          <option value="ongoing">Ongoing</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {isLoading ? <DashboardSkeleton /> : events.length === 0 ? (
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-12 text-center">
          <Calendar className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No events found.</p>
        </div>
      ) : (
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800/50 bg-gray-800/30">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Event</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Location</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Dates</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Municipality</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {events.map((evt) => (
                  <tr key={evt.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-100">{evt.name}</p>
                      <p className="text-xs text-gray-500 truncate max-w-[200px]">{evt.description}</p>
                    </td>
                    <td className="px-5 py-3 text-gray-300">{evt.location}</td>
                    <td className="px-5 py-3 text-gray-300 whitespace-nowrap">
                      {evt.start_date ? formatDate(evt.start_date) : '-'}
                      {evt.end_date && ` – ${formatDate(evt.end_date)}`}
                    </td>
                    <td className="px-5 py-3 text-gray-300">{evt.municipality?.name ?? '-'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        evt.status === 'upcoming' ? 'bg-blue-900/20 text-blue-300 border border-blue-800/50' :
                        evt.status === 'ongoing' ? 'bg-emerald-900/20 text-emerald-300 border border-emerald-800/50' :
                        evt.status === 'completed' ? 'bg-gray-800 text-gray-400 border border-gray-700/50' :
                        'bg-red-900/20 text-red-300 border border-red-800/50'
                      }`}>{evt.status}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openModal(evt)} className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-800 rounded-lg transition"><Pencil className="w-4 h-4" /></button>
                        {confirmDelete === evt.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => deleteMutation.mutate(evt.id)} className="text-xs bg-red-600 text-white px-2 py-1 rounded-lg">Yes</button>
                            <button onClick={() => setConfirmDelete(null)} className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded-lg">No</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(evt.id)} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded-lg transition"><Trash2 className="w-4 h-4" /></button>
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
              <h2 className="text-lg font-semibold text-gray-100">{editing ? 'Edit Event' : 'Add Event'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              {[
                { label: 'Event Name', key: 'name', type: 'text', required: true },
                { label: 'Description', key: 'description', type: 'textarea', required: true },
                { label: 'Location', key: 'location', type: 'text', required: true },
                { label: 'Image URL', key: 'image', type: 'text' },
              ].map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">{field.label}{field.required && ' *'}</label>
                  {field.type === 'textarea' ? (
                    <textarea
                      value={form[field.key as keyof typeof form]}
                      onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                      rows={3}
                      className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50"
                    />
                  ) : (
                    <input
                      type={field.type}
                      value={form[field.key as keyof typeof form]}
                      onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                      className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50"
                    />
                  )}
                </div>
              ))}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Start Date *</label>
                  <input type="datetime-local" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">End Date *</label>
                  <input type="datetime-local" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Municipality *</label>
                  <select value={form.municipality_id} onChange={(e) => setForm({ ...form, municipality_id: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50">
                    <option value="">Select</option>
                    {(munData?.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-600/50">
                    <option value="upcoming">Upcoming</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800/50">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition">Cancel</button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!form.name || !form.description || !form.location || !form.start_date || !form.end_date || !form.municipality_id || saveMutation.isPending}
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
