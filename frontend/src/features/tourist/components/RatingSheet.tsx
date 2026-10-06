import { useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/shared/utils'

const RATING_TAG_LABELS: Record<string, string> = {
  friendly: 'Friendly',
  safe_driving: 'Safe driving',
  clean_vehicle: 'Clean vehicle',
  good_communication: 'Good communication',
  arrived_on_time: 'Arrived on time',
}

export interface RatingPayload {
  rating: number
  review?: string
  tags: string[]
}

interface RatingSheetProps {
  open: boolean
  riderName: string | null
  allowedTags: string[]
  onClose: () => void
  onSubmit: (payload: RatingPayload) => void
  isSubmitting?: boolean
}

export default function RatingSheet({
  open,
  riderName,
  allowedTags,
  onClose,
  onSubmit,
  isSubmitting,
}: RatingSheetProps) {
  const [rating, setRating] = useState(5)
  const [review, setReview] = useState('')
  const [tags, setTags] = useState<string[]>([])

  if (!open) return null

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  const handleSubmit = () => {
    onSubmit({ rating, review: review.trim() || undefined, tags })
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-lg font-semibold text-[#17201B] mb-2">Rate Your Trip</h3>
        <p className="text-sm text-[#68736D] mb-6">How was your ride with {riderName || 'your driver'}?</p>

        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              aria-label={`${star} star${star === 1 ? '' : 's'}`}
              className="transition-transform hover:scale-110"
            >
              <Star
                className={`w-8 h-8 ${star <= rating ? 'text-[#F4B400] fill-[#F4B400]' : 'text-[#E5E9E7]'}`}
              />
            </button>
          ))}
        </div>

        {allowedTags.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-[#68736D] mb-2">What went well? (optional)</p>
            <div className="flex flex-wrap gap-2">
              {allowedTags.map((tag) => {
                const active = tags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      'px-3 py-1.5 rounded-full border text-xs font-medium transition-all',
                      active
                        ? 'bg-[#E9F7EF] border-[#087F3F] text-[#087F3F]'
                        : 'bg-white border-[#E5E9E7] text-[#68736D] hover:border-[#087F3F]/40'
                    )}
                  >
                    {RATING_TAG_LABELS[tag] ?? tag}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <textarea
          value={review}
          onChange={(e) => setReview(e.target.value)}
          placeholder="Write a review (optional)"
          className="w-full px-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-[#17201B] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F] text-sm resize-none mb-4"
          rows={3}
        />

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-[#F3F4F6] border border-[#E5E9E7] text-[#17201B] rounded-xl hover:text-[#087F3F] transition-all font-medium"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 py-2.5 bg-[#087F3F] text-white rounded-xl hover:bg-[#056B35] transition-all font-medium disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Rating'}
          </button>
        </div>
      </div>
    </div>
  )
}