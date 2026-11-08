import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Camera, Star, UtensilsCrossed, X } from 'lucide-react'
import { apiErrorMessage, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { cn, toAssetUrl } from '@/shared/utils'
import { fetchMyOrders, findSection, myOrdersKey } from '@/features/tourist/services/my-orders'

/** Matches the backend: up to 5 photos, JPG/PNG/WebP, 5 MB each. */
const MAX_PHOTOS = 5
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const PHOTO_MAX_BYTES = 5 * 1024 * 1024
const RATING_WORDS = ['', 'Terrible', 'Poor', 'Okay', 'Good', 'Excellent']

function StarPicker({ label, value, onChange, size = 'w-9 h-9' }: { label: string; value: number; onChange: (v: number) => void; size?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => onChange(n)} className="p-0.5">
          <Star className={cn(size, 'transition', n <= value ? 'fill-[#F4B400] text-[#F4B400]' : 'text-[#C9D1CD]')} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

/**
 * Write a review for one ordered dish: star rating, feedback, photos of the
 * food received, and (once per order) the rider's stars.
 */
export default function TouristWriteReview() {
  const { orderId, itemId } = useParams<{ orderId: string; itemId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({ queryKey: myOrdersKey('all'), queryFn: () => fetchMyOrders('all') })
  const section = findSection(data?.sections, Number(orderId))
  const item = section?.items.find((i) => i.id === Number(itemId))

  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [riderRating, setRiderRating] = useState(0)
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([])
  const [error, setError] = useState('')
  const [photoError, setPhotoError] = useState('')

  // Editing: start from the earlier stars.
  useEffect(() => {
    if (item?.my_rating && rating === 0) setRating(item.my_rating)
  }, [item?.my_rating]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.preview)), []) // eslint-disable-line react-hooks/exhaustive-deps

  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/tourist/activities?view=orders&tab=to_review'))
  const askRider = Boolean(section?.rider) && !section?.rider_rated

  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.append('rating', String(rating))
      if (text.trim()) form.append('review', text.trim())
      if (askRider && riderRating > 0) form.append('delivery_rating', String(riderRating))
      photos.forEach((p) => form.append('images[]', p.file))
      return post(`/tourist/food/order/${item!.order_id}/items/${item!.id}/review`, form)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tourist-orders-v2'] })
      goBack()
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not send your review. Please try again.')),
  })

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    setPhotoError('')
    const next: { file: File; preview: string }[] = []
    for (const file of files) {
      if (!PHOTO_TYPES.includes(file.type)) { setPhotoError('Photos must be JPG, PNG or WebP.'); continue }
      if (file.size > PHOTO_MAX_BYTES) { setPhotoError(`"${file.name}" is larger than 5 MB.`); continue }
      if (photos.length + next.length >= MAX_PHOTOS) { setPhotoError(`You can add up to ${MAX_PHOTOS} photos.`); break }
      next.push({ file, preview: URL.createObjectURL(file) })
    }
    if (next.length) setPhotos((prev) => [...prev, ...next])
  }

  const removePhoto = (i: number) => setPhotos((prev) => {
    URL.revokeObjectURL(prev[i]!.preview)
    return prev.filter((_, idx) => idx !== i)
  })

  if (isLoading && !data) return <DashboardSkeleton />
  if (!section || !item) {
    return <p role="alert" className="mx-auto max-w-2xl text-sm text-[#B91C1C]">This item can&apos;t be reviewed.</p>
  }

  return (
    <main aria-label="Write a review" className="mx-auto w-full max-w-2xl space-y-4">
      <button type="button" onClick={goBack} className="inline-flex items-center gap-2 text-sm font-semibold text-[#087F3F] hover:text-[#056B35]">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
      </button>
      <h1 className="text-2xl font-bold text-[#17201B]">{item.reviewed ? 'Edit your review' : 'Write a review'}</h1>

      {/* The dish */}
      <div className="flex items-center gap-3 bg-white border border-[#E5E9E7] rounded-2xl p-3">
        <div className="w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-[#E9F7EF] flex items-center justify-center">
          {item.image ? <img src={toAssetUrl(item.image)} alt="" className="w-full h-full object-cover" /> : <UtensilsCrossed className="w-7 h-7 text-[#087F3F]/40" aria-hidden="true" />}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-[#17201B] truncate">{item.name}</p>
          {item.restaurant && <p className="text-xs text-[#56615B] truncate">{item.restaurant}</p>}
          <p className="text-xs text-[#56615B]">Order #{section.reference} · x{item.quantity}</p>
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (rating > 0) submit.mutate() }}
        className="bg-white border border-[#E5E9E7] rounded-2xl p-4 sm:p-5 space-y-5"
      >
        <div>
          <p className="text-sm font-semibold text-[#17201B]">Rate this food</p>
          <div className="mt-1 flex items-center gap-3">
            <StarPicker label="Food rating" value={rating} onChange={setRating} />
            {rating > 0 && <span className="text-sm font-semibold text-[#56615B]">{RATING_WORDS[rating]}</span>}
          </div>
        </div>

        <div>
          <label htmlFor="review-text" className="text-sm font-semibold text-[#17201B]">Your feedback</label>
          <textarea
            id="review-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            rows={5}
            placeholder="How did it taste? Was it hot, well packed, worth the price?"
            className="mt-1 w-full rounded-xl border border-[#E5E9E7] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#087F3F]/25 focus:border-[#087F3F]"
          />
          <p className="text-right text-[11px] text-[#56615B]">{text.length}/1000</p>
        </div>

        <div>
          <p className="text-sm font-semibold text-[#17201B]">Photos of your food <span className="font-normal text-[#56615B]">(optional, up to {MAX_PHOTOS})</span></p>
          <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2" aria-label="Review photos">
            {photos.map((p, i) => (
              <li key={p.preview} className="relative aspect-square rounded-xl overflow-hidden border border-[#E5E9E7]">
                <img src={p.preview} alt={`Photo ${i + 1}: ${p.file.name}`} className="w-full h-full object-cover" />
                <button type="button" onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 text-[#B91C1C] flex items-center justify-center shadow">
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
            {photos.length < MAX_PHOTOS && (
              <li>
                <button type="button" onClick={() => fileRef.current?.click()} className="w-full aspect-square rounded-xl border border-dashed border-[#C9D1CD] text-[#56615B] hover:border-[#087F3F] hover:text-[#087F3F] flex flex-col items-center justify-center gap-1 text-xs font-medium">
                  <Camera className="w-5 h-5" aria-hidden="true" /> Add photo
                </button>
              </li>
            )}
          </ul>
          <input ref={fileRef} type="file" accept={PHOTO_TYPES.join(',')} multiple onChange={onPick} className="hidden" data-testid="review-photo-input" />
          {photoError && <p role="alert" className="mt-1 text-xs text-[#B91C1C]">{photoError}</p>}
        </div>

        {askRider && (
          <div>
            <p className="text-sm font-semibold text-[#17201B]">Rate your rider, {section.rider!.name} <span className="font-normal text-[#56615B]">(optional)</span></p>
            <StarPicker label="Rider rating" value={riderRating} onChange={setRiderRating} size="w-7 h-7" />
          </div>
        )}

        {error && <p role="alert" className="text-sm text-[#B91C1C]">{error}</p>}
        <button
          type="submit"
          disabled={rating === 0 || submit.isPending}
          className="w-full h-11 rounded-full bg-[#087F3F] text-white text-sm font-semibold hover:bg-[#056B35] disabled:opacity-50"
        >
          {submit.isPending ? 'Sending…' : 'Submit review'}
        </button>
      </form>
    </main>
  )
}
