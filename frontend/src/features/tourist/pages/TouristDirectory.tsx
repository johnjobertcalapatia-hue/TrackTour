import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { Link, useSearchParams } from 'react-router-dom'
import { categoryName } from '@/shared/utils'

import {
  Search,
  MapPin,
  Star,
  Clock,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  X,
  TrendingUp,
  Sparkles,
  Tag,
  Navigation,
  ShieldCheck,
  Flame,
  Store,
  Grid3X3,
} from 'lucide-react'

interface Business {
  _id: string
  name: string
  category: string
  municipality: string
  address: string
  rating: number
  reviewCount: number
  coverImage: string
  isOpen: boolean
  hasPromotions: boolean
  isVerified: boolean
  isNew: boolean
  featured: boolean
  description: string
}

interface DirectoryResponse {
  businesses: Business[]
  totalCount: number
  totalPages: number
  currentPage: number
}

interface Category {
  _id: string
  name: string
  icon: string
  count: number
}

const QUICK_FILTERS = [
  { key: 'all', label: 'All', icon: Grid3X3 },
  { key: 'open_now', label: 'Open Now', icon: Clock },
  { key: 'top_rated', label: 'Top Rated', icon: Star },
  { key: 'with_promotions', label: 'With Promotions', icon: Tag },
  { key: 'nearest', label: 'Nearest', icon: Navigation },
  { key: 'popular', label: 'Popular', icon: TrendingUp },
  { key: 'verified', label: 'Verified', icon: ShieldCheck },
  { key: 'new', label: 'New', icon: Sparkles },
]

const MUNICIPALITIES = [
  'All Municipalities',
  'Baguio City',
  'La Trinidad',
  'Itogon',
  'Sablan',
  'Tuba',
  'Kapangan',
  'Bokod',
  'Buguias',
  'Mankayan',
  'Bakun',
  'Kibungan',
  'Atok',
  'Kabayan',
  'Tublay',
]

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'rating_desc', label: 'Highest Rated' },
  { value: 'reviews_desc', label: 'Most Reviewed' },
  { value: 'name_asc', label: 'Name A-Z' },
  { value: 'newest', label: 'Newest' },
]

function debounce<T extends (...args: any[]) => any>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

function safeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && 'name' in value && typeof (value as { name: unknown }).name === 'string') {
    return (value as { name: string }).name
  }
  return ''
}

