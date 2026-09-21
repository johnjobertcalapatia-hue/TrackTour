<?php

namespace App\Repositories\Contracts;

use App\Models\Staff;
use Illuminate\Pagination\LengthAwarePaginator;

interface StaffRepositoryInterface
{
    public function findById(int $id): ?Staff;

    public function getByUser(int $userId): ?Staff;

    public function getByBusiness(int $businessId, int $perPage = 15): LengthAwarePaginator;

    public function create(array $data): Staff;

    public function update(Staff $staff, array $data): Staff;
}
