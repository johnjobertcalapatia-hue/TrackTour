import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { MapPin, Plus, Pencil, Trash2, X, Image as ImageIcon, Check } from 'lucide-react'

interface Destination {
  id: number
  name: string
  slug: string
  description: string
  address: string
  latitude: number
  longitude: number
  opening_hours: string | null
  entrance_fee: number | null
  contact_number: string | null
  images: string[] | null
  amenities: string[] | null
  status: string
  category: { id: number; name: string }
  municipality: { id: number; name: string }
  created_at: string
}

interface Category {
  id: number
  name: string
  slug: string
  icon: string | null
}

interface Municipality {
  id: number
  name: string
}

interface PaginatedData {
  data: Destination[]
  current_page: number
  last_page: number
  per_page: number
  total: number
}

const defaultForm = {
  name: '',
  description: '',
  address: '',
  latitude: '',
  longitude: '',
  category_id: '',
  municipality_id: '',
  opening_hours: '',
  entrance_fee: '',
  contact_number: '',
  status: 'draft' as string,
  images: [] as string[],
  amenities: [] as string[],
}

export default function TourismOfficeDestinations() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Destination | null>(null)
  const [form, setForm] = useState(defaultForm)
  const [amenityInput, setAmenityInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['to-destinations', page, search, statusFilter],
    queryFn: () => get<PaginatedData>(`/tourism-office/destinations?page=${page}&search=${search}&status=${statusFilter}`),
  })

  const { data: catData } = useQuery({
    queryKey: ['to-categories'],
    queryFn: () => get<{ data: Category[] }>('/tourism-office/categories'),
  })

  const { data: munData } = useQuery({
    queryKey: ['to-municipalities'],
    queryFn: () => get<{ data: Municipality[] }>('/tourism-office/municipalities'),
  })

  const openModal = (dest?: Destination) => {
    if (dest) {
      setEditing(dest)
      setForm({
        name: dest.name,
        description: dest.description,
        address: dest.address,
        latitude: String(dest.latitude),
        longitude: String(dest.longitude),
        category_id: String(dest.category?.id ?? ''),
        municipality_id: String(dest.municipality?.id ?? ''),
        opening_hours: dest.opening_hours ?? '',
        entrance_fee: dest.entrance_fee != null ? String(dest.entrance_fee) : '',
        contact_number: dest.contact_number ?? '',
        status: dest.status,
        images: dest.images ? [...dest.images] : [],
        amenities: dest.amenities ? [...dest.amenities] : [],
      })
    } else {
      setEditing(null)
      setForm({ ...defaultForm, images: [], amenities: [] })
    }
    setAmenityInput('')
    setShowModal(true)
  }

  const addImageUrl = () => {
    if (form.images.length >= 8) return
    setForm({ ...form, images: [...form.images, ''] })
  }

  const updateImageUrl = (index: number, value: string) => {
    setForm({ ...form, images: form.images.map((img, i) => (i === index ? value : img)) })
  }

  const removeImageUrl = (index: number) => {
    setForm({ ...form, images: form.images.filter((_, i) => i !== index) })
  }

  const addAmenity = () => {
    const value = amenityInput.trim()
    if (!value || form.amenities.includes(value)) return
    setForm({ ...form, amenities: [...form.amenities, value] })
    setAmenityInput('')
  }

  const removeAmenity = (index: number) => {
    setForm({ ...form, amenities: form.amenities.filter((_, i) => i !== index) })
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        name: form.name,
        description: form.description,
        address: form.address,
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        category_id: parseInt(form.category_id),
        municipality_id: parseInt(form.municipality_id),
        opening_hours: form.opening_hours || null,
        entrance_fee: form.entrance_fee ? parseFloat(form.entrance_fee) : null,
        contact_number: form.contact_number || null,
        images: form.images.map((u) => u.trim()).filter(Boolean),
        amenities: form.amenities,
        status: form.status,
      }
      return editing
        ? put(`/tourism-office/destinations/${editing.id}`, payload)
        : post('/tourism-office/destinations', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['to-destinations'] })
      setShowModal(false)
      setEditing(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => del(`/tourism-office/destinations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['to-destinations'] })
      setConfirmDelete(null)
    },
  })

  const destinations = data?.data ?? []
  const totalPages = data?.last_page ?? 1

  return (
    <div className="w-full max-w-7xl mx-auto">
      {!showModal && (
        <>
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Tourist Spots</h1>
          <p className="mt-1 text-sm text-[#68736D]">Create and manage tourist spots in the municipality</p>
        </div>
        <button onClick={() => openModal()} className="inline-flex items-center gap-2 bg-[#087F3F] hover:bg-[#056B35] text-white px-4 py-2.5 rounded-xl text-sm font-medium transition shadow-tourism">
          <Plus className="w-4 h-4" /> Add Tourist Spot
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Search tourist spots..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="flex-1 bg-white border border-[#E5E9E7] rounded-xl px-4 py-2.5 text-sm text-[#17201B] placeholder-[#9CA3AF] focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          className="bg-white border border-[#087F3F]/50 rounded-xl px-4 py-2.5 text-sm text-[#087F3F] accent-[#087F3F] [&>option]:bg-white [&>option]:text-[#087F3F] focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {isLoading ? <DashboardSkeleton /> : destinations.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E5E9E7] p-12 text-center shadow-tourism">
          <MapPin className="w-12 h-12 text-[#087F3F]/30 mx-auto mb-4" />
          <p className="text-[#68736D]">No tourist spots found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E5E9E7] shadow-tourism overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E9E7] bg-[#F6F8F4]">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#68736D]">Spot</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#68736D]">Category</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#68736D]">Municipality</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#68736D]">Fee</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#68736D]">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#68736D]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E9E7]">
                {destinations.map((d) => (
                  <tr key={d.id} className="hover:bg-[#F3F8F4] transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {d.images?.[0] ? (
                          <img src={d.images[0]} alt={d.name} className="w-10 h-10 rounded-lg object-cover bg-[#F3F8F4]" />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-[#F3F8F4] flex items-center justify-center">
                            <ImageIcon className="w-5 h-5 text-[#9CA3AF]" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-[#17201B]">{d.name}</p>
                          <p className="text-xs text-[#68736D] truncate max-w-[200px]">{d.address}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[#17201B]">{d.category?.name ?? '-'}</td>
                    <td className="px-5 py-3 text-[#17201B]">{d.municipality?.name ?? '-'}</td>
                    <td className="px-5 py-3 text-[#17201B]">{d.entrance_fee != null ? `₱${d.entrance_fee}` : 'Free'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        d.status === 'active' ? 'bg-[#E9F7EF] text-[#087F3F] border border-[#DDF4E6]' :
                        d.status === 'draft' ? 'bg-[#FFF7D6] text-[#A16207] border border-[#FDE68A]' :
                        'bg-[#F3F4F6] text-[#68736D] border border-[#E5E7EB]'
                      }`}>{d.status}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openModal(d)} className="p-1.5 text-[#68736D] hover:text-[#087F3F] hover:bg-[#F3F8F4] rounded-lg transition"><Pencil className="w-4 h-4" /></button>
                        {confirmDelete === d.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => deleteMutation.mutate(d.id)} className="text-xs bg-red-600 text-white px-2 py-1 rounded-lg">Yes</button>
                            <button onClick={() => setConfirmDelete(null)} className="text-xs bg-[#F3F4F6] text-[#68736D] px-2 py-1 rounded-lg">No</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(d.id)} className="p-1.5 text-[#68736D] hover:text-red-600 hover:bg-red-50 rounded-lg transition"><Trash2 className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-[#E5E9E7]">
              <p className="text-sm text-[#68736D]">Page {data?.current_page} of {totalPages}</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm border border-[#D7E8DB] rounded-lg text-[#087F3F] hover:bg-[#F3F8F4] disabled:opacity-40 transition">Prev</button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 text-sm border border-[#D7E8DB] rounded-lg text-[#087F3F] hover:bg-[#F3F8F4] disabled:opacity-40 transition">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
        </>
      )}

      {showModal && (
        <div className="w-full">
          <div className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden shadow-tourism">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E9E7]">
              <h2 className="text-lg font-semibold text-[#087F3F]">{editing ? 'Edit Tourist Spot' : 'Create Tourist Spot'}</h2>
              <button onClick={() => setShowModal(false)} className="text-[#087F3F] hover:text-[#056B35]"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-6">
              {/* Basic info */}
              <section className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#087F3F]">Basic Information</h3>
                {[
                  { label: 'Name', key: 'name', type: 'text', required: true },
                  { label: 'Description', key: 'description', type: 'textarea', required: true },
                  { label: 'Address', key: 'address', type: 'text', required: true },
                ].map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-[#087F3F] mb-1.5">{field.label}{field.required && ' *'}</label>
                    {field.type === 'textarea' ? (
                      <textarea
                        value={form[field.key as keyof typeof form] as string}
                        onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                        rows={3}
                        className="w-full bg-white border border-[#087F3F]/50 rounded-xl px-3 py-2 text-sm text-[#087F3F] placeholder-[#087F3F] shadow-sm focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15"
                      />
                    ) : (
                      <input
                        type={field.type}
                        value={form[field.key as keyof typeof form] as string}
                        onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                        className="w-full bg-white border border-[#087F3F]/50 rounded-xl px-3 py-2 text-sm text-[#087F3F] placeholder-[#087F3F] shadow-sm focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15"
                      />
                    )}
                  </div>
                ))}
              </section>

              {/* Location */}
              <section className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#087F3F]">Location</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#087F3F] mb-1.5">Category *</label>
                    <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full bg-white border border-[#087F3F]/50 rounded-xl px-3 py-2 text-sm text-[#087F3F] accent-[#087F3F] [&>option]:bg-white [&>option]:text-[#087F3F] shadow-sm focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15">
                      <option value="">Select</option>
                      {(catData?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#087F3F] mb-1.5">Municipality *</label>
                    <select value={form.municipality_id} onChange={(e) => setForm({ ...form, municipality_id: e.target.value })} className="w-full bg-white border border-[#087F3F]/50 rounded-xl px-3 py-2 text-sm text-[#087F3F] accent-[#087F3F] [&>option]:bg-white [&>option]:text-[#087F3F] shadow-sm focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15">
                      <option value="">Select</option>
                      {(munData?.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#087F3F] mb-1.5">Latitude *</label>
                    <input type="number" step="any" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} className="w-full bg-white border border-[#087F3F]/50 rounded-xl px-3 py-2 text-sm text-[#087F3F] shadow-sm focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#087F3F] mb-1.5">Longitude *</label>
                    <input type="number" step="any" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} className="w-full bg-white border border-[#087F3F]/50 rounded-xl px-3 py-2 text-sm text-[#087F3F] shadow-sm focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15" />
                  </div>
                </div>
              </section>

              {/* Details */}
              <section className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#087F3F]">Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#087F3F] mb-1.5">Opening Hours</label>
                    <input type="text" placeholder="e.g. 8:00 AM - 6:00 PM" value={form.opening_hours} onChange={(e) => setForm({ ...form, opening_hours: e.target.value })} className="w-full bg-white border border-[#087F3F]/50 rounded-xl px-3 py-2 text-sm text-[#087F3F] placeholder-[#087F3F] shadow-sm focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#087F3F] mb-1.5">Entrance Fee</label>
                    <input type="number" step="any" min="0" placeholder="0 = free" value={form.entrance_fee} onChange={(e) => setForm({ ...form, entrance_fee: e.target.value })} className="w-full bg-white border border-[#087F3F]/50 rounded-xl px-3 py-2 text-sm text-[#087F3F] placeholder-[#087F3F] shadow-sm focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#087F3F] mb-1.5">Contact Number</label>
                    <input type="text" value={form.contact_number} onChange={(e) => setForm({ ...form, contact_number: e.target.value })} className="w-full bg-white border border-[#087F3F]/50 rounded-xl px-3 py-2 text-sm text-[#087F3F] shadow-sm focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#087F3F] mb-1.5">Status</label>
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full bg-white border border-[#087F3F]/50 rounded-xl px-3 py-2 text-sm text-[#087F3F] accent-[#087F3F] [&>option]:bg-white [&>option]:text-[#087F3F] shadow-sm focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15">
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>
              </section>

              {/* Photos */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#087F3F]">Photos</h3>
                  <span className="text-xs text-[#087F3F]">First photo = cover</span>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {form.images.map((url, i) => (
                    <div key={i} className={`relative rounded-xl overflow-hidden border ${i === 0 ? 'border-[#087F3F]/60' : 'border-[#E5E9E7]'}`}>
                      {url.trim() ? (
                        <img src={url} alt={`Photo ${i + 1}`} className="w-full h-20 object-cover bg-[#F3F8F4]" />
                      ) : (
                        <div className="w-full h-20 bg-[#F3F8F4] flex items-center justify-center">
                          <ImageIcon className="w-5 h-5 text-[#9CA3AF]" />
                        </div>
                      )}
                      {i === 0 && (
                        <span className="absolute top-1 left-1 text-[9px] font-semibold bg-[#087F3F] text-white px-1.5 py-0.5 rounded">COVER</span>
                      )}
                      <button onClick={() => removeImageUrl(i)} className="absolute top-1 right-1 p-1 bg-[#17201B]/60 text-white rounded-full hover:bg-red-600 transition"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  {form.images.length < 8 && (
                    <button onClick={addImageUrl} className="h-20 rounded-xl border border-dashed border-[#087F3F]/50 hover:border-[#087F3F] text-[#087F3F] hover:text-[#056B35] flex flex-col items-center justify-center gap-1 transition">
                      <Plus className="w-4 h-4" />
                      <span className="text-[10px]">Add</span>
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {form.images.map((url, i) => (
                    <input
                      key={i}
                      type="url"
                      placeholder={`Photo ${i + 1} URL${i === 0 ? ' (cover)' : ''}`}
                      value={url}
                      onChange={(e) => updateImageUrl(i, e.target.value)}
                      className="w-full bg-white border border-[#087F3F]/50 rounded-xl px-3 py-2 text-sm text-[#087F3F] placeholder-[#087F3F] shadow-sm focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15"
                    />
                  ))}
                </div>
              </section>

              {/* Amenities */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#087F3F]">Amenities</h3>
                <div className="flex flex-wrap gap-2">
                  {form.amenities.map((amenity, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 bg-[#E9F7EF] text-[#087F3F] border border-[#DDF4E6] rounded-full px-3 py-1 text-xs">
                      {amenity}
                      <button onClick={() => removeAmenity(i)} className="text-[#087F3F]/60 hover:text-red-600 transition"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                  {form.amenities.length === 0 && <span className="text-xs text-[#087F3F] py-1">No amenities added yet.</span>}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. Parking, Restrooms, Lifeguard"
                    value={amenityInput}
                    onChange={(e) => setAmenityInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAmenity() } }}
                    className="flex-1 bg-white border border-[#087F3F]/50 rounded-xl px-3 py-2 text-sm text-[#087F3F] placeholder-[#087F3F] shadow-sm focus:outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/15"
                  />
                  <button onClick={addAmenity} disabled={!amenityInput.trim()} className="inline-flex items-center gap-1.5 bg-[#FFF7D6] border border-[#FDE68A] text-[#A16207] hover:border-[#F4B400] hover:text-[#087F3F] disabled:opacity-40 px-3 py-2 rounded-xl text-sm transition">
                    <Check className="w-4 h-4" /> Add
                  </button>
                </div>
              </section>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E5E9E7]">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-[#68736D] hover:text-[#17201B] transition">Cancel</button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!form.name || !form.description || !form.address || !form.latitude || !form.longitude || !form.category_id || saveMutation.isPending}
                className="px-5 py-2 bg-[#087F3F] hover:bg-[#056B35] disabled:opacity-50 text-white rounded-xl text-sm font-medium transition"
              >
                {saveMutation.isPending ? 'Saving...' : editing ? 'Update Spot' : 'Create Spot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}