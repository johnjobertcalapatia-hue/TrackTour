import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, put } from '@/shared/services/api'
import { toAssetUrl } from '@/shared/utils'
import { useActiveBusinessId } from '../services/use-active-business-id'
import { ArrowLeft, Save, RotateCcw, Star, Clock, MapPin, Phone, Globe, Utensils, X } from 'lucide-react'

interface BusinessData {
  id: number
  business_name: string
  business_description: string | null
  tagline: string | null
  logo: string | null
  cover_photo: string | null
  welcome_message: string | null
  signature_dishes: string[] | null
  featured_banner: string | null
  featured_video: string | null
  contact_number: string | null
  email: string | null
  website: string | null
  address: string | null
  opening_time: string | null
  closing_time: string | null
  business_days: string[] | null
  price_range: string | null
  average_rating: number
  review_count: number
  is_open: boolean
  category: string
  municipality: string | { id: number; name: string }
}

interface GalleryImage {
  id: number
  file_path: string
  type: string
  title: string | null
  category: string | null
  caption: string | null
  featured: boolean
}

export default function BusinessOwnerRestaurantProfile() {
  const { id: urlId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const businessId = useActiveBusinessId(urlId)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (businessId !== null && urlId !== String(businessId)) {
      navigate(`/business-owner/businesses/${businessId}/restaurant-profile`, { replace: true })
    }
  }, [businessId, urlId, navigate])

  const [welcomeMessage, setWelcomeMessage] = useState('')
  const [signatureDishes, setSignatureDishes] = useState<string[]>([])
  const [newDish, setNewDish] = useState('')
  const [hasChanges, setHasChanges] = useState(false)

  const { data: business, isLoading: loadingBusiness } = useQuery({
    queryKey: ['bo-business', businessId],
    queryFn: () => get<BusinessData>(`/business-owner/businesses/${businessId}`),
    enabled: businessId !== null,
  })

  const { data: gallery } = useQuery({
    queryKey: ['bo-business-gallery', businessId],
    queryFn: () => get<GalleryImage[]>(`/business-owner/businesses/${businessId}/gallery`),
    enabled: businessId !== null,
  })

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => put(`/business-owner/businesses/${businessId}/profile`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business', businessId] })
      setHasChanges(false)
    },
  })

  useEffect(() => {
    if (business) {
      setWelcomeMessage(business.welcome_message || '')
      setSignatureDishes(business.signature_dishes || [])
    }
  }, [business])

  const handleWelcomeChange = (value: string) => {
    setWelcomeMessage(value)
    setHasChanges(true)
  }

  const addDish = () => {
    if (newDish.trim() && !signatureDishes.includes(newDish.trim())) {
      setSignatureDishes([...signatureDishes, newDish.trim()])
      setNewDish('')
      setHasChanges(true)
    }
  }

  const removeDish = (dish: string) => {
    setSignatureDishes(signatureDishes.filter((d) => d !== dish))
    setHasChanges(true)
  }

  const handleSave = () => {
    updateMutation.mutate({
      welcome_message: welcomeMessage || null,
      signature_dishes: signatureDishes.length ? signatureDishes : null,
    })
  }

  const handleReset = () => {
    if (business) {
      setWelcomeMessage(business.welcome_message || '')
      setSignatureDishes(business.signature_dishes || [])
      setHasChanges(false)
    }
  }

  const featuredGallery = gallery?.filter((img) => img.featured) || []
  const coverPhoto = business?.cover_photo
  const logo = business?.logo
  const municipalityName = typeof business?.municipality === 'object' ? business?.municipality?.name : business?.municipality

  if (loadingBusiness) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 bg-gray-200 rounded" />
          <div className="h-64 bg-gray-200 rounded-2xl" />
          <div className="h-48 bg-gray-200 rounded-2xl" />
        </div>
      </div>
    )
  }

  if (!business) {
    return (
      <div className="max-w-6xl mx-auto text-center py-20 text-gray-500">
        Business not found
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <Link
        to={`/business-owner/businesses/${businessId}/gallery`}
        className="inline-flex items-center gap-2 text-sm text-[#6B7280] hover:text-gray-900 mb-6 transition"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Gallery
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Restaurant Profile Customization</h1>
          <p className="text-sm text-gray-500 mt-1">Customize how customers see your restaurant profile</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleReset}
            disabled={!hasChanges}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-[#6B7280] hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}
            className="inline-flex items-center gap-2 bg-[#00A86B] hover:bg-[#00975F] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition"
          >
            <Save className="w-4 h-4" />
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Settings */}
        <div className="space-y-6">
          {/* Welcome Message */}
          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-6">
            <h2 className="text-lg font-semibold text-[#111827] mb-4">Welcome Message</h2>
            <p className="text-sm text-[#4B5563] mb-3">A greeting message displayed on your restaurant profile</p>
            <textarea
              value={welcomeMessage}
              onChange={(e) => handleWelcomeChange(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Welcome to our restaurant! Enjoy authentic cuisine..."
              className="w-full px-4 py-3 bg-white border border-[#D1D5DB] rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00A86B]/25 focus:border-[#00A86B] transition resize-none"
            />
            <p className="text-xs text-gray-500 mt-2 text-right">{welcomeMessage.length}/500</p>
          </div>

          {/* Signature Dishes */}
          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-6">
            <h2 className="text-lg font-semibold text-[#111827] mb-4 flex items-center gap-2">
              <Utensils className="w-5 h-5 text-[#00A86B]" /> Signature Dishes
            </h2>
            <p className="text-sm text-[#4B5563] mb-3">Choose dishes to highlight on your restaurant profile</p>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newDish}
                onChange={(e) => setNewDish(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addDish()}
                placeholder="Add a signature dish..."
                className="flex-1 px-4 py-2.5 bg-white border border-[#D1D5DB] rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00A86B]/25 focus:border-[#00A86B] transition"
              />
              <button
                onClick={addDish}
                disabled={!newDish.trim()}
                className="px-4 py-2.5 bg-[#00A86B] hover:bg-[#00975F] disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition"
              >
                Add
              </button>
            </div>

            {signatureDishes.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {signatureDishes.map((dish) => (
                  <span
                    key={dish}
                    className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-lg text-sm"
                  >
                    {dish}
                    <button
                      onClick={() => removeDish(dish)}
                      className="hover:text-emerald-900 transition"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No signature dishes added yet</p>
            )}
          </div>

          {/* Restaurant Info Summary */}
          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-6">
            <h2 className="text-lg font-semibold text-[#111827] mb-4">Restaurant Information</h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <MapPin className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">{business.address}, {municipalityName}</span>
              </div>
              {business.contact_number && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">{business.contact_number}</span>
                </div>
              )}
              {business.website && (
                <div className="flex items-center gap-3 text-sm">
                  <Globe className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">{business.website}</span>
                </div>
              )}
              {business.opening_time && business.closing_time && (
                <div className="flex items-center gap-3 text-sm">
                  <Clock className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">{business.opening_time} - {business.closing_time}</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm">
                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                <span className="text-gray-600">{business.average_rating?.toFixed(1) || '0.0'} ({business.review_count} reviews)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Preview */}
        <div className="lg:sticky lg:top-6 self-start">
          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-lg font-semibold text-[#111827]">Live Preview</h2>
            </div>

            <div className="p-4">
              {/* Preview Card */}
              <div className="bg-white rounded-xl overflow-hidden border border-[#E5E7EB]">
                {/* Cover Photo */}
                <div className="h-40 bg-gradient-to-br from-emerald-50 to-gray-100 relative">
                  {coverPhoto ? (
                    <img src={toAssetUrl(coverPhoto)} alt="Cover" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <span className="text-gray-400 text-sm">Cover Photo</span>
                    </div>
                  )}
                </div>

                {/* Logo + Name */}
                <div className="px-4 -mt-8 relative">
                  <div className="flex items-end gap-3 mb-3">
                    <div className="w-16 h-16 rounded-xl bg-gray-100 border-4 border-white overflow-hidden flex-shrink-0 shadow-sm">
                      {logo ? (
                        <img src={toAssetUrl(logo)} alt="Logo" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Utensils className="w-6 h-6 text-gray-400" />
                        </div>
                      )}
                    </div>
                    <div className="pb-1">
                      <h3 className="font-bold text-gray-900 text-lg leading-tight">{business.business_name}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-amber-500 text-sm flex items-center gap-1">
                          <Star className="w-3.5 h-3.5 fill-amber-500" />
                          {business.average_rating?.toFixed(1) || '0.0'}
                        </span>
                        <span className="text-gray-400 text-xs">&bull;</span>
                        <span className={`text-xs ${business.is_open ? 'text-emerald-600' : 'text-red-500'}`}>
                          {business.is_open ? 'Open Now' : 'Closed'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Welcome Message */}
                {welcomeMessage && (
                  <div className="px-4 pb-3">
                    <p className="text-gray-700 text-sm leading-relaxed">{welcomeMessage}</p>
                  </div>
                )}

                {/* Signature Dishes */}
                {signatureDishes.length > 0 && (
                  <div className="px-4 pb-3">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Featured Dishes</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {signatureDishes.map((dish) => (
                        <span key={dish} className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-1 rounded-md text-xs">
                          {dish}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Featured Gallery */}
                {featuredGallery.length > 0 && (
                  <div className="px-4 pb-4">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Gallery</h4>
                    <div className="grid grid-cols-3 gap-1.5">
                      {featuredGallery.slice(0, 6).map((img) => (
                        <div key={img.id} className="aspect-square rounded-lg overflow-hidden bg-gray-100">
                          {img.type === 'Promotional Video' ? (
                            <video
                              src={img.file_path}
                              autoPlay
                              loop
                              muted
                              playsInline
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <img src={img.file_path} alt={img.title || ''} className="w-full h-full object-cover" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bottom Info */}
                <div className="px-4 py-3 bg-[#F9FAFB] border-t border-[#E5E7EB]">
                  <div className="flex items-center gap-2 text-xs text-[#374151]">
                    <MapPin className="w-3 h-3 text-gray-500" />
                    <span>{municipalityName}</span>
                    {business.price_range && (
                      <>
                        <span>&bull;</span>
                        <span className="capitalize">{business.price_range.replace('_', ' ')}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}