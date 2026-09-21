import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { categoryName, toAssetUrl } from '@/shared/utils'
import { UtensilsCrossed, Star, Heart, ChevronDown, Search, MapPin, ShoppingCart, Plus, Minus, Check } from 'lucide-react'

interface FoodItem {
  id: number
  name: string
  description: string
  category: unknown
  image: string
  price: number
  business_name: string
  business_id: number
  business_latitude: number | null
  business_longitude: number | null
  rating: number
  review_count: number
  is_open: boolean
  is_accepting_orders: boolean
  availability: string
  open_status: { status: string; label: string }
}

interface CartItem {
  id: number
  name: string
  price: number
  image: string | null
  business_name: string
  business_id: number
  quantity: number
}

const CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'filipino', label: 'Filipino' },
  { value: 'street_food', label: 'Street Food' },
  { value: 'fast_food', label: 'Fast Food' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'cafe', label: 'Cafe' },
  { value: 'desserts', label: 'Desserts' },
  { value: 'drinks', label: 'Drinks' },
  { value: 'local_specialties', label: 'Local Specialties' },
]

const SORT_OPTIONS = [
  { value: 'popular', label: 'Popular' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'price_low', label: 'Price: Low to High' },
  { value: 'price_high', label: 'Price: High to Low' },
  { value: 'newest', label: 'Newest' },
]

function getCart(): CartItem[] {
  try { return JSON.parse(localStorage.getItem('food_cart') || '[]') } catch { return [] }
}

function setCart(cart: CartItem[]) {
  localStorage.setItem('food_cart', JSON.stringify(cart))
  window.dispatchEvent(new Event('cart-updated'))
}

function addToCart(food: FoodItem) {
  const cart = getCart()
  const existing = cart.find((c) => c.id === food.id)
  if (existing) {
    existing.quantity += 1
  } else {
    cart.push({
      id: food.id,
      name: food.name,
      price: Number(food.price),
      image: food.image,
      business_name: food.business_name,
      business_id: food.business_id,
      business_latitude: food.business_latitude,
      business_longitude: food.business_longitude,
      quantity: 1,
    })
  }
  setCart(cart)
}

function getCartQuantity(foodId: number): number {
  const cart = getCart()
  return cart.find((c) => c.id === foodId)?.quantity ?? 0
}

