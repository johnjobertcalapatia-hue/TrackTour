<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

class AdminRoleController extends Controller
{
    public function index(): JsonResponse
    {
        return $this->successResponse([
            ['id' => 1, 'name' => 'tourist', 'display_name' => 'Tourist', 'description' => 'Regular tourist user'],
            ['id' => 2, 'name' => 'business_owner', 'display_name' => 'Business Owner', 'description' => 'Business owner'],
            ['id' => 3, 'name' => 'staff', 'display_name' => 'Staff', 'description' => 'Business staff member'],
            ['id' => 4, 'name' => 'rider', 'display_name' => 'Rider', 'description' => 'Delivery rider'],
            ['id' => 5, 'name' => 'tourism_office', 'display_name' => 'Tourism Office', 'description' => 'Municipal tourism office'],
            ['id' => 6, 'name' => 'bansud_tourism_office', 'display_name' => 'Admin', 'description' => 'Bansud tourism office admin'],
        ]);
    }
}
