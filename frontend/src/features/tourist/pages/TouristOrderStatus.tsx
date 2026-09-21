import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime, toAssetUrl } from '@/shared/utils'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import {
  Package,
  CheckCircle2,
  UserCheck,
  Truck,
  MapPin,
  Star,
  Phone,
  XCircle,
  Clock,
  ArrowLeft,
  Store,
  ClipboardList,
  Hourglass,
} from 'lucide-react'
import { resolveSubOrderStatus } from '../utils/subOrderStatusEngine'
import { OrderProgressTrack } from '../components/OrderProgressTrack'
import { useCustomerMapSocket } from '@/shared/hooks/useCustomerMapSocket'
import { useUserSocketNotifier } from '@/shared/hooks/useUserSocketNotifier'

interface OrderData {
  id: number
  order_number: string
  status: string
  order_type: string
  subtotal: number
  delivery_fee: number
  system_fee: number
  rider_financed_amount: number
  rider_delivery_earnings: number
  total: number
  paid_amount: number
  payment_method: string
  payment_status: string
  notes: string | null
  delivery_address: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  business?: {
    id: number
    name: string
    address?: string
    latitude?: number
    longitude?: number
  }
  items?: Array<{
    product_name: string
    quantity: number
    unit_price: number
    subtotal: number
    offering?: { image?: string; images?: string[] }
  }>
  delivery?: {
    id: number
    status: string
    dispatch_status?: string | null
    pickup_address: string
    delivery_address: string
    pickup_latitude?: number | string
    pickup_longitude?: number | string
    delivery_latitude?: number | string
    delivery_longitude?: number | string
    assigned_at: string | null
    picked_up_at: string | null
    delivered_at: string | null
    rider?: {
      id: number
      name: string
      phone?: string
      profile?: { photo?: string }
    }
  }
}

interface OrderStatusResponse {
  order: OrderData
  delivery: OrderData['delivery'] | null
  rider_location?: {
    latitude: number
    longitude: number
    recorded_at?: string
  } | null
  tracking?: {
    delivery_id: number
    room: string
    token: string
    role: string
  } | null
}

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Awaiting Payment',
  waiting_restaurant: 'Waiting for Restaurant',
  accepted: 'Order Accepted',
  preparing: 'Being Prepared',
  ready: 'Ready for Pickup',
  picked_up: 'Picked Up',
  on_the_way: 'On the Way',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  completed: 'Completed',
  rejected: 'Order Cancelled',
  cancelled_by_tourist: 'Cancelled by You',
  cancelled: 'Order Cancelled',
}

const COD_STATUS_LABELS: Record<string, string> = {
  waiting_restaurant: 'Waiting for Rider',
  accepted: 'Restaurant Accepted',
  preparing: 'Being Prepared',
  ready: 'Ready for Pickup',
  picked_up: 'Picked Up',
  on_the_way: 'On the Way',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  completed: 'Completed',
}

const riderArrowSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.4"/>
  </filter>
  <g filter="url(#shadow)">
    <circle cx="22" cy="22" r="18" fill="#087F3F" stroke="#ffffff" stroke-width="3"/>
    <path d="M 22 10 L 30 29 L 22 24 L 14 29 Z" fill="#ffffff"/>
  </g>
</svg>
`.trim()

const motorcycleIcon = L.icon({
  iconUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(riderArrowSvg)}`,
  iconSize: [44, 44],
  iconAnchor: [22, 22],
  popupAnchor: [0, -22],
})

const pickupIcon = L.divIcon({
  className: 'custom-pickup-marker',
  html: `
    <div style="
      width: 36px;
      height: 36px;
      background: #D97706;
      border: 2px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 3px 10px rgba(217, 119, 6, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
})

const deliveryDestIcon = L.divIcon({
  className: 'custom-delivery-marker',
  html: `
    <div style="
      width: 36px;
      height: 36px;
      background: #DC2626;
      border: 2px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 3px 10px rgba(220, 38, 38, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 19 21 12 17 5 21 12 2"/>
      </svg>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
})

function num(v: number | string | null | undefined): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n : null
}

