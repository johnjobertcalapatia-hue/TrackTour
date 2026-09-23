import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { post } from '@/shared/services/api'
import { createCheckoutSession } from '@/shared/services/payment'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { ArrowLeft, Trash2, Plus, Minus, ShoppingCart, Smartphone, Banknote, Zap, MapPin, StickyNote, Store, UtensilsCrossed, Search, X, LocateFixed, User, AlertCircle, Check } from 'lucide-react'
import { formatCurrency, toAssetUrl } from '@/shared/utils'
import { savePendingAction } from '@/shared/services/pending-action'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { userPinIcon } from '@/shared/utils/pin-icon'

interface CartItem {
  id: number
  name: string
  price: number
  image: string | null
  business_name: string
  business_id: number
  business_latitude?: number | null
  business_longitude?: number | null
  quantity: number
  notes?: string
}

const DELIVERY_BASE_FARE = 40.00
const DELIVERY_INCLUDED_KM = 2.00
const DELIVERY_PER_KM = 15.00
const DEFAULT_CENTER: [number, number] = [12.8667, 121.45]
const CART_VERSION = 2

interface DeliveryFeeData {
  delivery_fee: number
  distance_km: number
  estimated_duration_minutes: number | null
  base_fare: number
  distance_charge: number
  service_adjustment: number
  is_estimated: boolean
}

function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) })
  return null
}

function MapCenterUpdater({ center }: { center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    const timer = setTimeout(() => {
      try { map.setView(center, 16) } catch { /* map not ready */ }
    }, 100)
    return () => clearTimeout(timer)
  }, [center, map])
  return null
}

