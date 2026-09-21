<?php

namespace App\Services;

use App\Models\TourismCategory;
use App\Models\TourismEvent;
use App\Models\User;
use App\Repositories\Contracts\BusinessRepositoryInterface;
use App\Repositories\Contracts\FavoriteRepositoryInterface;
use App\Repositories\Contracts\ReviewRepositoryInterface;
use Illuminate\Support\Collection;

class TouristService
{
    public function __construct(
        protected BusinessRepositoryInterface $businessRepository,
        protected ReviewRepositoryInterface $reviewRepository,
        protected FavoriteRepositoryInterface $favoriteRepository,
    ) {}

    public function getDashboardData(User $user, ?float $lat = null, ?float $lng = null): array
    {
        $categories = TourismCategory::all();
        $featured = $this->businessRepository->getFeatured(8);
        $trending = $this->businessRepository->getPopular(8);
        $recentlyViewed = collect();
        $saved = $this->favoriteRepository->getByUser($user->id);
        $nearby = collect();

        if ($lat && $lng) {
            $nearby = $this->businessRepository->getNearby($lat, $lng, 20, 8);
        }

        $events = TourismEvent::where('status', 'published')
            ->where(function ($q) {
                $q->whereNull('end_date')
                    ->orWhere('end_date', '>=', now());
            })
            ->orderBy('start_date')
            ->limit(5)
            ->get();

        $popularRestaurants = $this->businessRepository->getPopular(5);

        $topAttractions = $this->businessRepository->getFeatured(5);

        $travelInspiration = $this->businessRepository->getRecent(5);

        return [
            'categories' => $categories,
            'featured' => $featured,
            'trending' => $trending,
            'nearby' => $nearby,
            'events' => $events,
            'recently_viewed' => $recentlyViewed,
            'saved' => $saved,
            'popular_restaurants' => $popularRestaurants,
            'top_attractions' => $topAttractions,
            'travel_inspiration' => $travelInspiration,
        ];
    }

    public function getExploreData(array $filters = []): Collection
    {
        $categoryId = $filters['category_id'] ?? null;
        $municipalityId = $filters['municipality_id'] ?? null;

        if ($categoryId) {
            return $this->businessRepository->getByCategory((int) $categoryId);
        }

        $limit = $filters['limit'] ?? 20;

        return $this->businessRepository->getApproved($limit);
    }

    public function search(string $query): Collection
    {
        return $this->businessRepository->search($query, 10);
    }

    public function getBusinessDetail(int $id, ?int $userId = null): array
    {
        $business = $this->businessRepository->findById($id);

        if (! $business) {
            return ['business' => null, 'is_favorited' => false, 'rating' => 0.0, 'review_count' => 0];
        }

        $isFavorited = $userId
            ? $this->favoriteRepository->isFavorited($userId, 'business', $id)
            : false;

        $rating = $this->reviewRepository->getAverageRating($id);
        $reviewCount = $this->reviewRepository->getCount($id);
        $reviews = $this->reviewRepository->getByBusiness($id);

        return [
            'business' => $business,
            'is_favorited' => $isFavorited,
            'rating' => $rating,
            'review_count' => $reviewCount,
            'reviews' => $reviews,
        ];
    }

    public function getFoodListings(array $filters = []): Collection
    {
        $businesses = $this->businessRepository->getApproved();

        return $businesses->filter(function ($business) {
            return $business->isRestaurant();
        });
    }

    public function toggleFavorite(int $userId, string $type, int $objectId): bool
    {
        return $this->favoriteRepository->toggle($userId, $type, $objectId);
    }

    public function getFavorites(int $userId): Collection
    {
        return $this->favoriteRepository->getByUser($userId);
    }

    public function getHistory(int $userId): Collection
    {
        return $this->favoriteRepository->getByUser($userId);
    }
}