function LiveTrackingMap({ delivery, riderLocation }: {
  delivery: OrderData['delivery']
  riderLocation: OrderStatusResponse['rider_location']
}) {
  const pickup = delivery && num(delivery.pickup_latitude) != null && num(delivery.pickup_longitude) != null
    ? [num(delivery.pickup_latitude)!, num(delivery.pickup_longitude)!] as [number, number]
    : null
  const destination = delivery && num(delivery.delivery_latitude) != null && num(delivery.delivery_longitude) != null
    ? [num(delivery.delivery_latitude)!, num(delivery.delivery_longitude)!] as [number, number]
    : null
  const rider = riderLocation && num(riderLocation.latitude) != null && num(riderLocation.longitude) != null
    ? [num(riderLocation.latitude)!, num(riderLocation.longitude)!] as [number, number]
    : null

  const anchor = rider ?? pickup ?? destination ?? [12.8667, 121.45]

  function RecenterMap() {
    const map = useMap()
    useEffect(() => {
      map.setView(anchor, 14)
    }, [map])
    return null
  }

  return (
    <div className="h-64 w-full overflow-hidden rounded-xl border border-[#E5E9E7]">
      <MapContainer
        center={anchor}
        zoom={14}
        minZoom={2}
        className="h-full w-full"
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <RecenterMap />
        {pickup && (
          <Marker position={pickup} icon={pickupIcon}>
            <Popup>Pickup · {delivery?.pickup_address || 'Restaurant'}</Popup>
          </Marker>
        )}
        {destination && (
          <Marker position={destination} icon={deliveryDestIcon}>
            <Popup>Delivery · {delivery?.delivery_address || 'Your location'}</Popup>
          </Marker>
        )}
        {rider && (
          <Marker position={rider} icon={motorcycleIcon}>
            <Popup>Your rider</Popup>
          </Marker>
        )}
        {rider && destination && (
          <Polyline
            positions={[rider, destination]}
            pathOptions={{ color: '#087F3F', weight: 5, opacity: 0.9, dashArray: '1 8' }}
          />
        )}
      </MapContainer>
    </div>
  )
}

