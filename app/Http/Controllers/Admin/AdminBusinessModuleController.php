<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\BusinessModule;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminBusinessModuleController extends Controller
{
    public function index(): JsonResponse
    {
        return $this->successResponse(BusinessModule::all());
    }
}
