import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { get } from '@/shared/services/api'
import { useClickOutside } from '@/shared/hooks/use-click-outside'

interface SearchResult {
  id: number
  name: string
  subtitle: string
  type: string
  url: string
}

interface SearchResults {
  businesses: SearchResult[]
  municipalities: SearchResult[]
  events: SearchResult[]
}

interface SearchSuggestionsProps {
  placeholder?: string
  onSelect?: (item: SearchResult | string) => void
  onQueryChange?: (query: string) => void
}

export default function SearchSuggestions({
  placeholder = 'Search restaurants, hotels, attractions, beaches...',
  onSelect,
  onQueryChange,
}: SearchSuggestionsProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>({
    businesses: [],
    municipalities: [],
    events: [],
  })
  const [show, setShow] = useState(false)
  const wrapperRef = useClickOutside<HTMLDivElement>(() => setShow(false))
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults({ businesses: [], municipalities: [], events: [] })
      return
    }
    try {
      const data = await get<SearchResults>('/tourist/explore/search', {
        params: { q },
      })
      setResults(data)
      setShow(true)
    } catch {
      console.error('Error fetching suggestions')
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(query), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, fetchSuggestions])

  useEffect(() => {
    onQueryChange?.(query)
  }, [query, onQueryChange])

  const hasResults =
    results.businesses.length > 0 ||
    results.municipalities.length > 0 ||
    results.events.length > 0

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && setShow(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShow(false)
            if (e.key === 'Enter') {
              setShow(false)
              onSelect?.(query)
            }
          }}
          placeholder={placeholder}
          className="w-full h-full pl-12 pr-14 py-3.5 bg-night-soft/80 backdrop-blur-md rounded-2xl border border-white/10 text-sm text-white placeholder-muted/70 focus:ring-2 focus:ring-brand/50 focus:border-brand/50 focus:outline-none transition-all"
        />
      </div>

      {show && hasResults && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-night-card/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/50 border border-white/10 overflow-hidden z-50">
          <div className="p-2 max-h-80 overflow-y-auto">
            {results.businesses.map((b) => (
              <button
                key={`biz-${b.id}`}
                onClick={() => navigate(b.url)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors w-full text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-brand/15 flex items-center justify-center text-brand-light text-xs font-bold shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{b.name}</p>
                  <p className="text-xs text-muted">{b.subtitle}</p>
                </div>
                <span className="text-[10px] font-medium text-brand-light uppercase shrink-0">
                  {b.type}
                </span>
              </button>
            ))}
            {results.businesses.length > 0 &&
              (results.municipalities.length > 0 || results.events.length > 0) && (
                <div className="border-t border-white/10 my-1" />
              )}
            {results.municipalities.map((m) => (
              <button
                key={`mun-${m.id}`}
                onClick={() => navigate(m.url)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors w-full text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-gold/15 flex items-center justify-center text-gold text-xs font-bold shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{m.name}</p>
                  <p className="text-xs text-muted">{m.subtitle}</p>
                </div>
                <span className="text-[10px] font-medium text-gold uppercase shrink-0">
                  {m.type}
                </span>
              </button>
            ))}
            {results.events.length > 0 &&
              (results.businesses.length > 0 || results.municipalities.length > 0) && (
                <div className="border-t border-white/10 my-1" />
              )}
            {results.events.map((e) => (
              <button
                key={`evt-${e.id}`}
                onClick={() => navigate(e.url)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors w-full text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-purple-500/15 flex items-center justify-center text-purple-300 text-xs font-bold shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{e.name}</p>
                  <p className="text-xs text-muted">{e.subtitle}</p>
                </div>
                <span className="text-[10px] font-medium text-purple-400 uppercase shrink-0">
                  {e.type}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
