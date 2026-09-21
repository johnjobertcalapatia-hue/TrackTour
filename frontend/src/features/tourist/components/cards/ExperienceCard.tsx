import { Link } from 'react-router-dom'
import { Star, MapPin, Compass } from 'lucide-react'

interface Props {
  id: number
  name: string
  image: string | null
  rating: number | null
  location: string
  type?: string
  price?: number | null
}

export default function ExperienceCard({ id, name, image, rating, location, type, price }: Props) {
  return (
    <Link
      to={`/tourist/explore/${id}`}
      className="group bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col"
    >
      <div className="relative h-40 bg-[#F3F8F4] overflow-hidden">
        {image ? (
          <img src={image} alt={name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Compass className="w-8 h-8 text-[#9CA3AF]" />
          </div>
        )}
        {type && (
          <div className="absolute top-2.5 left-2.5 bg-white/90 backdrop-blur-sm text-[#087F3F] text-[10px] font-semibold px-2 py-0.5 rounded-full">
            {type}
          </div>
        )}
      </div>
      <div className="p-3.5 flex-1 flex flex-col">
        <h3 className="font-semibold text-[#17201B] text-sm leading-snug truncate group-hover:text-[#087F3F] transition">{name}</h3>
        <div className="flex items-center justify-between mt-1.5">
          <div className="flex items-center gap-1">
            <MapPin className="w-3 h-3 text-[#68736D] shrink-0" />
            <span className="text-[11px] text-[#68736D] truncate">{location}</span>
          </div>
          {rating != null && rating > 0 && (
            <div className="flex items-center gap-0.5">
              <Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" />
              <span className="text-[11px] font-semibold text-[#17201B]">{rating.toFixed(1)}</span>
            </div>
          )}
        </div>
        {price != null && price > 0 && (
          <p className="text-sm font-bold text-[#087F3F] mt-2">₱{price.toLocaleString()}</p>
        )}
      </div>
    </Link>
  )
}
