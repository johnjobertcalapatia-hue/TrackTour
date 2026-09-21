<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\BusinessCategory;
use App\Models\BusinessModule;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminCategoryModuleController extends Controller
{
    public function index(): JsonResponse
    {
        $categories = BusinessCategory::with('modules')->get();

        return $this->successResponse($categories);
    }

    public function available(): JsonResponse
    {
        return $this->successResponse(BusinessModule::all());
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'category_id' => 'required|exists:business_categories,id',
            'module_id' => 'required|exists:business_modules,id',
        ]);

        $category = BusinessCategory::find($request->category_id);
        $category->modules()->attach($request->module_id);

        return $this->createdResponse($category->fresh()->load('modules'));
    }

    public function destroy(int $categoryId, int $moduleId): JsonResponse
    {
        $category = BusinessCategory::find($categoryId);
        $category->modules()->detach($moduleId);

        return $this->noContentResponse('Module removed from category.');
    }
}
