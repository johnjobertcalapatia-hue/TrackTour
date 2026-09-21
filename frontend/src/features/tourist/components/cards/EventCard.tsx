import { Link } from 'react-router-dom'
import { Calendar, MapPin } from 'lucide-react'

interface Props {
  id: number
  name: string
  image: string | null
  date: string
  location: string
  category?: string
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getMonthDay(dateStr: string) {
  const d = new Date(dateStr)
  return {
    month: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
    day: d.getDate(),
  }
}

export default function EventCard({ id, name, date, location, category }: Props) {
  const { month, day } = getMonthDay(date)

  return (
    <Link
      to={`/tourist/events/${id}`}
      className="group bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex gap-3 p-3"
    >
      {/* Date badge */}
      <div className="w-14 h-14 shrink-0 bg-[#E9F7EF] rounded-xl flex flex-col items-center justify-center">
        <span className="text-[9px] font-bold text-[#087F3F] leading-none">{month}</span>
        <span className="text-lg font-extrabold text-[#056B35] leading-none mt-0.5">{day}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-[#17201B] text-sm leading-snug truncate group-hover:text-[#087F3F] transition">{name}</h3>
        {category && (
          <span className="inline-block mt-1 text-[10px] font-medium text-[#087F3F] bg-[#E9F7EF] px-1.5 py-0.5 rounded-full">{category}</span>
        )}
        <div className="flex items-center gap-1 mt-1">
          <Calendar className="w-3 h-3 text-[#68736D] shrink-0" />
          <span className="text-[11px] text-[#68736D]">{formatDate(date)}</span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <MapPin className="w-3 h-3 text-[#68736D] shrink-0" />
          <span className="text-[11px] text-[#68736D] truncate">{location}</span>
        </div>
      </div>
    </Link>
  )
}