export default function TouristDirectory() {
  const [searchParams, setSearchParams] = useSearchParams()

  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '')
  const [activeFilter, setActiveFilter] = useState(searchParams.get('filter') || 'all')
  const [activeCategory, setActiveCategory] = useState(searchParams.get('category') || '')
  const [selectedMunicipality, setSelectedMunicipality] = useState(searchParams.get('municipality') || '')
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'relevance')
  const [currentPage, setCurrentPage] = useState(Number(searchParams.get('page')) || 1)
  const [showFilters, setShowFilters] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get('search') || '')

  const debouncedSetSearch = useCallback(
    debounce((value: string) => setDebouncedSearch(value), 400),
    []
  )

  useEffect(() => {
    debouncedSetSearch(searchInput)
  }, [searchInput, debouncedSetSearch])

  useEffect(() => {
    const params: Record<string, string> = {}
    if (debouncedSearch) params.search = debouncedSearch
    if (activeFilter !== 'all') params.filter = activeFilter
    if (activeCategory) params.category = activeCategory
    if (selectedMunicipality) params.municipality = selectedMunicipality
    if (sortBy !== 'relevance') params.sort = sortBy
    if (currentPage > 1) params.page = String(currentPage)
    setSearchParams(params, { replace: true })
  }, [debouncedSearch, activeFilter, activeCategory, selectedMunicipality, sortBy, currentPage, setSearchParams])

  const { data: categories } = useQuery<Category[]>({
    queryKey: ['tourist', 'categories'],
    queryFn: () => get('/tourist/explore/categories'),
  })

  const { data: featuredData } = useQuery<{ businesses: Business[] }>({
    queryKey: ['tourist', 'featured-businesses'],
    queryFn: () => get('/tourist/explore/featured'),
  })

  const { data, isLoading, isError } = useQuery<DirectoryResponse>({
    queryKey: ['tourist', 'directory', debouncedSearch, activeFilter, activeCategory, selectedMunicipality, sortBy, currentPage],
    queryFn: () => {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (activeFilter !== 'all') params.set('filter', activeFilter)
      if (activeCategory) params.set('category', activeCategory)
      if (selectedMunicipality) params.set('municipality', selectedMunicipality)
      if (sortBy !== 'relevance') params.set('sort', sortBy)
      params.set('page', String(currentPage))
      return get(`/tourist/explore/directory?${params.toString()}`)
    },
  })

  const businesses = data?.businesses || []
  const totalPages = data?.totalPages || 1
  const totalCount = data?.totalCount || 0
  const featuredBusinesses = featuredData?.businesses || []

  const handleFilterChange = (filter: string) => {
    setActiveFilter(filter)
    setCurrentPage(1)
  }

  const handleCategoryChange = (category: string) => {
    setActiveCategory(activeCategory === category ? '' : category)
    setCurrentPage(1)
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <Store className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-100 mb-2">Failed to load directory</h2>
          <p className="text-gray-400">Please try again later.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Hero Search Section */}
      <div className="relative bg-gradient-to-br from-emerald-900/80 via-emerald-800/60 to-gray-900 overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_30%_50%,rgba(16,185,129,0.3),transparent_50%)]" />
          <div className="absolute bottom-0 right-0 w-full h-full bg-[radial-gradient(circle_at_70%_50%,rgba(5,150,105,0.2),transparent_50%)]" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
          <h1 className="text-3xl lg:text-4xl font-bold text-gray-100 mb-2">Explore Benguet</h1>
          <p className="text-emerald-200/80 text-lg mb-8">Discover businesses, restaurants, and services across the province</p>
          <div className="relative max-w-2xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search businesses, services, categories..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full pl-12 pr-12 py-4 bg-gray-900/80 backdrop-blur-xl border border-gray-700/50 rounded-2xl text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 text-lg"
            />
            {searchInput && (
              <button
                onClick={() => {
                  setSearchInput('')
                  setDebouncedSearch('')
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Quick Filter Buttons */}
        <div className="flex flex-wrap gap-2 mb-6">
          {QUICK_FILTERS.map((f) => {
            const Icon = f.icon
            return (
              <button
                key={f.key}
                onClick={() => handleFilterChange(f.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  activeFilter === f.key
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25'
                    : 'bg-gray-900/80 backdrop-blur-xl border border-gray-700/30 text-gray-300 hover:border-emerald-500/50 hover:text-emerald-400'
                }`}
              >
                <Icon className="w-4 h-4" />
                {f.label}
              </button>
            )
          })}
        </div>

        {/* Category Row */}
        {categories && categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {categories.map((cat) => (
              <button
                key={cat._id}
                onClick={() => handleCategoryChange(cat.name)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  activeCategory === cat.name
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25'
                    : 'bg-gray-800/50 border border-gray-700/30 text-gray-300 hover:border-emerald-500/50 hover:text-emerald-400'
                }`}
              >
                <span>{cat.name}</span>
                <span className="text-xs opacity-60">({cat.count})</span>
              </button>
            ))}
          </div>
        )}

        {/* Municipality & Sort Row */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="flex-1">
            <select
              value={selectedMunicipality}
              onChange={(e) => {
                setSelectedMunicipality(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full px-4 py-3 bg-gray-900/80 backdrop-blur-xl border border-gray-700/30 rounded-xl text-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none cursor-pointer"
            >
              {MUNICIPALITIES.map((m) => (
                <option key={m} value={m === 'All Municipalities' ? '' : m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 sm:max-w-xs">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full px-4 py-3 bg-gray-900/80 backdrop-blur-xl border border-gray-700/30 rounded-xl text-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none cursor-pointer"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  Sort: {opt.label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-4 py-3 bg-gray-900/80 backdrop-blur-xl border border-gray-700/30 rounded-xl text-gray-300 hover:text-emerald-400 hover:border-emerald-500/50 transition-all sm:hidden"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
          </button>
        </div>

        {/* Results Count */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-gray-400 text-sm">
            {isLoading ? (
              'Searching...'
            ) : (
              <>
                Showing <span className="text-gray-200 font-medium">{businesses.length}</span> of{' '}
                <span className="text-gray-200 font-medium">{totalCount}</span> businesses
              </>
            )}
          </p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 overflow-hidden animate-pulse">
                <div className="h-48 bg-gray-800/50" />
                <div className="p-5 space-y-3">
                  <div className="h-5 bg-gray-800/50 rounded w-3/4" />
                  <div className="h-4 bg-gray-800/50 rounded w-1/2" />
                  <div className="h-4 bg-gray-800/50 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Business Grid */}
        {!isLoading && businesses.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {businesses.map((biz) => (
              <Link
                key={biz._id}
                to={`/tourist/explore/business/${biz._id}`}
                className="group bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 overflow-hidden hover:border-emerald-500/30 transition-all duration-300"
              >
                {/* Cover Image */}
                <div className="relative h-48 overflow-hidden">
                  <img
                    src={biz.coverImage || '/placeholder-business.jpg'}
                    alt={biz.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 via-transparent to-transparent" />
                  {/* Badges */}
                  <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                        biz.isOpen
                          ? 'bg-emerald-500/90 text-white'
                          : 'bg-red-500/90 text-white'
                      }`}
                    >
                      {biz.isOpen ? 'Open' : 'Closed'}
                    </span>
                    {biz.hasPromotions && (
                      <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/90 text-white">
                        Promo
                      </span>
                    )}
                    {biz.isVerified && (
                      <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-500/90 text-white">
                        Verified
                      </span>
                    )}
                  </div>
                  {/* Rating */}
                  <div className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-1 bg-gray-900/80 backdrop-blur-sm rounded-lg">
                    <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                    <span className="text-sm font-semibold text-gray-100">{biz.rating?.toFixed(1) || 'N/A'}</span>
                    <span className="text-xs text-gray-400">({biz.reviewCount})</span>
                  </div>
                </div>

                {/* Content */}
                <div className="p-5">
                  <h3 className="text-lg font-semibold text-gray-100 mb-1 group-hover:text-emerald-400 transition-colors">
                    {biz.name}
                  </h3>
                  <p className="text-sm text-emerald-400/80 mb-1">{categoryName(biz.category)}</p>
                  <div className="flex items-center gap-1 text-gray-400 text-sm mb-3">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{safeText(biz.municipality)}</span>
                  </div>
                  {biz.address && (
                    <p className="text-gray-500 text-xs mb-4 line-clamp-1">{biz.address}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-center py-2 bg-emerald-600/10 text-emerald-400 rounded-xl text-sm font-medium border border-emerald-500/20 group-hover:bg-emerald-600 group-hover:text-white transition-all">
                      Visit Business
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(biz.address || safeText(biz.municipality))}`, '_blank') }}
                      className="p-2 bg-gray-800/50 rounded-xl text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                    >
                      <Navigation className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && businesses.length === 0 && (
          <div className="text-center py-16">
            <Store className="w-20 h-20 text-gray-700 mx-auto mb-6" />
            <h3 className="text-xl font-semibold text-gray-200 mb-2">No businesses found</h3>
            <p className="text-gray-500 mb-6">Try adjusting your search or filters</p>
            <button
              onClick={() => {
                setSearchInput('')
                setDebouncedSearch('')
                setActiveFilter('all')
                setActiveCategory('')
                setSelectedMunicipality('')
                setSortBy('relevance')
                setCurrentPage(1)
              }}
              className="px-6 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors font-medium"
            >
              Clear All Filters
            </button>
          </div>
        )}

        {/* Featured Businesses */}
        {!isLoading && featuredBusinesses.length > 0 && (
          <div className="mt-12 mb-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-emerald-500/10 rounded-xl">
                <Flame className="w-5 h-5 text-emerald-400" />
              </div>
              <h2 className="text-xl font-bold text-gray-100">Featured Businesses</h2>
            </div>
            <div className="flex gap-6 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory">
              {featuredBusinesses.map((biz) => (
                <Link
                  key={biz._id}
                  to={`/tourist/explore/business/${biz._id}`}
                  className="flex-shrink-0 w-72 snap-start bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 overflow-hidden hover:border-emerald-500/30 transition-all"
                >
                  <div className="relative h-36 overflow-hidden">
                    <img
                      src={biz.coverImage || '/placeholder-business.jpg'}
                      alt={biz.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 via-transparent to-transparent" />
                    <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-gray-900/80 backdrop-blur-sm rounded-lg">
                      <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                      <span className="text-xs font-semibold text-gray-100">{biz.rating?.toFixed(1)}</span>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-100 mb-1">{biz.name}</h3>
                    <p className="text-sm text-emerald-400/80">{categoryName(biz.category)}</p>
                    <div className="flex items-center gap-1 text-gray-500 text-xs mt-1">
                      <MapPin className="w-3 h-3" />
                      <span>{safeText(biz.municipality)}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 bg-gray-900/80 border border-gray-700/30 rounded-xl text-gray-400 hover:text-emerald-400 hover:border-emerald-500/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let page: number
              if (totalPages <= 7) {
                page = i + 1
              } else if (currentPage <= 4) {
                page = i + 1
              } else if (currentPage >= totalPages - 3) {
                page = totalPages - 6 + i
              } else {
                page = currentPage - 3 + i
              }
              return (
                <button
                  key={`page-${page}-${i}`}
                  onClick={() => setCurrentPage(page)}
                  className={`w-10 h-10 rounded-xl text-sm font-medium transition-all ${
                    currentPage === page
                      ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25'
                      : 'bg-gray-900/80 border border-gray-700/30 text-gray-400 hover:text-emerald-400 hover:border-emerald-500/50'
                  }`}
                >
                  {page}
                </button>
              )
            })}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-2 bg-gray-900/80 border border-gray-700/30 rounded-xl text-gray-400 hover:text-emerald-400 hover:border-emerald-500/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