export default function TouristOrderStatus() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [showRatingModal, setShowRatingModal] = useState(false)
  const [rating, setRating] = useState(5)
  const [foodRating, setFoodRating] = useState(5)
  const [serviceRating, setServiceRating] = useState(5)
  const [deliveryRating, setDeliveryRating] = useState(5)
  const [review, setReview] = useState('')

  const { data: response, isLoading, isError } = useQuery<OrderStatusResponse>({
    queryKey: ['tourist', 'order-status', id],
    queryFn: async () => {
      const data = await get<OrderStatusResponse>(`/tourist/food/order/${id}/status`)
      if (!data || !data.order) {
        throw new Error('Order status response is missing order data.')
      }
      return data
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.order?.status
      if (status && !['delivered', 'completed', 'rejected', 'cancelled', 'cancelled_by_tourist'].includes(status)) {
        return 10000
      }
      return false
    },
  })

  const order = response?.order
  const delivery = response?.delivery ?? order?.delivery

  // Derived dispatch/tracking state is computed before any early return so the
  // authorized live-tracking socket hook stays in the same call order.
  const isCancelled = order != null && ['rejected', 'cancelled', 'cancelled_by_tourist'].includes(order.status)
  const isActive = order != null && !['delivered', 'completed', 'rejected', 'cancelled', 'cancelled_by_tourist', 'pending_payment'].includes(order.status)
  const canCancel = order?.status === 'waiting_restaurant'
  const isCod = (order?.payment_method || 'cash') === 'cash'
  const restaurantName = order?.business?.name ?? 'the restaurant'
  const rider = delivery?.rider ?? null
  const deliveryStatus = delivery?.status ?? null
  const hasRider = !!rider || (deliveryStatus != null && ['assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'en_route_destination', 'arrived_destination'].includes(deliveryStatus))

  // Authorized live tracking (socket-primary, HTTP-poll fallback).
  const trackingBlock = response?.tracking ?? null
  const trackingDeliveryId =
    isActive && hasRider && trackingBlock?.delivery_id != null ? String(trackingBlock.delivery_id) : null
  const { connection, telemetry, tripCompleted, tripCancelled, rejectedReason, isStale } = useCustomerMapSocket({
    deliveryId: trackingDeliveryId,
    token: trackingBlock?.token ?? null,
    enabled: !!trackingDeliveryId,
  })

  // P11.5 — realtime order/delivery status events; each event immediately
  // re-fetches the authoritative order status (HTTP remains the fallback and
  // the source of truth).
  useUserSocketNotifier({
    onStatusEvent: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['tourist', 'order-status', id] })
    }, [queryClient, id]),
  })

  const trackingLocation =
    telemetry && Number.isFinite(telemetry.lat) && Number.isFinite(telemetry.lng)
      ? { latitude: telemetry.lat, longitude: telemetry.lng, recorded_at: new Date(telemetry.timestamp).toISOString() }
      : (response?.rider_location ?? null)

  const liveStatus = (() => {
    if (tripCancelled) return { text: 'Delivery Cancelled', className: 'text-red-600 bg-red-50', dot: 'bg-red-500', pulse: false }
    if (tripCompleted) return { text: 'Delivered', className: 'text-[#6B7280] bg-[#F3F4F6]', dot: 'bg-[#9CA3AF]', pulse: false }
    if (connection === 'closed') {
      return rejectedReason
        ? { text: 'Track Unavailable', className: 'text-red-600 bg-red-50', dot: 'bg-red-500', pulse: false }
        : { text: 'Offline', className: 'text-[#6B7280] bg-[#F3F4F6]', dot: 'bg-[#9CA3AF]', pulse: false }
    }
    if (connection === 'connected' && !isStale) return { text: 'Live', className: 'text-[#087F3F] bg-[#E9F7EF]', dot: 'bg-[#087F3F]', pulse: true }
    if (connection === 'connected') return { text: 'Waiting for signal…', className: 'text-[#D97706] bg-amber-50', dot: 'bg-[#D97706]', pulse: true }
    if (connection === 'reconnecting') return { text: 'Reconnecting…', className: 'text-[#D97706] bg-amber-50', dot: 'bg-[#D97706]', pulse: true }
    return { text: 'Connecting…', className: 'text-[#6B7280] bg-[#F3F4F6]', dot: 'bg-[#9CA3AF]', pulse: true }
  })()

  const cancelMutation = useMutation({
    mutationFn: () => post(`/tourist/food/order/${id}/cancel`, { reason: cancelReason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tourist', 'order-status', id] })
      setShowCancelModal(false)
      setCancelReason('')
    },
  })

  const rateMutation = useMutation({
    mutationFn: () => post(`/tourist/food/order/${id}/rate`, {
      rating,
      food_rating: foodRating,
      service_rating: serviceRating,
      delivery_rating: deliveryRating,
      review,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tourist', 'order-status', id] })
      setShowRatingModal(false)
      setRating(5)
      setFoodRating(5)
      setServiceRating(5)
      setDeliveryRating(5)
      setReview('')
    },
  })

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <DashboardSkeleton />
      </div>
    )
  }

  if (isError || !order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Package className="w-16 h-16 text-[#6B7280]/30 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-[#17201B] mb-2">Order not found</h2>
          <p className="text-[#6B7280] mb-6">Unable to load order details.</p>
          <Link
            to="/tourist/food"
            className="px-6 py-3 bg-[#087F3F] text-white rounded-xl hover:bg-[#056B35] transition-colors font-medium"
          >
            Back to Food
          </Link>
        </div>
      </div>
    )
  }

  const resolution = resolveSubOrderStatus({
    orderStatus: order.status,
    deliveryStatus: delivery?.status,
    dispatchStatus: delivery?.dispatch_status,
    riderName: rider?.name || null,
    subOrderTotal: order.total,
    paymentMethod: order.payment_method || 'cash',
  })

  // Determine the status label - use COD-specific labels for COD orders
  const statusLabel = isCod
    ? (COD_STATUS_LABELS[order.status] || STATUS_LABELS[order.status] || order.status?.replace(/_/g, ' '))
    : (STATUS_LABELS[order.status] || order.status?.replace(/_/g, ' '))

  return (
    <div>
      <div className="max-w-4xl mx-auto py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 text-[#6B7280] hover:text-[#087F3F] text-sm mb-2 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Order Status</h1>
            <p className="text-[#6B7280] text-sm mt-1">Order #{order.order_number}</p>
          </div>
          <div className={`px-4 py-2 rounded-xl text-sm font-semibold ${
            ['delivered', 'completed'].includes(order.status)
              ? 'bg-[#087F3F]/10 text-[#087F3F] border border-[#087F3F]/20'
              : isCancelled
              ? 'bg-red-50 text-red-600 border border-red-200'
              : 'bg-[#F4B400]/10 text-[#F4B400] border border-[#F4B400]/20'
          }`}>
            {statusLabel}
          </div>
        </div>

        {/* Status Message Banner */}
        {/* COD: Waiting for Rider */}
        {order.status === 'waiting_restaurant' && isCod && !hasRider && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 mb-6 flex items-start gap-4">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
              <Hourglass className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-blue-800">Order Placed</h3>
              <p className="text-sm text-blue-700 mt-1">
                Your COD order has been placed. We're finding a nearby eligible rider to secure and deliver your order.
              </p>
            </div>
          </div>
        )}

        {/* COD: Rider Assigned, Waiting for Restaurant */}
        {order.status === 'waiting_restaurant' && isCod && hasRider && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-6 flex items-start gap-4">
            <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-semibold text-emerald-800">Rider Assigned</h3>
              <p className="text-sm text-emerald-700 mt-1">
                Your order is financially secured and has been sent to <span className="font-semibold">{restaurantName}</span>.
              </p>
            </div>
          </div>
        )}

        {/* Non-COD: Payment Successful */}
        {order.status === 'waiting_restaurant' && !isCod && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 mb-6 flex items-start gap-4">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
              <Hourglass className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-blue-800">Payment Successful</h3>
              <p className="text-sm text-blue-700 mt-1">
                Your payment has been processed. Waiting for <span className="font-semibold">{restaurantName}</span> to accept your order.
              </p>
            </div>
          </div>
        )}

        {/* Restaurant Accepted */}
        {order.status === 'accepted' && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-6 flex items-start gap-4">
            <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-semibold text-emerald-800">
                {isCod ? 'Restaurant Accepted' : 'Order Accepted!'}
              </h3>
              <p className="text-sm text-emerald-700 mt-1">
                <span className="font-semibold">{restaurantName}</span> has accepted your order and is preparing it.
              </p>
            </div>
          </div>
        )}

        {isCancelled && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-6 flex items-start gap-4">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center shrink-0">
              <XCircle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h3 className="font-semibold text-red-800">
                Order Cancelled
              </h3>
              <p className="text-sm text-red-700 mt-1">
                {order.status === 'rejected'
                  ? `The restaurant couldn't accept your order. Your payment will be released/refunded according to the payment method.`
                  : `You have cancelled this order.${order.cancellation_reason ? ` Reason: ${order.cancellation_reason}` : ''}`
                }
              </p>
              {order.cancellation_reason && order.status === 'rejected' && (
                <p className="text-xs text-red-600 mt-2">Reason: {order.cancellation_reason}</p>
              )}
            </div>
          </div>
        )}

        {/* 5-Step Progress Track (Sub-Status Message Matrix) */}
        <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 mb-6">
          <OrderProgressTrack resolution={resolution} />
        </div>

        {/* Live Tracking Map (when rider assigned and active) */}
        {rider && isActive && !tripCancelled && (
          <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-[#087F3F]" />
                <h2 className="text-lg font-semibold text-[#17201B]">Live Tracking</h2>
              </div>
              <span className={`flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-full ${liveStatus.className}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${liveStatus.dot} ${liveStatus.pulse ? 'animate-pulse' : ''}`} />
                {liveStatus.text}
              </span>
            </div>
            <p className="text-sm text-[#6B7280] mb-3">
              {['on_the_way', 'out_for_delivery'].includes(order.status)
                ? `${rider.name} is on the way to you`
                : `${rider.name} is heading to ${restaurantName}`}
            </p>
            <LiveTrackingMap delivery={delivery} riderLocation={trackingLocation} />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Order Details */}
          <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Store className="w-5 h-5 text-[#087F3F]" />
              <h2 className="text-lg font-semibold text-[#17201B]">{restaurantName}</h2>
            </div>

            {/* Order Items */}
            <div className="space-y-3 mb-6">
              {order.items?.map((item, index) => (
                <div key={index} className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-xl overflow-hidden bg-[#E9F7EF] flex items-center justify-center shrink-0">
                  {(item.offering?.image || item.offering?.images?.[0]) ? (
                    <img
                      src={toAssetUrl(item.offering.image || item.offering.images?.[0])}
                      alt={item.product_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ClipboardList className="w-6 h-6 text-[#087F3F]/50" />
                  )}
                </div>
                  <div className="flex-1">
                    <p className="text-sm text-[#17201B]">{item.product_name}</p>
                    <p className="text-xs text-[#6B7280]">Qty: {item.quantity}</p>
                  </div>
                  <span className="text-sm font-medium text-[#17201B]">{formatCurrency(item.unit_price * item.quantity)}</span>
                </div>
              ))}
            </div>

            {/* Order Totals */}
            <div className="border-t border-[#E5E9E7] pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#6B7280]">Subtotal</span>
                <span className="text-[#17201B]">{formatCurrency(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#6B7280]">Delivery Fee</span>
                <span className="text-[#17201B]">{formatCurrency(order.delivery_fee)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold pt-2 border-t border-[#E5E9E7]">
                <span className="text-[#17201B]">{isCod ? 'Total COD' : 'Total'}</span>
                <span className="text-[#087F3F]">{formatCurrency(order.total)}</span>
              </div>
            </div>

            {/* Payment Info */}
            <div className="mt-4 pt-4 border-t border-[#E5E9E7]">
              <div className="flex justify-between text-sm">
                <span className="text-[#6B7280]">Payment</span>
                <span className="text-[#17201B] capitalize">{isCod ? 'Cash on Delivery' : order.payment_method?.replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-[#6B7280]">Payment Status</span>
                <span className={
                  isCod
                    ? (hasRider ? 'text-blue-600 font-medium' : 'text-[#F4B400] font-medium')
                    : order.payment_status === 'paid' ? 'text-[#087F3F] font-medium' :
                      order.payment_status === 'authorized' ? 'text-blue-600 font-medium' :
                      order.payment_status === 'refunded' ? 'text-[#F4B400] font-medium' :
                      'text-[#F4B400] font-medium'
                }>
                  {isCod
                    ? (['delivered', 'completed'].includes(order.status) ? 'Collected' : 'Pending (Pay on Delivery)')
                    : order.payment_status === 'authorized' ? 'Authorized (Pending Capture)' :
                      order.payment_status === 'paid' ? 'Paid' :
                      order.payment_status === 'refunded' ? 'Refunded' :
                      order.payment_status
                  }
                </span>
              </div>
            </div>
          </div>

          {/* Delivery Info */}
          <div className="space-y-6">
            {/* Addresses */}
            {order.order_type === 'delivery' && (
              <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-[#17201B] mb-4">Delivery Details</h2>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-[#F4B400]/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Store className="w-4 h-4 text-[#F4B400]" />
                    </div>
                    <div>
                      <p className="text-xs text-[#6B7280] mb-0.5">Pickup</p>
                      <p className="text-sm text-[#17201B]">{delivery?.pickup_address || order.business?.address || 'Restaurant'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-[#087F3F]/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <MapPin className="w-4 h-4 text-[#087F3F]" />
                    </div>
                    <div>
                      <p className="text-xs text-[#6B7280] mb-0.5">Delivery</p>
                      <p className="text-sm text-[#17201B]">{delivery?.delivery_address || order.delivery_address}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Rider Info */}
            {rider && (
              <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-[#17201B] mb-4">Delivery Personnel</h2>
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full overflow-hidden bg-[#E5E9E7] border border-[#E5E9E7]">
                    {rider.profile?.photo ? (
                      <img src={rider.profile.photo} alt={rider.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#6B7280]">
                        <UserCheck className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-[#17201B] font-medium">{rider.name}</p>
                  </div>
                  {rider.phone && (
                    <a
                      href={`tel:${rider.phone}`}
                      className="p-3 bg-[#087F3F]/10 border border-[#087F3F]/20 rounded-xl text-[#087F3F] hover:bg-[#087F3F] hover:text-white transition-all"
                    >
                      <Phone className="w-5 h-5" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-[#17201B] mb-4">Timeline</h2>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <Clock className="w-4 h-4 text-[#6B7280]" />
                  <span className="text-[#6B7280]">Ordered:</span>
                  <span className="text-[#17201B]">{formatDateTime(order.created_at)}</span>
                </div>
                {delivery?.delivered_at && (
                  <div className="flex items-center gap-3 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-[#087F3F]" />
                    <span className="text-[#6B7280]">Delivered:</span>
                    <span className="text-[#17201B]">{formatDateTime(delivery.delivered_at)}</span>
                  </div>
                )}
                {order.cancelled_at && (
                  <div className="flex items-center gap-3 text-sm">
                    <XCircle className="w-4 h-4 text-red-500" />
                    <span className="text-[#6B7280]">Cancelled:</span>
                    <span className="text-[#17201B]">{formatDateTime(order.cancelled_at)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          {canCancel && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-red-50 border border-red-200 text-red-600 rounded-xl hover:bg-red-100 transition-all font-medium"
            >
              <XCircle className="w-5 h-5" />
              Cancel Order
            </button>
          )}
          {['delivered', 'completed'].includes(order.status) && (
            <button
              onClick={() => setShowRatingModal(true)}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-[#087F3F] text-white rounded-xl hover:bg-[#056B35] transition-all font-medium"
            >
              <Star className="w-5 h-5" />
              Rate Order
            </button>
          )}
          {['delivered', 'completed'].includes(order.status) && (
            <Link
              to="/tourist/food"
              className="flex items-center justify-center gap-2 px-6 py-3 bg-[#E5E9E7] border border-[#E5E9E7] text-[#17201B] rounded-xl hover:border-[#087F3F]/50 hover:text-[#087F3F] transition-all font-medium"
            >
              <Store className="w-5 h-5" />
              Order Again
            </Link>
          )}
        </div>

        {/* Cancel Modal */}
        {showCancelModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 w-full max-w-md shadow-2xl">
              <h3 className="text-lg font-semibold text-[#17201B] mb-2">Cancel Order</h3>
              <p className="text-sm text-[#6B7280] mb-4">Are you sure you want to cancel this order? Your payment will be refunded.</p>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason for cancellation (optional)"
                className="w-full px-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-[#17201B] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-red-500/50 text-sm resize-none mb-4"
                rows={3}
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="flex-1 py-2.5 bg-[#E5E9E7] border border-[#E5E9E7] text-[#17201B] rounded-xl hover:bg-[#d1d5db] transition-all font-medium"
                >
                  Keep Order
                </button>
                <button
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all font-medium disabled:opacity-50"
                >
                  {cancelMutation.isPending ? 'Cancelling...' : 'Confirm Cancel'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Rating Modal */}
        {showRatingModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold text-[#17201B] mb-2">Rate Your Order</h3>
              <p className="text-sm text-[#6B7280] mb-6">How was your experience with {restaurantName}?</p>

              {/* Overall Rating */}
              <div className="mb-4">
                <p className="text-sm font-medium text-[#17201B] mb-2">Overall Rating</p>
                <div className="flex items-center justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button key={star} onClick={() => setRating(star)} className="transition-transform hover:scale-110">
                      <Star className={`w-8 h-8 ${star <= rating ? 'text-[#F4B400] fill-[#F4B400]' : 'text-[#E5E9E7]'}`} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Food Rating */}
              <div className="mb-4">
                <p className="text-sm font-medium text-[#17201B] mb-2">Food Quality</p>
                <div className="flex items-center justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button key={star} onClick={() => setFoodRating(star)} className="transition-transform hover:scale-110">
                      <Star className={`w-6 h-6 ${star <= foodRating ? 'text-[#F4B400] fill-[#F4B400]' : 'text-[#E5E9E7]'}`} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Service Rating */}
              <div className="mb-4">
                <p className="text-sm font-medium text-[#17201B] mb-2">Service</p>
                <div className="flex items-center justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button key={star} onClick={() => setServiceRating(star)} className="transition-transform hover:scale-110">
                      <Star className={`w-6 h-6 ${star <= serviceRating ? 'text-[#F4B400] fill-[#F4B400]' : 'text-[#E5E9E7]'}`} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Delivery Rating */}
              {rider && (
                <div className="mb-4">
                  <p className="text-sm font-medium text-[#17201B] mb-2">Delivery</p>
                  <div className="flex items-center justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button key={star} onClick={() => setDeliveryRating(star)} className="transition-transform hover:scale-110">
                        <Star className={`w-6 h-6 ${star <= deliveryRating ? 'text-[#F4B400] fill-[#F4B400]' : 'text-[#E5E9E7]'}`} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <textarea
                value={review}
                onChange={(e) => setReview(e.target.value)}
                placeholder="Write a review (optional)"
                className="w-full px-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-[#17201B] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/50 text-sm resize-none mb-4"
                rows={3}
              />

              <div className="flex gap-3">
                <button
                  onClick={() => setShowRatingModal(false)}
                  className="flex-1 py-2.5 bg-[#E5E9E7] border border-[#E5E9E7] text-[#17201B] rounded-xl hover:bg-[#d1d5db] transition-all font-medium"
                >
                  Skip
                </button>
                <button
                  onClick={() => rateMutation.mutate()}
                  disabled={rateMutation.isPending}
                  className="flex-1 py-2.5 bg-[#087F3F] text-white rounded-xl hover:bg-[#056B35] transition-all font-medium disabled:opacity-50"
                >
                  {rateMutation.isPending ? 'Submitting...' : 'Submit Rating'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