export default function TouristFood() {
  const navigate = useNavigate()
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedSort, setSelectedSort] = useState('popular')
  const [searchQuery, setSearchQuery] = useState('')
  const [cartCount, setCartCount] = useState(0)
  const [cartItems, setCartItems] = useState<CartItem[]>([])

  const syncCart = useCallback(() => {
    const cart = getCart()
    setCartCount(cart.reduce((s, c) => s + c.quantity, 0))
    setCartItems(cart)
  }, [])

  useEffect(() => {
    syncCart()
    window.addEventListener('cart-updated', syncCart)
    return () => window.removeEventListener('cart-updated', syncCart)
  }, [syncCart])

  const { data: foodsData, isLoading } = useQuery({
    queryKey: ['tourist-foods', selectedCategory, selectedSort, searchQuery],
    queryFn: () => get<{ data: FoodItem[] }>('/tourist/food', {
      params: { category: selectedCategory, sort: selectedSort, search: searchQuery }
    }),
    staleTime: 60_000,
  })
  const foods = foodsData?.data ?? []

  const cartSubtotal = cartItems.reduce((s, item) => s + item.price * item.quantity, 0)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-[#17201B] tracking-tight">Food</h1>
        <p className="mt-2 text-[#68736D] text-lg">Discover delicious food from local restaurants</p>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-8">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search food, restaurants..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F]"
          />
        </div>

        <div className="relative">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="appearance-none bg-white border border-[#E5E9E7] rounded-xl px-4 py-2.5 pr-10 text-sm text-[#17201B] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F]"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={selectedSort}
            onChange={(e) => setSelectedSort(e.target.value)}
            className="appearance-none bg-white border border-[#E5E9E7] rounded-xl px-4 py-2.5 pr-10 text-sm text-[#17201B] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F]"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>Sort by: {s.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap gap-2 mb-8">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setSelectedCategory(cat.value)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
              selectedCategory === cat.value
                ? 'bg-[#087F3F] text-white shadow-md shadow-[#087F3F]/20'
                : 'bg-white border border-[#E5E9E7] text-[#68736D] hover:border-[#087F3F] hover:text-[#087F3F]'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-[#68736D]">
          Showing <span className="font-semibold text-[#17201B]">{foods.length}</span> food items
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden animate-pulse">
              <div className="h-52 bg-gray-200" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
                <div className="h-5 bg-gray-200 rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : foods.length === 0 ? (
        <div className="text-center py-16">
          <UtensilsCrossed className="w-16 h-16 text-[#E5E9E7] mx-auto mb-4" />
          <h3 className="text-lg font-bold text-[#17201B] mb-2">No food items found</h3>
          <p className="text-[#68736D] mb-6">Try changing your filters or search for something else.</p>
          <button
            onClick={() => { setSelectedCategory('all'); setSearchQuery('') }}
            className="px-6 py-2.5 bg-[#087F3F] text-white rounded-xl font-medium hover:bg-[#056B35] transition"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {foods.map((food) => (
            <FoodCard key={food.id} food={food} onAddToCart={() => { addToCart(food); syncCart() }} />
          ))}
        </div>
      )}

      {/* Floating Cart Button */}
      {cartCount > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-lg px-4">
          <button
            onClick={() => navigate('/tourist/food/cart')}
            className="w-full flex items-center justify-between gap-4 px-5 py-4 bg-[#087F3F] text-white rounded-2xl shadow-xl shadow-[#087F3F]/30 hover:bg-[#056B35] transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <ShoppingCart className="w-5 h-5" />
                <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 bg-[#F4B400] text-[#17201B] text-[10px] font-bold rounded-full flex items-center justify-center">
                  {cartCount}
                </span>
              </div>
              <span className="text-sm font-semibold">{cartCount} {cartCount === 1 ? 'item' : 'items'} in cart</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">₱{cartSubtotal.toLocaleString()}</span>
              <span className="text-xs opacity-80">View Cart</span>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}

function FoodCard({ food, onAddToCart }: { food: FoodItem; onAddToCart: () => void }) {
  const [liked, setLiked] = useState(false)
  const [justAdded, setJustAdded] = useState(false)
  const [qty, setQty] = useState(0)
  const imageUrl = toAssetUrl(food.image)
  const accepting = food.is_accepting_orders
  const closedLabel = food.open_status?.label ?? 'Closed'

  useEffect(() => {
    setQty(getCartQuantity(food.id))
  }, [food.id])

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    onAddToCart()
    setJustAdded(true)
    setQty((q) => q + 1)
    setTimeout(() => setJustAdded(false), 1200)
  }

  const handleIncrease = (e: React.MouseEvent) => {
    e.stopPropagation()
    onAddToCart()
    setQty((q) => q + 1)
  }

  const handleDecrease = (e: React.MouseEvent) => {
    e.stopPropagation()
    const cart = getCart()
    const item = cart.find((c) => c.id === food.id)
    if (item) {
      item.quantity -= 1
      if (item.quantity <= 0) {
        const idx = cart.indexOf(item)
        cart.splice(idx, 1)
      }
      setCart(cart)
    }
    setQty((q) => Math.max(0, q - 1))
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/8 transition-all duration-300 group">
      {/* Image */}
      <div className="relative h-52 overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt={food.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] flex items-center justify-center">
            <UtensilsCrossed className="w-12 h-12 text-[#087F3F]/30" />
          </div>
        )}
        {/* Category Badge */}
        <div className="absolute top-3 left-3">
          <span className="inline-flex items-center px-2.5 py-1 bg-[#087F3F]/90 backdrop-blur-sm rounded-full text-xs font-semibold text-white">
            {categoryName(food.category)}
          </span>
        </div>
        {/* Favorite */}
        <button
          onClick={(e) => { e.stopPropagation(); setLiked(!liked) }}
          className="absolute top-3 right-3 p-2 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition"
        >
          <Heart className={`w-4 h-4 ${liked ? 'fill-red-500 text-red-500' : 'text-[#68736D]'}`} />
        </button>
        {/* Rating */}
        <div className="absolute bottom-3 left-3">
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-white/90 backdrop-blur-sm rounded-lg text-xs font-bold">
            <Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" />
            <span className="text-[#17201B]">{food.rating || '4.5'}</span>
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-bold text-[#17201B] text-lg mb-1 line-clamp-1">{food.name}</h3>
        <div className="flex items-center gap-1.5 text-[#68736D] text-sm mb-2">
          <MapPin className="w-3.5 h-3.5" />
          <span className="truncate">{food.business_name}</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${
            accepting ? 'bg-[#E9F7EF] text-[#087F3F]' : 'bg-[#FEE2E2] text-[#B91C1C]'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${accepting ? 'bg-[#087F3F]' : 'bg-[#B91C1C]'}`} />
            {accepting ? 'Open' : 'Closed'}
          </span>
        </div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-lg font-extrabold text-[#087F3F]">₱{food.price?.toLocaleString() || '0'}</span>
        </div>

        {/* Add to Cart / Quantity Controls */}
        {!accepting ? (
          <div className="w-full py-2.5 rounded-xl bg-[#F3F4F6] border border-[#E5E9E7] text-center">
            <p className="text-xs font-semibold text-[#647067]">{closedLabel}</p>
            <p className="text-[11px] text-[#9CA3AF]">Unavailable for order</p>
          </div>
        ) : qty === 0 ? (
          <button
            onClick={handleAdd}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#087F3F] text-white text-sm font-semibold rounded-xl hover:bg-[#056B35] transition-all active:scale-95"
          >
            <ShoppingCart className="w-4 h-4" />
            Add to Cart
          </button>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 bg-[#E9F7EF] rounded-xl">
              <button
                onClick={handleDecrease}
                className="w-9 h-9 flex items-center justify-center text-[#087F3F] hover:bg-[#087F3F] hover:text-white rounded-xl transition-all"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-6 text-center text-sm font-bold text-[#17201B]">{qty}</span>
              <button
                onClick={handleIncrease}
                className="w-9 h-9 flex items-center justify-center text-[#087F3F] hover:bg-[#087F3F] hover:text-white rounded-xl transition-all"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={(e) => { e.stopPropagation() }}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#E9F7EF] text-[#087F3F] text-xs font-semibold rounded-xl"
            >
              <Check className="w-3.5 h-3.5" />
              In Cart
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
