import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { del, get, post } from '@/shared/services/api'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { ArrowLeft, ImagePlus, MapPin, Trash2, Upload } from 'lucide-react'

interface Business {
  id: number
  business_name: string
  business_description: string | null
  address: string | null
  municipality: string | { name: string } | null
  details?: Record<string, string>
}
interface GalleryItem { id: number; file_path: string; title: string | null; caption: string | null; category: string | null }

const inputClass = 'w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]'

export default function TouristAttractionGallery() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const { data: business, isLoading: businessLoading } = useQuery({
    queryKey: ['bo-business', id],
    queryFn: () => get<Business>(`/business-owner/businesses/${id}`),
    enabled: Boolean(id),
  })
  const { data: gallery, isLoading: galleryLoading } = useQuery({
    queryKey: ['tourist-attraction-gallery', id],
    queryFn: () => get<GalleryItem[]>(`/business-owner/businesses/${id}/gallery`),
    enabled: Boolean(id),
  })

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!id || !files.length || !title.trim()) throw new Error('Add a title and at least one photo.')
      const payload = new FormData()
      files.forEach((file) => payload.append('images[]', file))
      payload.append('title', title.trim())
      payload.append('caption', caption.trim())
      payload.append('category', 'beach')
      return post(`/business-owner/businesses/${id}/gallery`, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tourist-attraction-gallery', id] })
      setFiles([])
      setTitle('')
      setCaption('')
      setSuccess('Attraction gallery photos uploaded.')
      setError('')
    },
    onError: (requestError: any) => setError(requestError?.response?.data?.message || requestError?.message || 'Unable to upload gallery photos.'),
  })

  const deleteMutation = useMutation({
    mutationFn: (mediaId: number) => del(`/business-owner/businesses/${id}/gallery/${mediaId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tourist-attraction-gallery', id] }),
  })

  if (businessLoading || galleryLoading) return <DashboardSkeleton />
  if (!business) return <div className="py-20 text-center text-[#647067]">Tourist attraction not found.</div>
  const municipality = typeof business.municipality === 'string' ? business.municipality : business.municipality?.name

  return (
    <div className="max-w-5xl mx-auto">
      <Link to="/business-owner/businesses" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6"><ArrowLeft className="w-4 h-4" /> Back to My Businesses</Link>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">{business.business_name} Gallery</h1>
        <p className="mt-1 text-sm text-[#647067]">Share beach, destination, activity, and visitor information photos. Tourist attractions use gallery photos only, not logos or cover photos.</p>
      </div>
      <div className="space-y-4 mb-6">
        {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}
        {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="bg-white rounded-2xl border border-[#E2E8E3] p-6 space-y-4 h-fit">
          <h2 className="font-semibold text-[#17201A]">Add Attraction Photos</h2>
          <button type="button" onClick={() => inputRef.current?.click()} className="w-full h-32 border-2 border-dashed border-[#D7E8DB] rounded-xl bg-[#F6F8F4] flex flex-col items-center justify-center gap-2 text-sm text-[#647067] hover:bg-[#EAF6ED]"><Upload className="w-7 h-7 text-[#16803C]" />Select photos</button>
          <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))} />
          {files.length > 0 && <p className="text-xs text-[#647067]">{files.length} photo(s) selected</p>}
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Photo title" />
          <textarea className={`${inputClass} resize-none`} rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Visitor information or caption (optional)" />
          <button type="button" onClick={() => uploadMutation.mutate()} disabled={uploadMutation.isPending || !files.length || !title.trim()} className="w-full inline-flex justify-center items-center gap-2 px-4 py-3 rounded-xl bg-[#16803C] text-white text-sm font-semibold hover:bg-[#126B32] disabled:opacity-50"><ImagePlus className="w-4 h-4" />{uploadMutation.isPending ? 'Uploading...' : 'Add to Gallery'}</button>
        </section>
        <section className="lg:col-span-2 bg-white rounded-2xl border border-[#E2E8E3] p-6 lg:p-8">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div><h2 className="font-semibold text-[#17201A]">Attraction Gallery</h2><p className="text-sm text-[#647067] mt-1">{business.business_description}</p></div>
            <span className="text-xs text-[#647067] inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{municipality ?? business.address}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              ['Type', business.details?.attraction_type],
              ['Entrance Fee', business.details?.entrance_fee ? `₱${business.details.entrance_fee}` : 'Free'],
              ['Best Time', business.details?.best_time_to_visit],
              ['Activities', business.details?.activities],
            ].map(([label, value]) => <div key={label} className="rounded-xl bg-[#F6F8F4] border border-[#E2E8E3] p-3"><p className="text-[11px] uppercase tracking-wide text-[#647067]">{label}</p><p className="text-sm font-semibold text-[#17201A] mt-1 line-clamp-2">{value || 'Not provided'}</p></div>)}
          </div>
          {gallery?.length ? <div className="grid grid-cols-2 md:grid-cols-3 gap-4">{gallery.map((item) => <div key={item.id} className="group relative rounded-xl overflow-hidden border border-[#D7E8DB] bg-[#F6F8F4]"><img src={item.file_path} alt={item.title ?? business.business_name} className="aspect-square w-full object-cover" /><div className="p-3"><p className="text-sm font-semibold text-[#17201A] truncate">{item.title}</p>{item.caption && <p className="text-xs text-[#647067] mt-1 line-clamp-2">{item.caption}</p>}</div><button type="button" onClick={() => deleteMutation.mutate(item.id)} className="absolute top-2 right-2 p-2 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition" title="Delete photo"><Trash2 className="w-4 h-4" /></button></div>)}</div> : <div className="py-16 text-center text-sm text-[#647067]"><ImagePlus className="w-10 h-10 mx-auto mb-3 text-[#9CA3AF]" />No attraction photos yet.</div>}
        </section>
      </div>
    </div>
  )
}
