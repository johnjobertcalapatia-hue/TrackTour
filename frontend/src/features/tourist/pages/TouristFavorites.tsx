import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Heart, MapPin, Star, UtensilsCrossed } from 'lucide-react'
import { categoryName } from '@/shared/utils'

interface Favoritable {
  id: number
  name: string
  category: { id: number; name: string } | null
  municipality: { id: number; name: string } | null
  cover_photo: string | null
  average_rating: number | null
}

interface BackendFavorite {
  id: number
  favoritable: Favoritable
}

interface Favorite {
  id: number
  name: string
  category: unknown
  municipality: string
  cover_photo: string | null
  rating: number | null
  is_open: boolean
}

export default function TouristFavorites() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-favorites'],
    queryFn: () => get<{ favorites: BackendFavorite[] }>('/tourist/favorites'),
  })

  const removeMutation = useMutation({
    mutationFn: (businessId: number) => post('/tourist/favorites/toggle', { business_id: businessId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tourist-favorites'] }),
  })

  if (isLoading) return <DashboardSkeleton />

  const favorites: Favorite[] = (data?.favorites ?? []).map((fav) => ({
    id: fav.favoritable?.id ?? fav.id,
    name: fav.favoritable?.name ?? 'Saved item',
    category: fav.favoritable?.category,
    municipality: fav.favoritable?.municipality?.name ?? '',
    cover_photo: fav.favoritable?.cover_photo,
    rating: fav.favoritable?.average_rating,
    is_open: false,
  }))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Favorites</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Food businesses you've saved</p>
      </div>

      {favorites.length === 0 ? (
        <div className="bg-white border border-[#E5E9E7] rounded-2xl p-12 text-center">
          <Heart className="w-12 h-12 text-[#6B7280]/30 mx-auto mb-4" />
          <p className="text-[#6B7280] mb-4">No favorites yet. Explore food businesses and save your favorites.</p>
          <button onClick={() => navigate('/tourist/food')} className="bg-[#087F3F] hover:bg-[#056B35] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            Browse Food
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {favorites.map((fav) => (
            <div key={fav.id} className="bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg transition-all duration-200">
              <div
                onClick={() => navigate(`/tourist/explore/${fav.id}`)}
                className="cursor-pointer"
              >
                <div className="relative h-40">
                  <img src={fav.cover_photo || '/assets/placeholder.svg'} alt={fav.name} className="w-full h-full object-cover" />
                  {fav.rating && (
                    <div className="absolute bottom-3 left-3 flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-lg">
                      <Star className="w-3 h-3 fill-current" /> {fav.rating}
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-[#17201B] truncate">{fav.name}</h3>
                  <p className="text-sm text-[#6B7280] mt-1">{categoryName(fav.category)}</p>
                  <div className="flex items-center gap-1 text-xs text-[#6B7280] mt-2">
                    <MapPin className="w-3 h-3" /> {fav.municipality}
                  </div>
                </div>
              </div>
              <div className="px-4 pb-4">
                <button
                  onClick={() => removeMutation.mutate(fav.id)}
                  disabled={removeMutation.isPending}
                  className="w-full text-center text-xs text-red-500 hover:text-red-600 py-2 rounded-xl hover:bg-red-50 transition"
                >
                  Remove from Favorites
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
