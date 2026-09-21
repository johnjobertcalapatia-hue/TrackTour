import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { toAssetUrl } from '@/shared/utils'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Search, TrendingUp, Clock, MapPin, X, UtensilsCrossed, Store, CalendarRange, Landmark } from 'lucide-react'

interface SearchItem {
  id: number
  name: string
  type: string
  subtitle?: string | null
  url: string
  price?: number | null
  image?: string | null
}

interface SearchResultsData {
  businesses: SearchItem[]
  foods: SearchItem[]
  municipalities: SearchItem[]
  events: SearchItem[]
}

const POPULAR = ['Restaurant', 'Cafe', 'Food Hub', 'Bakery', 'Local Food', 'Coffee']

export default function TouristSearch() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialQ = searchParams.get('q') ?? ''
  const [query, setQuery] = useState(initialQ)

  useEffect(() => {
    setQuery(searchParams.get('q') ?? '')
  }, [searchParams])

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-search-v2', query],
    queryFn: () => get<SearchResultsData>('/tourist/explore/search', { params: { q: query } }),
    enabled: query.trim().length >= 2,
  })

  const recent = JSON.parse(sessionStorage.getItem('tourist_recent_searches') || '[]') as string[]
  const foods = data?.foods ?? []
  const businesses = data?.businesses ?? []
  const searching = query.trim().length >= 2

  const recordSearch = (q: string) => {
    const qs = q.trim()
    if (!qs) return
    const next = [qs, ...recent.filter((r) => r !== qs)].slice(0, 6)
    sessionStorage.setItem('tourist_recent_searches', JSON.stringify(next))
  }

  const goToResults = (q: string) => {
    const qs = q.trim()
    if (!qs) return
    recordSearch(qs)
    navigate(`/tourist/search?q=${encodeURIComponent(qs)}`)
  }

  const openItem = (item: SearchItem) => {
    recordSearch(item.name)
    navigate(item.url)
  }

  const IconFor = ({ item }: { item: SearchItem }) => {
    switch (item.type) {
      case 'Food': return <UtensilsCrossed className="w-4 h-4 text-[#087F3F]" />
      case 'Municipality': return <Landmark className="w-4 h-4 text-[#B45309]" />
      case 'Event': return <CalendarRange className="w-4 h-4 text-[#7C3AED]" />
      default: return <Store className="w-4 h-4 text-[#0E7490]" />
    }
  }

  const ResultRow = ({ item }: { item: SearchItem }) => (
    <div
      onClick={() => openItem(item)}
      className="group flex items-center gap-3 bg-white border border-[#E5E9E7] rounded-2xl p-2.5 cursor-pointer hover:border-[#087F3F]/40 hover:scale-[1.01] transition-all"
    >
      {item.image ? (
        <img src={toAssetUrl(item.image)} alt={item.name} className="w-14 h-14 rounded-xl object-cover shrink-0" />
      ) : (
        <span className="w-14 h-14 rounded-xl bg-[#F2F7F3] flex items-center justify-center shrink-0"><IconFor item={item} /></span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-[#17201B] text-sm truncate">{item.name}</h3>
        <p className="text-xs text-[#6B7280] truncate mt-0.5 flex items-center gap-1">
          <MapPin className="w-3 h-3 text-[#087F3F]" /> {item.subtitle || 'Bansud'}
        </p>
      </div>
      {item.type === 'Food' && item.price != null && (
        <span className="text-sm font-bold text-[#087F3F] shrink-0">₱{item.price.toLocaleString()}</span>
      )}
    </div>
  )

  const noResults = searching && !isLoading && foods.length === 0 && businesses.length === 0

  return (
    <div className="min-h-screen">
      {/* Search field */}
      <div className="flex items-center gap-3 bg-white border border-[#E5E9E7] rounded-2xl p-2 pr-3 shadow-sm">
        <div className="flex items-center gap-2 flex-1">
          <Search className="w-5 h-5 text-[#6B7280] ml-2 shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') goToResults(query) }}
            placeholder="Search restaurants, food hubs, or food..."
            className="flex-1 bg-transparent outline-none text-[#17201B] text-sm placeholder:text-[#6B7280] py-2.5"
          />
        </div>
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear" className="p-1.5 rounded-full text-[#6B7280] hover:text-[#17201B] hover:bg-[#E5E9E7] transition">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="mt-6 space-y-8 pb-10">
        {!searching && (
          <>
            {recent.length > 0 && (
              <section>
                <h2 className="text-sm font-bold text-[#17201B] mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#6B7280]" /> Recent Searches
                </h2>
                <div className="flex flex-wrap gap-2">
                  {recent.map((r) => (
                    <button
                      key={r}
                      onClick={() => setQuery(r)}
                      className="text-sm bg-white border border-[#E5E9E7] text-[#17201B] px-3 py-1.5 rounded-full hover:border-[#087F3F]/50 hover:text-[#087F3F] transition"
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h2 className="text-sm font-bold text-[#17201B] mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#F4B400]" /> Popular Searches
              </h2>
              <div className="flex flex-wrap gap-2">
                {POPULAR.map((r) => (
                  <button
                    key={r}
                    onClick={() => setQuery(r)}
                    className="text-sm bg-white border border-[#E5E9E7] text-[#6B7280] px-3 py-1.5 rounded-full hover:border-[#087F3F]/40 hover:text-[#087F3F] transition"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </section>
            <section>
              <h2 className="text-sm font-bold text-[#17201B] mb-3">Quick Actions</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl">
                <button
                  onClick={() => navigate('/tourist/food')}
                  className="text-left bg-white border border-[#E5E9E7] rounded-xl p-4 hover:border-[#087F3F]/40 transition"
                >
                  <p className="text-sm text-[#17201B] font-medium">Browse All Food</p>
                  <p className="text-xs text-[#6B7280] mt-1">Discover local food businesses</p>
                </button>
                <button
                  onClick={() => navigate('/tourist/history')}
                  className="text-left bg-white border border-[#E5E9E7] rounded-xl p-4 hover:border-[#087F3F]/40 transition"
                >
                  <p className="text-sm text-[#17201B] font-medium">View Orders</p>
                  <p className="text-xs text-[#6B7280] mt-1">Check your order history</p>
                </button>
              </div>
            </section>
          </>
        )}

        {searching && isLoading && <DashboardSkeleton />}

        {noResults && (
          <div className="bg-white rounded-2xl border border-[#E5E9E7] p-10 text-center">
            <p className="text-[#17201B] font-semibold">No results for "{query}"</p>
            <p className="text-sm text-[#6B7280] mt-1">Try a different search or browse categories.</p>
          </div>
        )}

        {searching && !isLoading && !noResults && (
          <>
            {(foods.length > 0 || businesses.length > 0) && (
              <section>
                <h2 className="text-sm font-bold text-[#17201B] mb-3">Food ({foods.length})</h2>
                {foods.length === 0 ? (
                  <p className="text-sm text-[#6B7280]">No matching foods.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {foods.map((f) => <ResultRow key={`food-${f.id}`} item={f} />)}
                  </div>
                )}

                <h2 className="text-sm font-bold text-[#17201B] mt-8 mb-3">Businesses & Places ({businesses.length})</h2>
                {businesses.length === 0 ? (
                  <p className="text-sm text-[#6B7280]">No matching businesses.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {businesses.map((b) => <ResultRow key={`biz-${b.id}`} item={b} />)}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
