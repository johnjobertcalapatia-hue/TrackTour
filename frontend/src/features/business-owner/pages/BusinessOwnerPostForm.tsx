import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Image as ImageIcon, Video, X } from 'lucide-react'
import { get, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { toAssetUrl } from '@/shared/utils'
import { useBusinessPortal } from '../services/business-portal'
import { POST_LIMITS, type DishSaleSummary, type OwnerPost } from '../services/promotions'

const input = 'w-full rounded-xl border border-[#D9E2DC] bg-[#fff] px-3.5 py-2.5 text-sm text-[#17201B] focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25'

interface NewFile { file: File; url: string }

/**
 * Create or edit a post: caption, up to 10 photos OR one video (MP4, MOV,
 * WebM; 100 MB), and optionally one of the business's running or upcoming
 * sales. The checks here are for quick feedback; the server enforces them.
 */
export default function BusinessOwnerPostForm() {
  const { id } = useParams()
  const editing = id != null
  const portal = useBusinessPortal()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const photoInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)

  const [businessId, setBusinessId] = useState<number | null>(portal.businessId ?? portal.businesses[0]?.id ?? null)
  const [caption, setCaption] = useState('')
  const [saleId, setSaleId] = useState<string>('')
  const [keep, setKeep] = useState<OwnerPost['media']>([])
  const [photos, setPhotos] = useState<NewFile[]>([])
  const [video, setVideo] = useState<NewFile | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<number | null>(null)

  const postQuery = useQuery({
    queryKey: ['bo-post', portal.prefix, id],
    queryFn: () => get<OwnerPost>(`${portal.prefix}/posts/${id}`),
    enabled: editing,
  })
  useEffect(() => {
    const p = postQuery.data
    if (!p) return
    setBusinessId(p.business_id)
    setCaption(p.caption ?? '')
    setSaleId(p.sale ? String(p.sale.id) : '')
    setKeep(p.media)
  }, [postQuery.data])

  const salesQuery = useQuery({
    queryKey: ['bo-dish-sales', portal.prefix, businessId],
    queryFn: () => get<DishSaleSummary[]>(`${portal.prefix}/dish-sales?business_id=${businessId}`),
    enabled: businessId != null,
  })
  const sales = useMemo(() => (salesQuery.data ?? []).filter((s) => s.status === 'active' || s.status === 'scheduled' || String(s.id) === saleId), [salesQuery.data, saleId])

  // Free the preview URLs when files go away.
  useEffect(() => () => { photos.forEach((p) => URL.revokeObjectURL(p.url)); if (video) URL.revokeObjectURL(video.url) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const keptPhotos = keep.filter((m) => m.type === 'image')
  const keptVideo = keep.find((m) => m.type === 'video')
  const photoCount = keptPhotos.length + photos.length
  const hasVideo = !!keptVideo || !!video

  const addPhotos = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    setError('')
    if (hasVideo) return setError('A post has either photos or one video, not both. Remove the video first.')
    const bad = files.find((f) => !POST_LIMITS.photoTypes.includes(f.type as never))
    if (bad) return setError(`${bad.name}: photos must be JPG, PNG or WebP.`)
    const big = files.find((f) => f.size > POST_LIMITS.photoMb * 1024 * 1024)
    if (big) return setError(`${big.name} is larger than ${POST_LIMITS.photoMb} MB.`)
    if (photoCount + files.length > POST_LIMITS.maxPhotos) return setError(`A post can have at most ${POST_LIMITS.maxPhotos} photos.`)
    setPhotos((cur) => [...cur, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))])
  }

  const pickVideo = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    setError('')
    if (!file) return
    if (photoCount > 0) return setError('A post has either photos or one video, not both. Remove the photos first.')
    if (!POST_LIMITS.videoTypes.includes(file.type as never)) return setError('The video must be MP4, MOV or WebM.')
    if (file.size > POST_LIMITS.videoMb * 1024 * 1024) return setError(`The video must be ${POST_LIMITS.videoMb} MB or smaller.`)
    if (video) URL.revokeObjectURL(video.url)
    setVideo({ file, url: URL.createObjectURL(file) })
  }

  const save = useMutation({
    mutationFn: (status: 'published' | 'hidden' | 'draft') => {
      const fd = new FormData()
      if (!editing && businessId) fd.append('business_id', String(businessId))
      fd.append('caption', caption.trim())
      fd.append('status', status)
      fd.append('promotion_id', saleId)
      if (editing) {
        keep.forEach((m) => fd.append('keep_media_ids[]', String(m.id)))
        if (keep.length === 0) fd.append('keep_media_ids', '')
      }
      photos.forEach((p) => fd.append('photos[]', p.file))
      if (video) fd.append('video', video.file)
      setProgress(0)
      // Large videos: no 10 s client timeout, and show upload progress.
      return post(`${portal.prefix}/posts${editing ? `/${id}` : ''}`, fd, {
        timeout: 0,
        onUploadProgress: (ev) => ev.total && setProgress(Math.round((ev.loaded / ev.total) * 100)),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-posts'] })
      queryClient.invalidateQueries({ queryKey: ['tourist-posts'] })
      navigate(`${portal.prefix}/promotions`)
    },
    onError: (err: any) => {
      setProgress(null)
      const errors = err?.response?.data?.errors as Record<string, string[]> | undefined
      setError(errors ? Object.values(errors).flat()[0] : err?.response?.status === 413 ? 'The upload is too large for the server.' : err?.response?.data?.message || 'Could not save the post. Please try again.')
    },
  })

  const submit = (status: 'published' | 'hidden' | 'draft') => (e?: FormEvent) => {
    e?.preventDefault()
    setError('')
    if (!caption.trim() && photoCount === 0 && !hasVideo) return setError('Write a caption or add a photo or video.')
    save.mutate(status)
  }

  if (editing && postQuery.isLoading) return <DashboardSkeleton />
  // A draft (or a new post) can be saved as a draft or published; a published
  // or hidden post keeps its status when edited (hide/unhide is in the ⋯ menu).
  const currentStatus = postQuery.data?.status
  const isDraft = !editing || currentStatus === 'draft'
  const business = portal.businesses.find((b) => b.id === businessId)
  const notApproved = business?.status != null && business.status !== 'approved'

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <Link to={`${portal.prefix}/promotions`} className="inline-flex items-center gap-2 text-sm text-[#647067] transition hover:text-[#17201A]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Deals &amp; Posts
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-[#17201B] lg:text-3xl">{editing ? 'Edit post' : 'New post'}</h1>
        <p className="mt-1 text-sm text-[#5E6B63]">Up to {POST_LIMITS.maxPhotos} photos, or one video (MP4, MOV or WebM, up to {POST_LIMITS.videoMb} MB).</p>
      </div>

      {notApproved && <p className="rounded-xl border border-[#F2D58A] bg-[#FFF7E0] px-3 py-2 text-sm text-[#7A5600]">This business is not approved yet. You can save posts as drafts and publish them once it is approved.</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form onSubmit={submit(isDraft ? 'published' : (currentStatus ?? 'published'))} noValidate className="space-y-5">
        <section className="space-y-4 rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5">
          {!editing && portal.businesses.length > 1 && (
            <div>
              <label htmlFor="post-business" className="mb-1.5 block text-sm font-medium text-[#17201B]">Business</label>
              <select id="post-business" className={input} value={businessId ?? ''} onChange={(e) => { setBusinessId(Number(e.target.value)); setSaleId('') }}>
                {portal.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="post-caption" className="mb-1.5 block text-sm font-medium text-[#17201B]">Caption</label>
            <textarea id="post-caption" className={input} rows={4} maxLength={POST_LIMITS.captionMax} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="What’s new? e.g. Our sisig is 25% off this weekend!" aria-describedby="post-caption-count" />
            <p id="post-caption-count" className="mt-1 text-right text-xs text-[#5E6B63]">{caption.length}/{POST_LIMITS.captionMax}</p>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-[#17201B]">Photos or video</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => photoInput.current?.click()} disabled={hasVideo || photoCount >= POST_LIMITS.maxPhotos}
                className="inline-flex items-center gap-2 rounded-xl border border-[#D7E8DB] px-3.5 py-2 text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40">
                <ImageIcon className="h-4 w-4" aria-hidden="true" /> Add photos ({photoCount}/{POST_LIMITS.maxPhotos})
              </button>
              <button type="button" onClick={() => videoInput.current?.click()} disabled={photoCount > 0 || hasVideo}
                className="inline-flex items-center gap-2 rounded-xl border border-[#D7E8DB] px-3.5 py-2 text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40">
                <Video className="h-4 w-4" aria-hidden="true" /> Add a video
              </button>
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={addPhotos} aria-label="Choose photos" />
              <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={pickVideo} aria-label="Choose a video" />
            </div>

            {(keptPhotos.length > 0 || photos.length > 0) && (
              <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Photos in this post">
                {keptPhotos.map((m, i) => (
                  <Thumb key={`k${m.id}`} src={toAssetUrl(m.path)} label={`Photo ${i + 1}`} onRemove={() => setKeep((cur) => cur.filter((x) => x.id !== m.id))} />
                ))}
                {photos.map((p, i) => (
                  <Thumb key={p.url} src={p.url} label={`New photo ${i + 1}`} onRemove={() => { URL.revokeObjectURL(p.url); setPhotos((cur) => cur.filter((x) => x !== p)) }} />
                ))}
              </ul>
            )}
            {(keptVideo || video) && (
              <div className="relative mt-3 overflow-hidden rounded-xl bg-black">
                <video src={video ? video.url : toAssetUrl(keptVideo!.path)} controls preload="metadata" className="max-h-72 w-full" aria-label="Video in this post" />
                <button type="button" aria-label="Remove video"
                  onClick={() => { if (video) { URL.revokeObjectURL(video.url); setVideo(null) } else setKeep((cur) => cur.filter((m) => m.type !== 'video')) }}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#fff]/90 text-[#17201B]">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
                {video && <p className="bg-[#17201B] px-3 py-1.5 text-xs text-white">{video.file.name} · {(video.file.size / 1024 / 1024).toFixed(1)} MB</p>}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="post-sale" className="mb-1.5 block text-sm font-medium text-[#17201B]">Link a sale <span className="font-normal text-[#5E6B63]">(optional)</span></label>
            <select id="post-sale" className={input} value={saleId} onChange={(e) => setSaleId(e.target.value)}>
              <option value="">No sale</option>
              {sales.map((s) => <option key={s.id} value={s.id}>{s.title} · {s.label}{s.status === 'scheduled' ? ' (scheduled)' : ''}</option>)}
            </select>
            <p className="mt-1 text-xs text-[#5E6B63]">Tourists see the sale’s dishes at their sale price and a “Shop the deal” button while it runs.</p>
          </div>
        </section>

        {progress !== null && save.isPending && (
          <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-2 overflow-hidden rounded-full bg-[#E5E9E7]">
            <div className="h-full bg-[#16803C] transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <Link to={`${portal.prefix}/promotions`} className="rounded-xl border border-[#D7E8DB] px-4 py-2.5 text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4]">Cancel</Link>
          {isDraft && (
            <button type="button" onClick={submit('draft')} disabled={save.isPending} className="rounded-xl border border-[#D7E8DB] px-4 py-2.5 text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-50">
              {editing ? 'Save draft' : 'Save as draft'}
            </button>
          )}
          <button type="submit" disabled={save.isPending || (isDraft && notApproved)} className="rounded-xl bg-[#16803C] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#126B32] disabled:opacity-50">
            {save.isPending ? (progress !== null && progress < 100 ? `Uploading ${progress}%…` : 'Saving…') : isDraft ? 'Publish' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Thumb({ src, label, onRemove }: { src: string; label: string; onRemove: () => void }) {
  return (
    <li className="relative aspect-square overflow-hidden rounded-lg bg-[#F3F8F4]">
      <img src={src} alt={label} className="h-full w-full object-cover" />
      <button type="button" onClick={onRemove} aria-label={`Remove ${label.toLowerCase()}`} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#fff]/90 text-[#17201B]">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </li>
  )
}
