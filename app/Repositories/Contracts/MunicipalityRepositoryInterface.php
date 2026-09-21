<?php

namespace App\Repositories\Contracts;

use App\Models\Municipality;
use Illuminate\Support\Collection;

interface MunicipalityRepositoryInterface
{
    public function findById(int $id): ?Municipality;

    public function getAll(): Collection;

    public function getAllWithBarangays(): Collection;

    public function count(): int;
}
