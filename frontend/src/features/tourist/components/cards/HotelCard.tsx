import { Link } from 'react-router-dom'
import { Star, MapPin, Building2 } from 'lucide-react'

interface Props {
  id: number
  name: string
  image: string | null
  rating: number | null
  location: string
  startingPrice: number
  category?: string
  amenities?: string[]
}

export default function HotelCard({ id, name, image, rating, location, startingPrice, category }: Props) {
  return (
    <Link
      to={`/tourist/stays/${id}`}
      className="group bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col"
    >
      <div className="relative h-40 bg-[#F3F8F4] overflow-hidden">
        {image ? (
          <img src={image} alt={name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Building2 className="w-8 h-8 text-[#9CA3AF]" />
          </div>
        )}
        {category && (
          <div className="absolute top-2.5 left-2.5 bg-[#087F3F] text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
            {category}
          </div>
        )}
      </div>
      <div className="p-3.5 flex-1 flex flex-col">
        <h3 className="font-semibold text-[#17201B] text-sm leading-snug truncate group-hover:text-[#087F3F] transition">{name}</h3>
        <div className="flex items-center gap-1 mt-1">
          <MapPin className="w-3 h-3 text-[#68736D] shrink-0" />
          <span className="text-[11px] text-[#68736D] truncate">{location}</span>
        </div>
        <div className="flex items-center justify-between mt-auto pt-2">
          <div>
            <span className="text-[10px] text-[#68736D]">From</span>
            <span className="text-sm font-bold text-[#087F3F] ml-1">₱{startingPrice.toLocaleString()}</span>
            <span className="text-[10px] text-[#68736D]">/night</span>
          </div>
          {rating != null && rating > 0 && (
            <div className="flex items-center gap-0.5">
              <Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" />
              <span className="text-[11px] font-semibold text-[#17201B]">{rating.toFixed(1)}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
