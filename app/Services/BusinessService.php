<?php

namespace App\Services;

use App\Models\Business;
use App\Repositories\Contracts\BookingRepositoryInterface;
use App\Repositories\Contracts\BusinessRepositoryInterface;
use App\Repositories\Contracts\OrderRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

class BusinessService
{
    public function __construct(
        protected BusinessRepositoryInterface $businessRepository,
        protected ?OrderRepositoryInterface $orderRepository = null,
        protected ?BookingRepositoryInterface $bookingRepository = null,
    ) {}

    public function getDashboardStats(int $ownerId): array
    {
        $businesses = $this->businessRepository->getByOwner($ownerId);
        $totalBusinesses = $businesses->count();
        $businessIds = $businesses->pluck('id');

        $totalOrders = 0;
        $totalBookings = 0;

        if ($this->orderRepository && $businessIds->isNotEmpty()) {
            foreach ($businessIds as $id) {
                $counts = $this->orderRepository->getStatusCounts($id);
                $totalOrders += $counts->sum('count');
            }
        }

        if ($this->bookingRepository && $businessIds->isNotEmpty()) {
            foreach ($businessIds as $id) {
                $counts = $this->bookingRepository->getStatusCounts($id);
                $totalBookings += $counts->sum('count');
            }
        }

        return [
            'total_businesses' => $totalBusinesses,
            'total_orders' => $totalOrders,
            'total_bookings' => $totalBookings,
            'businesses' => $businesses,
        ];
    }

    public function getBusiness(int $id): ?Business
    {
        return $this->businessRepository->findById($id);
    }

    public function getPaginatedBusinesses(array $filters = [], int $perPage = 15): LengthAwarePaginator
    {
        return $this->businessRepository->getPaginated($filters, $perPage);
    }

    public function getByOwner(int $ownerId): Collection
    {
        return $this->businessRepository->getByOwner($ownerId);
    }

    public function createBusiness(array $data): Business
    {
        return $this->businessRepository->create($data);
    }

    public function updateBusiness(Business $business, array $data): Business
    {
        return $this->businessRepository->update($business, $data);
    }

    public function deleteBusiness(Business $business): bool
    {
        return $this->businessRepository->delete($business);
    }

    public function getNearby(float $lat, float $lng, float $radius = 20): Collection
    {
        return $this->businessRepository->getNearby($lat, $lng, $radius);
    }

    public function search(string $query): Collection
    {
        return $this->businessRepository->search($query);
    }

    public function getFeatured(): Collection
    {
        return $this->businessRepository->getFeatured();
    }

    public function getPopular(): Collection
    {
        return $this->businessRepository->getPopular();
    }

    public function getRecent(): Collection
    {
        return $this->businessRepository->getRecent();
    }

    public function adminStats(): array
    {
        return [
            'total' => $this->businessRepository->count(),
            'pending' => $this->businessRepository->countByStatus('pending'),
            'approved' => $this->businessRepository->countByStatus('approved'),
            'rejected' => $this->businessRepository->countByStatus('rejected'),
            'suspended' => $this->businessRepository->countByStatus('suspended'),
        ];
    }
}
