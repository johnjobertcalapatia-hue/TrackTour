import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { cn, formatCurrency } from '@/shared/utils'
import { useDebounce } from '@/shared/hooks/use-debounce'
import { getFoodCart, type FoodCartItem } from '@/shared/services/food-cart'
import FoodMenuCard, { type FoodItem } from '@/features/tourist/components/FoodMenuCard'
import { UtensilsCrossed, ChevronDown, Search, ShoppingCart, X, ArrowUpDown } from 'lucide-react'

interface FoodPage {
  data: FoodItem[]
  /** Real offering category names that currently have dishes. */
  categories?: string[]
  meta?: { current_page: number; last_page: number; total: number }
}

/** Sort options the API implements (see Tourist\FoodController::index). */
const SORT_OPTIONS = [
  { value: 'popular', label: 'Popular' },
  { value: 'price_low', label: 'Price: Low to High' },
  { value: 'price_high', label: 'Price: High to Low' },
  { value: 'newest', label: 'Newest' },
]

export default function TouristFood() {
  const navigate = useNavigate()
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedSort, setSelectedSort] = useState('popular')
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery.trim(), 300)
  const [cartItems, setCartItems] = useState<FoodCartItem[]>([])

  const syncCart = useCallback(() => setCartItems(getFoodCart()), [])

  useEffect(() => {
    syncCart()
    window.addEventListener('cart-updated', syncCart)
    return () => window.removeEventListener('cart-updated', syncCart)
  }, [syncCart])

  const foodsQuery = useInfiniteQuery({
    queryKey: ['tourist-foods', selectedCategory, selectedSort, debouncedSearch],
    queryFn: ({ pageParam }) => get<FoodPage>('/tourist/food', {
      params: { category: selectedCategory, sort: selectedSort, search: debouncedSearch, page: pageParam },
    }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.meta && last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined,
    staleTime: 60_000,
    // Keep the current list (and the category chips) on screen while a new
    // filter/sort/search loads, instead of flashing an empty page.
    placeholderData: keepPreviousData,
  })

  const pages = foodsQuery.data?.pages ?? []
  const foods = pages.flatMap((p) => p.data ?? [])
  const total = pages[0]?.meta?.total ?? foods.length
  const categories = pages[0]?.categories ?? []
  const isLoading = foodsQuery.isLoading
  const hasFilters = selectedCategory !== 'all' || searchQuery.trim() !== ''

  const cartCount = cartItems.reduce((s, c) => s + c.quantity, 0)
  const cartSubtotal = cartItems.reduce((s, item) => s + item.price * item.quantity, 0)

  const clearFilters = () => {
    setSelectedCategory('all')
    setSearchQuery('')
  }

  return (
    <div className="max-w-[1600px] mx-auto pb-24 lg:pb-6">
      {/* Header */}
      <header className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#17201B] tracking-tight">Food</h1>
        <p className="mt-1 text-sm sm:text-base text-[#56615B]">Discover delicious food from local restaurants</p>
      </header>

      {/* Search + sort (one row) */}
      <div className="flex items-center gap-2 sm:gap-3">
        <label className="relative flex-1 min-w-0">
          <span className="sr-only">Search food or restaurants</span>
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#56615B]" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search food, restaurants..."
            className="w-full h-11 pl-10 pr-10 bg-white border border-[#E5E9E7] rounded-full text-sm text-[#17201B] placeholder-[#68736D] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-[#56615B] hover:bg-[#F3F8F4]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </label>
        <label className="relative shrink-0">
          <span className="sr-only">Sort dishes</span>
          <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#087F3F] pointer-events-none" aria-hidden="true" />
          <select
            value={selectedSort}
            onChange={(e) => setSelectedSort(e.target.value)}
            className="appearance-none h-11 w-[132px] sm:w-auto bg-white border border-[#E5E9E7] rounded-full pl-9 pr-8 text-sm font-medium text-[#17201B] truncate focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F]"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#56615B] pointer-events-none" aria-hidden="true" />
        </label>
      </div>

      {/* Category chips: real categories, one swipeable row */}
      <nav aria-label="Food categories" className="mt-3 -mx-4 px-4 sm:mx-0 sm:px-0 flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {['all', ...categories].map((cat) => {
          const active = selectedCategory === cat
          return (
            <button
              key={cat}
              type="button"
              aria-pressed={active}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                'food-chip shrink-0 whitespace-nowrap h-9 px-4 rounded-full text-sm font-semibold border transition-colors',
                active ? 'bg-[#087F3F] border-[#087F3F] text-white' : 'bg-white border-[#E5E9E7] text-[#3B4540] hover:border-[#087F3F] hover:text-[#087F3F]',
              )}
            >
              {cat === 'all' ? 'All' : cat}
            </button>
          )
        })}
      </nav>

      {/* Results summary */}
      <div className="mt-4 mb-3 flex items-center justify-between gap-3 min-h-[24px]">
        <p className="text-sm text-[#56615B]" aria-live="polite">
          {isLoading ? 'Loading dishes…' : <><span className="font-semibold text-[#17201B]">{total}</span> {total === 1 ? 'dish' : 'dishes'}</>}
        </p>
        {hasFilters && !isLoading && (
          <button type="button" onClick={clearFilters} className="text-sm font-semibold text-[#087F3F] hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="food-list-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden animate-pulse">
              <div className="aspect-[4/3] bg-[#E5E9E7]" />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-[#E5E9E7] rounded w-3/4" />
                <div className="h-3 bg-[#E5E9E7] rounded w-1/2" />
                <div className="h-9 bg-[#E5E9E7] rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      ) : foods.length === 0 ? (
        <div className="text-center py-14 rounded-2xl border border-dashed border-[#C2DEC9] bg-white">
          <UtensilsCrossed className="w-12 h-12 text-[#C2DEC9] mx-auto mb-3" aria-hidden="true" />
          <h3 className="text-base font-bold text-[#17201B]">No dishes found</h3>
          <p className="mt-1 text-sm text-[#56615B]">Try another category or search term.</p>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 h-10 px-5 bg-[#087F3F] text-white rounded-full text-sm font-semibold hover:bg-[#056B35] transition"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="food-list-grid">
            {foods.map((food) => (
              <FoodMenuCard key={food.id} food={food} onOpen={() => navigate(`/tourist/food/item/${food.id}`)} />
            ))}
          </div>
          {foodsQuery.hasNextPage && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => foodsQuery.fetchNextPage()}
                disabled={foodsQuery.isFetchingNextPage}
                className="h-11 px-6 rounded-full border-2 border-[#087F3F] bg-white text-sm font-bold text-[#087F3F] hover:bg-[#E9F7EF] disabled:opacity-60 transition"
              >
                {foodsQuery.isFetchingNextPage ? 'Loading…' : 'Show more dishes'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Floating cart bar (above the mobile bottom navigation) */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 z-[1900] px-4 bottom-[calc(var(--tourist-bottom-nav-space)+0.75rem)] lg:bottom-6 lg:left-[248px] pointer-events-none">
          <button
            type="button"
            onClick={() => navigate('/tourist/food/cart')}
            className="pointer-events-auto w-full max-w-lg mx-auto flex items-center justify-between gap-4 h-14 px-5 bg-[#087F3F] text-white rounded-2xl hover:bg-[#056B35] transition-colors"
          >
            <span className="flex items-center gap-3">
              <span className="relative">
                <ShoppingCart className="w-5 h-5" aria-hidden="true" />
                <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 bg-[#F4B400] text-[#17201B] text-[10px] font-bold rounded-full flex items-center justify-center">
                  {cartCount}
                </span>
              </span>
              <span className="text-sm font-semibold">{cartCount} {cartCount === 1 ? 'item' : 'items'} in cart</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-sm font-bold">{formatCurrency(cartSubtotal)}</span>
              <span className="text-xs opacity-90">View Cart</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
