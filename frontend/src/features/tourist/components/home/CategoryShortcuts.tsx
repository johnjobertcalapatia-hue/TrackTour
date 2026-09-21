import { Link } from 'react-router-dom'

interface Category {
  label: string
  emoji: string
  to: string
  color: string
}

const CATEGORIES: Category[] = [
  { label: 'Beaches', emoji: '🏖️', to: '/tourist/destinations?category=beaches', color: 'bg-[#E0F2FE]' },
  { label: 'Islands', emoji: '🌴', to: '/tourist/destinations?category=islands', color: 'bg-[#E9F7EF]' },
  { label: 'Waterfalls', emoji: '💧', to: '/tourist/destinations?category=waterfalls', color: 'bg-[#DBEAFE]' },
  { label: 'Mountains', emoji: '⛰️', to: '/tourist/destinations?category=mountains', color: 'bg-[#F3F4F6]' },
  { label: 'Heritage', emoji: '🏛️', to: '/tourist/destinations?category=heritage', color: 'bg-[#FEF3C7]' },
  { label: 'Food Trip', emoji: '🍛', to: '/tourist/food', color: 'bg-[#FEE2E2]' },
  { label: 'Hotels', emoji: '🏨', to: '/tourist/stays', color: 'bg-[#F3E8FF]' },
  { label: 'View All', emoji: '📋', to: '/tourist/destinations', color: 'bg-[#F3F8F4]' },
]

export default function CategoryShortcuts() {
  return (
    <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-hide">
      {CATEGORIES.map((cat) => (
        <Link
          key={cat.label}
          to={cat.to}
          className="flex flex-col items-center gap-1.5 min-w-[72px] group"
        >
          <div className={`w-14 h-14 ${cat.color} rounded-2xl flex items-center justify-center text-2xl group-hover:scale-110 transition-transform duration-200 shadow-sm`}>
            {cat.emoji}
          </div>
          <span className="text-[11px] font-medium text-[#4B5563] group-hover:text-[#087F3F] transition text-center leading-tight">
            {cat.label}
          </span>
        </Link>
      ))}
    </div>
  )
}