export default function TouristFoodCart() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [cart, setCart] = useState<CartItem[]>([])
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [landmark, setLandmark] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [orderType, setOrderType] = useState<'delivery' | 'pickup'>('delivery')
  const [deliverySpeed, setDeliverySpeed] = useState<'standard' | 'fast'>('standard')
  const [riderTip, setRiderTip] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'gcash' | 'cash'>('gcash')
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_CENTER)
  const [markerPos, setMarkerPos] = useState<[number, number] | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isLocating, setIsLocating] = useState(false)
  const [orderError, setOrderError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const stored = localStorage.getItem('food_cart')
    if (!stored) return
    try {
      const parsed = JSON.parse(stored)
      const migrated = parsed.map((item: any) => ({
        id: item.id ?? item.offering_id,
        name: item.name ?? item.product_name ?? '',
        price: Number(item.price ?? item.unit_price ?? 0),
        image: item.image ?? null,
        business_name: item.business_name ?? '',
        business_id: item.business_id ?? null,
        quantity: item.quantity ?? 1,
        notes: item.notes ?? undefined,
      }))
      setCart(migrated)
      localStorage.setItem('food_cart', JSON.stringify(migrated))
    } catch { /* corrupt data, start fresh */ }
  }, [])

  const updateCart = (updated: CartItem[]) => {
    setCart(updated)
    localStorage.setItem('food_cart', JSON.stringify(updated))
    window.dispatchEvent(new Event('cart-updated'))
  }

  const updateQuantity = (id: number, delta: number) => {
    updateCart(
      cart
        .map((item) => (item.id === id ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0)
    )
  }

  const removeItem = (id: number) => {
    updateCart(cart.filter((item) => item.id !== id))
  }

  const clearCart = () => {
    setCart([])
    localStorage.removeItem('food_cart')
    window.dispatchEvent(new Event('cart-updated'))
  }

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`)
      const data = await res.json()
      if (data.display_name) {
        const addr = data.address || {}
        const parts = [addr.house_number, addr.road, addr.neighbourhood || addr.suburb || addr.village].filter(Boolean)
        const short = parts.length > 0 ? parts.join(', ') : data.display_name.split(',').slice(0, 3).join(',')
        setDeliveryAddress(short)
        setSearchQuery(data.display_name)
      }
    } catch { /* ignore */ }
  }

  const handleMapClick = (lat: number, lng: number) => {
    setMarkerPos([lat, lng])
    reverseGeocode(lat, lng)
  }

  const searchAddress = () => {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1&addressdetails=1`)
        const data = await res.json()
        if (data.length > 0) {
          const lat = parseFloat(data[0].lat)
          const lng = parseFloat(data[0].lon)
          setMapCenter([lat, lng])
          setMarkerPos([lat, lng])
          const addr = data[0].address || {}
          const parts = [addr.house_number, addr.road, addr.neighbourhood || addr.suburb || addr.village].filter(Boolean)
          const short = parts.length > 0 ? parts.join(', ') : data[0].display_name.split(',').slice(0, 3).join(',')
          setDeliveryAddress(short)
        }
      } catch { /* ignore */ }
      setIsSearching(false)
    }, 500)
  }

  const useMyLocation = () => {
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        setMapCenter([latitude, longitude])
        setMarkerPos([latitude, longitude])
        reverseGeocode(latitude, longitude)
        setIsLocating(false)
      },
      () => { setIsLocating(false) },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  const fullAddress = [deliveryAddress, landmark].filter(Boolean).join(', ')

  const distinctBusinessIds = [...new Set(cart.map((item) => item.business_id).filter(Boolean))]
  const isMultiBusinessCart = distinctBusinessIds.length > 1
  const businessId = distinctBusinessIds[0] ?? null
  const businessName = cart.find((item) => item.business_id === businessId)?.business_name ?? cart[0]?.business_name ?? ''
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const pickupItem = cart.find((item) => item.business_id === businessId)
  const clientFallbackKm = markerPos && pickupItem?.business_latitude != null && pickupItem?.business_longitude != null
    ? (() => {
        const toRadians = (value: number) => value * Math.PI / 180
        const dLat = toRadians(markerPos[0] - Number(pickupItem.business_latitude))
        const dLng = toRadians(markerPos[1] - Number(pickupItem.business_longitude))
        const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRadians(Number(pickupItem.business_latitude))) * Math.cos(toRadians(markerPos[0])) * Math.sin(dLng / 2) ** 2
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      })()
    : null

  const singleBusinessDelivery = orderType === 'delivery' && !isMultiBusinessCart && businessId != null && markerPos !== null

  const feeQuery = useQuery<DeliveryFeeData>({
    queryKey: ['delivery-fee', businessId, markerPos?.[0], markerPos?.[1], orderType],
    queryFn: () => post<DeliveryFeeData>('/tourist/food/delivery-fee', {
      business_id: businessId,
      delivery_latitude: markerPos?.[0],
      delivery_longitude: markerPos?.[1],
    }),
    enabled: orderType === 'delivery' && businessId != null && markerPos !== null,
    staleTime: 60_000,
    retry: 1,
  })

  const feeData = feeQuery.data
  const estimatedDistanceKm = feeData?.distance_km ?? (singleBusinessDelivery ? clientFallbackKm : null)
  const distanceCharge = feeData?.distance_charge ?? (estimatedDistanceKm == null
    ? 0
    : Math.max(estimatedDistanceKm - DELIVERY_INCLUDED_KM, 0) * DELIVERY_PER_KM)
  const deliveryFee = feeData?.delivery_fee ?? (orderType === 'delivery' && estimatedDistanceKm != null
    ? Math.max(DELIVERY_BASE_FARE + distanceCharge, DELIVERY_BASE_FARE)
    : 0)
  const groupFeesReady = !isMultiBusinessCart
    || orderType !== 'delivery'
    || feeData !== undefined
  const groupDeliveryFee = groupFeesReady ? (feeData?.delivery_fee ?? 0) : 0
  const calculatedDeliveryFee = isMultiBusinessCart ? groupDeliveryFee : deliveryFee
  const riderTipAmount = deliverySpeed === 'fast' && orderType === 'delivery' ? Number(riderTip) || 0 : 0
  const total = subtotal + calculatedDeliveryFee + riderTipAmount

  const availabilityQuery = useQuery({
    queryKey: ['food-availability', [...distinctBusinessIds].sort()],
    queryFn: () => post<{ restaurants: Record<number, { is_accepting_orders: boolean; availability: string; open_status: { status: string; label: string }; business_name: string }> }>('/tourist/food/availability', {
      business_ids: distinctBusinessIds,
    }),
    enabled: distinctBusinessIds.length > 0,
    staleTime: 60_000,
  })

  const restaurantStatus = availabilityQuery.data?.restaurants ?? {}
  const closedBusinessIds = distinctBusinessIds.filter((id) => restaurantStatus[id] && !restaurantStatus[id].is_accepting_orders)
  const hasClosedRestaurant = closedBusinessIds.length > 0

  const checkoutMutation = useMutation({
    mutationFn: async (items: CartItem[]) => {
      setOrderError('')

      if (isMultiBusinessCart) {
        // Group checkout across multiple restaurants
        const groups = new Map<number, CartItem[]>()
        items.forEach((item) => {
          if (!groups.has(item.business_id)) groups.set(item.business_id, [])
          groups.get(item.business_id)!.push(item)
        })

        const restaurants = Array.from(groups.entries()).map(([businessId, groupItems]) => ({
          business_id: businessId,
          items: groupItems.map((item) => ({ offering_id: item.id, quantity: item.quantity, notes: item.notes || null })),
        }))

        const response = await post<{ group_order: { id: number; reference_number: string } }>('/tourist/food/group-order', {
          restaurants,
          order_type: orderType,
          delivery_address: orderType === 'delivery' ? fullAddress : null,
          delivery_latitude: orderType === 'delivery' ? markerPos?.[0] : null,
          delivery_longitude: orderType === 'delivery' ? markerPos?.[1] : null,
          delivery_speed: orderType === 'delivery' ? deliverySpeed : 'standard',
          rider_tip: riderTipAmount,
          customer_phone: '0000000000',
          payment_method: paymentMethod,
          notes: orderNotes || null,
        })
        return { type: 'group_order' as const, groupId: response.group_order.id }
      }

      const response = await post<{ order: { id: number; order_number: string } }>('/tourist/food/order', {
        business_id: businessId,
        items: items.map((item) => ({ offering_id: item.id, quantity: item.quantity, notes: item.notes || null })),
        order_type: orderType,
        delivery_address: orderType === 'delivery' ? fullAddress : null,
        delivery_latitude: orderType === 'delivery' ? markerPos?.[0] : null,
        delivery_longitude: orderType === 'delivery' ? markerPos?.[1] : null,
        delivery_speed: orderType === 'delivery' ? deliverySpeed : 'standard',
        rider_tip: riderTipAmount,
        customer_phone: '0000000000',
        payment_method: paymentMethod,
        notes: orderNotes || null,
      })
      return { type: 'order' as const, orderId: response.order.id }
    },
    onSuccess: (data) => {
      clearCart()
      if (paymentMethod === 'cash') {
        if (data.type === 'group_order' && data.groupId) {
          navigate(`/tourist/food/group-order/${data.groupId}`)
        } else if (data.type === 'order' && data.orderId) {
          navigate(`/tourist/food/order/${data.orderId}/status`)
        } else {
          navigate('/tourist/food')
        }
      } else if (data.type === 'group_order' && data.groupId) {
        checkoutPaymentMutation.mutate({ type: 'group_order', id: data.groupId })
      } else if (data.type === 'order' && data.orderId) {
        checkoutPaymentMutation.mutate({ type: 'order', id: data.orderId })
      } else {
        navigate('/tourist/food')
      }
    },
    onError: (error: any) => {
      console.error('Order checkout failed:', error)
      if (error?.response?.status === 401) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      const errors = error?.response?.data?.errors
      const msg = errors
        ? Object.values(errors).flat().join('. ')
        : error?.response?.data?.message || 'Failed to place order. Please try again.'
      setOrderError(msg)
    },
  })

  const checkoutPaymentMutation = useMutation({
    mutationFn: async (payload: { type: 'order' | 'group_order'; id: number }) => {
      return createCheckoutSession(payload.type, payload.id, 'gcash')
    },
    onSuccess: (data) => {
      if (data?.checkout_url) {
        window.location.href = data.checkout_url
      } else {
        setOrderError('Failed to get payment URL. Please try again.')
      }
    },
    onError: (error: any) => {
      console.error('Payment session failed:', error)
      setOrderError(error?.response?.data?.message || 'Failed to initialize payment. Please try again.')
    },
  })

  const canCheckout = cart.length > 0
    && (orderType === 'pickup' || (deliveryAddress.trim().length > 0 && markerPos !== null))
    && (orderType !== 'delivery' || deliverySpeed !== 'fast' || (riderTipAmount >= 20 && riderTipAmount <= 100))
    && !hasClosedRestaurant

  return (
    <div>
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#17201B] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B] mb-2">Your Cart</h1>
      <p className="text-sm text-[#6B7280] mb-8">{cart.length} item{cart.length !== 1 ? 's' : ''} in cart</p>

      {cart.length === 0 ? (
        <div className="bg-white border border-[#E5E9E7] rounded-2xl p-12 text-center">
          <ShoppingCart className="w-12 h-12 text-[#6B7280]/30 mx-auto mb-4" />
          <p className="text-[#6B7280] mb-4">Your cart is empty.</p>
          <button onClick={() => navigate('/tourist/food')} className="bg-[#087F3F] hover:bg-[#056B35] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            Browse Food
          </button>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left: Cart + Form */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* Business Info */}
            <div className="bg-white border border-[#E5E9E7] rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-[#087F3F]/10 rounded-xl flex items-center justify-center">
                <Store className="w-5 h-5 text-[#087F3F]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#17201B]">{businessName}</p>
                <p className="text-xs text-[#6B7280]">{isMultiBusinessCart ? `Group checkout — ${distinctBusinessIds.length} restaurants in one order` : 'Single-business cart'}</p>
              </div>
              <button onClick={clearCart} className="ml-auto text-xs text-red-500 hover:text-red-600 font-medium">
                Clear Cart
              </button>
            </div>

            {isMultiBusinessCart && (
              <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Group checkout enabled. Your items from {distinctBusinessIds.length} restaurants will be delivered separately, each with its own delivery fee and rider, but paid for in one checkout.</span>
              </div>
            )}

            {hasClosedRestaurant && (
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">One restaurant in your cart is currently closed.</p>
                  <p className="mt-1">{closedBusinessIds.map((id) => restaurantStatus[id]?.business_name || `Restaurant #${id}`).join(', ')} is closed. Please remove its items before continuing.</p>
                </div>
              </div>
            )}

            {/* Cart Items */}
            <div className="space-y-3">
              {cart.map((item) => (
                <div key={item.id} className="bg-white border border-[#E5E9E7] rounded-2xl p-4 flex items-center gap-4">
                  {item.image ? (
                    <img src={toAssetUrl(item.image)} alt={item.name} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-16 h-16 bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] rounded-xl shrink-0 flex items-center justify-center">
                      <UtensilsCrossed className="w-6 h-6 text-[#087F3F]/40" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-[#17201B] truncate">{item.name}</h3>
                    <p className="text-xs text-[#6B7280]">{item.business_name}</p>
                    <p className="text-sm font-semibold text-[#087F3F] mt-1">{formatCurrency(item.price)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateQuantity(item.id, -1)} className="w-7 h-7 rounded-lg bg-[#E5E9E7] text-[#17201B] flex items-center justify-center hover:bg-[#d1d5db] transition">
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="text-sm font-medium text-[#17201B] w-6 text-center">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, 1)} className="w-7 h-7 rounded-lg bg-[#E5E9E7] text-[#17201B] flex items-center justify-center hover:bg-[#d1d5db] transition">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <button onClick={() => removeItem(item.id)} className="p-1.5 rounded-lg text-[#6B7280] hover:text-red-500 hover:bg-red-50 transition">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Order Type */}
            <div className="bg-white border border-[#E5E9E7] rounded-2xl p-5">
              <p className="text-sm font-medium text-[#17201B] mb-3">Order Type</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setOrderType('delivery')}
                  className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition text-sm font-medium ${
                    orderType === 'delivery'
                      ? 'border-[#087F3F] bg-[#087F3F]/5 text-[#087F3F]'
                      : 'border-[#E5E9E7] bg-white text-[#6B7280] hover:border-[#087F3F]/40'
                  }`}
                >
                  <MapPin className="w-4 h-4" />
                  Delivery
                </button>
                <button
                  onClick={() => setOrderType('pickup')}
                  className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition text-sm font-medium ${
                    orderType === 'pickup'
                      ? 'border-[#087F3F] bg-[#087F3F]/5 text-[#087F3F]'
                      : 'border-[#E5E9E7] bg-white text-[#6B7280] hover:border-[#087F3F]/40'
                  }`}
                >
                  <Store className="w-4 h-4" />
                  Pickup
                </button>
              </div>
            </div>

            {orderType === 'delivery' && (
              <div className="bg-white border border-[#E5E9E7] rounded-2xl p-5">
                <p className="text-sm font-medium text-[#17201B] mb-3">Delivery Speed</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => { setDeliverySpeed('standard'); setRiderTip('') }}
                    className={`p-3 rounded-xl border-2 text-left transition ${
                      deliverySpeed === 'standard'
                        ? 'border-[#087F3F] bg-[#087F3F]/5'
                        : 'border-[#E5E9E7] hover:border-[#087F3F]/40'
                    }`}
                  >
                    <p className="text-sm font-semibold text-[#17201B]">Standard Delivery</p>
                    <p className="text-xs text-[#6B7280] mt-1">Regular delivery with no rider tip required</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliverySpeed('fast')}
                    className={`p-3 rounded-xl border-2 text-left transition ${
                      deliverySpeed === 'fast'
                        ? 'border-[#F4B400] bg-[#F4B400]/10'
                        : 'border-[#E5E9E7] hover:border-[#F4B400]/50'
                    }`}
                  >
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-[#17201B]">
                      <Zap className="w-4 h-4 text-[#F4B400]" /> Fast Delivery
                    </p>
                    <p className="text-xs text-[#6B7280] mt-1">Priority delivery with a ₱25 / ₱50 / ₱100 rider tip</p>
                  </button>
                </div>
                {deliverySpeed === 'fast' && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-[#17201B] mb-2">
                      Priority tip <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { value: '25', label: '₱25', sub: 'Priority' },
                        { value: '50', label: '₱50', sub: 'Higher priority' },
                        { value: '100', label: '₱100', sub: 'Fastest' },
                      ].map((tier) => (
                        <button
                          key={tier.value}
                          type="button"
                          onClick={() => setRiderTip(tier.value)}
                          className={`p-2.5 rounded-xl border-2 text-center transition ${
                            riderTip === tier.value
                              ? 'border-[#F4B400] bg-[#F4B400]/10'
                              : 'border-[#E5E9E7] hover:border-[#F4B400]/50'
                          }`}
                        >
                          <p className="text-sm font-semibold text-[#17201B]">{tier.label}</p>
                          <p className="text-[11px] text-[#6B7280] mt-0.5">{tier.sub}</p>
                        </button>
                      ))}
                    </div>
                    {riderTip === '' && (
                      <p className="text-xs text-red-600 mt-1.5">Select a priority tip to continue.</p>
                    )}
                    <p className="text-[11px] text-[#9CA3AF] mt-1.5">
                      Added to your total and given to the rider. Higher tips get higher rider-matching priority, and may reduce preparation time if the restaurant offers priority preparation.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Order Notes */}
            <div className="bg-white border border-[#E5E9E7] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <StickyNote className="w-4 h-4 text-[#6B7280]" />
                <p className="text-sm font-medium text-[#17201B]">Order Notes</p>
                <span className="text-xs text-[#6B7280]">(optional)</span>
              </div>
              <textarea
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="Special instructions, allergies, etc."
                className="w-full px-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#6B7280] focus:ring-2 focus:ring-[#087F3F]/40 focus:border-[#087F3F] outline-none transition resize-none"
                rows={2}
              />
            </div>
          </div>

          {/* Right: Map + Address + Summary */}
          <div className="w-full lg:w-[400px] shrink-0 space-y-4">
            <div className={`bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden ${orderType !== 'delivery' ? 'hidden' : ''}`}>
              {/* Map */}
              <div className="h-72 relative">
                <MapContainer center={mapCenter} zoom={16} className="w-full h-full" zoomControl={false} attributionControl={false}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <MapCenterUpdater center={mapCenter} />
                  <MapClickHandler onClick={handleMapClick} />
                  {markerPos && <Marker position={markerPos} icon={userPinIcon} />}
                </MapContainer>

                {/* Use My Location button */}
                <button
                  onClick={useMyLocation}
                  disabled={isLocating}
                  className="absolute bottom-3 right-3 z-[1000] flex items-center gap-2 px-3 py-2 bg-white/95 backdrop-blur-sm border border-[#E5E9E7] rounded-xl shadow-lg hover:bg-[#E9F7EF] transition disabled:opacity-50"
                  title="Use my current location"
                >
                  <LocateFixed className={`w-4 h-4 ${isLocating ? 'text-[#6B7280] animate-pulse' : 'text-[#087F3F]'}`} />
                  <span className="text-xs font-medium text-[#17201B]">{isLocating ? 'Locating...' : 'My Location'}</span>
                </button>

                {/* Map tap hint */}
                {!markerPos && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] px-3 py-1.5 bg-white/90 backdrop-blur-sm border border-[#E5E9E7] rounded-full shadow-sm">
                    <p className="text-[11px] text-[#6B7280] font-medium">Tap the map to set delivery point</p>
                  </div>
                )}
              </div>

              {/* Search + Address */}
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <MapPin className="w-4 h-4 text-[#087F3F]" />
                  <p className="text-sm font-medium text-[#17201B]">Delivery Address</p>
                  <span className="text-xs text-red-500">*Required</span>
                </div>

                {/* Search Bar */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && searchAddress()}
                      placeholder="Search address..."
                      className="w-full pl-9 pr-8 py-2.5 bg-[#F8FAF9] border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#6B7280] focus:ring-2 focus:ring-[#087F3F]/40 focus:border-[#087F3F] outline-none transition"
                    />
                    {searchQuery && (
                      <button onClick={() => { setSearchQuery(''); setDeliveryAddress(''); setMarkerPos(null) }} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[#E5E9E7] transition">
                        <X className="w-3.5 h-3.5 text-[#6B7280]" />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={searchAddress}
                    disabled={isSearching}
                    className="px-4 py-2.5 bg-[#087F3F] hover:bg-[#056B35] text-white text-sm font-medium rounded-xl transition disabled:opacity-50"
                  >
                    {isSearching ? '...' : 'Search'}
                  </button>
                </div>

                {/* Address Display */}
                <textarea
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="Tap the map or search to set your delivery address..."
                  className="w-full px-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#6B7280] focus:ring-2 focus:ring-[#087F3F]/40 focus:border-[#087F3F] outline-none transition resize-none"
                  rows={2}
                />

                {/* Landmark / Description */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-[#6B7280]" />
                    <p className="text-sm font-medium text-[#17201B]">Landmark / Description</p>
                    <span className="text-xs text-[#6B7280]">(optional)</span>
                  </div>
                  <input
                    type="text"
                    value={landmark}
                    onChange={(e) => setLandmark(e.target.value)}
                    placeholder="e.g. Blue gate, near 7-Eleven, 2nd floor above bakery..."
                    className="w-full px-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#6B7280] focus:ring-2 focus:ring-[#087F3F]/40 focus:border-[#087F3F] outline-none transition"
                  />
                  <p className="text-[11px] text-[#9CA3AF] mt-1.5">Add nearby landmarks to help the rider find you easily</p>
                </div>
              </div>
            </div>

            {/* Order Summary */}
            <div className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden">
              {/* Header */}
              <div className="px-5 pt-5 pb-4">
                <p className="text-xs text-[#6B7280] mb-1">{user?.name}</p>
                <h2 className="text-lg font-bold text-[#17201B]">Complete Your Order</h2>
              </div>

              {/* Items */}
              <div className="px-5 space-y-3 pb-4">
                {cart.map((item) => {
                  const initial = item.name.charAt(0).toUpperCase()
                  const colors: Record<string, string> = {
                    S: 'bg-emerald-500', F: 'bg-blue-500', B: 'bg-amber-500',
                    P: 'bg-purple-500', A: 'bg-red-500', L: 'bg-pink-500',
                    T: 'bg-teal-500', C: 'bg-orange-500', D: 'bg-indigo-500',
                    K: 'bg-cyan-500', H: 'bg-rose-500', M: 'bg-violet-500',
                  }
                  const colorClass = colors[initial] || 'bg-gray-500'
                  return (
                    <div key={item.id} className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full ${colorClass} flex items-center justify-center shrink-0`}>
                        <span className="text-sm font-bold text-white">{initial}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#17201B] truncate">{item.name}</p>
                        <p className="text-xs text-[#6B7280]">Quantity: {item.quantity}</p>
                      </div>
                      <span className="text-sm font-semibold text-[#17201B] whitespace-nowrap">{formatCurrency(item.price * item.quantity)}</span>
                    </div>
                  )
                })}
              </div>

              {/* Pricing Breakdown */}
              <div className="mx-5 border-t border-[#E5E9E7] pt-4 space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Subtotal</span>
                  <span className="text-[#17201B] font-medium">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Delivery</span>
                  <span className="text-[#087F3F] font-medium">
                    {orderType === 'delivery'
                      ? isMultiBusinessCart
                        ? groupFeesReady
                          ? formatCurrency(groupDeliveryFee)
                          : 'Calculating...'
                        : feeData
                          ? formatCurrency(deliveryFee)
                          : 'Calculating...'
                      : 'Free'}
                  </span>
                </div>
                {isMultiBusinessCart ? (
                  <div className="rounded-lg bg-[#F8FAF9] px-3 py-2 text-xs text-[#567064]">
                    <div className="flex justify-between font-medium">
                      <span>Shared delivery</span>
                      <span>1 rider</span>
                    </div>
                    <p className="mt-1">Restaurants prepare their own items for one shared pickup route.</p>
                  </div>
                ) : orderType === 'delivery' && feeData && (
                  <>
                    <div className="flex justify-between text-xs text-[#6B7280]">
                      <span>Estimated delivery distance</span>
                      <span>{feeData.distance_km.toFixed(2)} km</span>
                    </div>
                    <div className="flex justify-between text-xs text-[#6B7280]">
                      <span>Base fare + distance</span>
                      <span>{formatCurrency(feeData.base_fare)} + {formatCurrency(feeData.distance_charge)}</span>
                    </div>
                  </>
                )}
                {orderType === 'delivery' && (
                  <div className="rounded-lg bg-[#F3F8F5] px-3 py-2 text-[11px] leading-relaxed text-[#567064]">
                    <span className="font-semibold text-[#087F3F]">How delivery is calculated:</span>{' '}
                    ₱40 covers the first 2 km, then ₱15 is added for every kilometer beyond 2 km.
                    {isMultiBusinessCart && ' All restaurants share one delivery and one rider. Restaurant items are fulfilled separately before the shared pickup route.'}
                  </div>
                )}
                {orderType === 'delivery' && deliverySpeed === 'fast' && riderTipAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#6B728D]">Rider tip</span>
                    <span className="text-[#087F3F] font-medium">{formatCurrency(riderTipAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-3 border-t border-[#E5E9E7]">
                  <span className="text-base font-bold text-[#17201B]">Total Due</span>
                  <span className="text-base font-bold text-[#17201B]">
                    {isMultiBusinessCart && !groupFeesReady ? 'Calculating...' : formatCurrency(total)}
                  </span>
                </div>
              </div>

              {/* Payment Method */}
              <div className="mx-5 mt-4 mb-5 space-y-2">
                <p className="text-sm font-semibold text-[#17201B]">Payment Method</p>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('gcash')}
                  className={`w-full p-3 rounded-xl border flex items-center gap-3 text-left transition ${
                    paymentMethod === 'gcash' ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200' : 'bg-white border-[#E5E9E7] hover:border-blue-200'
                  }`}
                >
                  <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
                    <Smartphone className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-blue-700">GCash</p>
                    <p className="text-xs text-[#6B7280]">Pay securely online through GCash</p>
                  </div>
                  <span className={`w-4 h-4 rounded-full border-2 ${paymentMethod === 'gcash' ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`w-full p-3 rounded-xl border flex items-center gap-3 text-left transition ${
                    paymentMethod === 'cash' ? 'bg-[#E9F7EF] border-[#087F3F]/40 ring-1 ring-[#087F3F]/20' : 'bg-white border-[#E5E9E7] hover:border-[#087F3F]/30'
                  }`}
                >
                  <div className="w-9 h-9 bg-[#087F3F] rounded-lg flex items-center justify-center shrink-0">
                    <Banknote className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[#087F3F]">Cash on Delivery</p>
                    <p className="text-xs text-[#6B7280]">Pay the rider in cash when your order arrives</p>
                  </div>
                  <span className={`w-4 h-4 rounded-full border-2 ${paymentMethod === 'cash' ? 'border-[#087F3F] bg-[#087F3F]' : 'border-gray-300'}`} />
                </button>
              </div>
            </div>

            {/* Error */}
            {orderError && (
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{orderError}</span>
              </div>
            )}

            {/* Checkout Button */}
            <button
              onClick={() => {
                if (!user) {
                  setOrderError('Your session has expired. Please log in again.')
                  savePendingAction({
                    type: 'food_order',
                    returnPath: '/tourist/food/cart',
                  })
                  logout()
                  navigate('/login', { replace: true })
                  return
                }
                setShowConfirm(true)
              }}
              disabled={checkoutMutation.isPending || checkoutPaymentMutation.isPending || !canCheckout}
              className="w-full bg-[#087F3F] hover:bg-[#056B35] text-white py-3.5 rounded-xl font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {checkoutPaymentMutation.isPending
                ? 'Redirecting to GCash...'
                : checkoutMutation.isPending
                  ? 'Placing Order...'
                  : paymentMethod === 'cash'
                    ? `Place Cash Order (${isMultiBusinessCart ? 'Group Checkout' : formatCurrency(total)})`
                    : `Pay with GCash (${isMultiBusinessCart ? 'Group Checkout' : formatCurrency(total)})`}
            </button>

            <p className="text-center text-[11px] text-[#9CA3AF]">
              {paymentMethod === 'cash'
                ? 'Please prepare the exact amount, if possible, when your order arrives.'
                : <>By completing your purchase, you agree to PayMongo's{' '}
                  <a href="https://www.paymongo.com/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-[#087F3F] underline hover:text-[#056B35]">
                    Privacy Policy
                  </a>.</>}
            </p>
          </div>
        </div>
      )}

      {/* Confirm Payment Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowConfirm(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
            <div className="w-14 h-14 bg-[#E9F7EF] rounded-full flex items-center justify-center mx-auto">
              <Check className="w-7 h-7 text-[#087F3F]" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-[#17201B]">
                {paymentMethod === 'cash' ? 'Confirm Cash Order' : 'Confirm Proceed to Payment'}
              </h3>
              <p className="text-sm text-[#6B7280] mt-2">
                {paymentMethod === 'cash'
                  ? <>Pay <span className="font-semibold text-[#17201B]">{formatCurrency(total)}</span> in cash {orderType === 'delivery' ? 'when your order is delivered' : 'when you pick up your order'}.</>
                  : isMultiBusinessCart
                    ? <>You will be redirected to GCash to complete a single payment for all {distinctBusinessIds.length} restaurants. Final amount is calculated at checkout.</>
                    : <>You will be redirected to GCash to complete your payment of <span className="font-semibold text-[#17201B]">{formatCurrency(total)}</span>.</>}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#E5E9E7] text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowConfirm(false); checkoutMutation.mutate(cart) }}
                disabled={checkoutMutation.isPending}
                className="flex-1 py-2.5 rounded-xl bg-[#087F3F] hover:bg-[#056B35] text-white text-sm font-semibold transition disabled:opacity-50"
              >
                {checkoutMutation.isPending ? 'Processing...' : paymentMethod === 'cash' ? 'Place Order' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
