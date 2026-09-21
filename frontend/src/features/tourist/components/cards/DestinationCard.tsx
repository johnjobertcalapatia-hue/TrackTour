import { Link } from 'react-router-dom'
import { Star, MapPin, Heart } from 'lucide-react'
import { useState } from 'react'

interface Props {
  id: number
  name: string
  image: string | null
  rating: number | null
  location: string
  description?: string | null
  badge?: string
}

export default function DestinationCard({ id, name, image, rating, location, description, badge }: Props) {
  const [liked, setLiked] = useState(false)

  return (
    <Link
      to={`/tourist/destinations/${id}`}
      className="group bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col"
    >
      {/* Image */}
      <div className="relative h-44 bg-[#F3F8F4] overflow-hidden">
        {image ? (
          <img src={image} alt={name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#68736D] text-sm">No Image</div>
        )}

        {/* Rating badge */}
        {rating != null && rating > 0 && (
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-full px-2 py-0.5 shadow-sm">
            <Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" />
            <span className="text-xs font-semibold text-[#17201B]">{rating.toFixed(1)}</span>
          </div>
        )}

        {/* Category badge */}
        {badge && (
          <div className="absolute top-2.5 right-2.5 bg-[#087F3F] text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
            {badge}
          </div>
        )}

        {/* Favorite */}
        <button
          onClick={(e) => { e.preventDefault(); setLiked(!liked) }}
          className="absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-sm hover:bg-white transition"
        >
          <Heart className={`w-4 h-4 ${liked ? 'text-red-500 fill-red-500' : 'text-[#68736D]'}`} />
        </button>
      </div>

      {/* Content */}
      <div className="p-3.5 flex-1 flex flex-col">
        <h3 className="font-semibold text-[#17201B] text-sm leading-snug truncate group-hover:text-[#087F3F] transition">{name}</h3>
        <div className="flex items-center gap-1 mt-1">
          <MapPin className="w-3 h-3 text-[#68736D] shrink-0" />
          <p className="text-[11px] text-[#68736D] truncate">{location}</p>
        </div>
        {description && (
          <p className="text-[11px] text-[#9CA3AF] mt-1.5 line-clamp-2 leading-relaxed">{description}</p>
        )}
      </div>
    </Link>
  )
}
