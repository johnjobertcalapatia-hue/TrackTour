<?php

namespace App\Repositories\Eloquent;

use App\Models\Staff;
use App\Repositories\Contracts\StaffRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;

class StaffRepository implements StaffRepositoryInterface
{
    public function __construct(
        protected Staff $model,
    ) {}

    public function findById(int $id): ?Staff
    {
        return $this->model->with(['business', 'user.profile', 'staffRole'])->find($id);
    }

    public function getByUser(int $userId): ?Staff
    {
        return $this->model->with(['business', 'staffRole'])
            ->where('user_id', $userId)
            ->first();
    }

    public function getByBusiness(int $businessId, int $perPage = 15): LengthAwarePaginator
    {
        return $this->model->with(['user.profile', 'staffRole'])
            ->where('business_id', $businessId)
            ->latest()
            ->paginate($perPage);
    }

    public function create(array $data): Staff
    {
        return $this->model->create($data);
    }

    public function update(Staff $staff, array $data): Staff
    {
        $staff->update($data);

        return $staff->fresh();
    }
}
