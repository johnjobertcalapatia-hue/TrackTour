<?php

namespace App\Repositories\Eloquent;

use App\Models\Municipality;
use App\Repositories\Contracts\MunicipalityRepositoryInterface;
use Illuminate\Support\Collection;

class MunicipalityRepository implements MunicipalityRepositoryInterface
{
    public function __construct(
        protected Municipality $model,
    ) {}

    public function findById(int $id): ?Municipality
    {
        return $this->model->with('barangays')->find($id);
    }

    public function getAll(): Collection
    {
        return $this->model->orderBy('name')->get();
    }

    public function getAllWithBarangays(): Collection
    {
        return $this->model->with('barangays')
            ->orderBy('name')
            ->get();
    }

    public function count(): int
    {
        return $this->model->count();
    }
}
