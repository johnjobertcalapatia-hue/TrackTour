<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\StoreBusinessCategoryRequest;
use App\Http\Requests\Admin\UpdateBusinessCategoryRequest;
use App\Http\Resources\BusinessCategoryResource;
use App\Models\BusinessCategory;
use App\Models\RequiredDocument;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminBusinessCategoryController extends Controller
{
    public function index(): JsonResponse
    {
        $categories = BusinessCategory::with(['requiredDocuments' => function ($q) {
            $q->orderBy('sort_order');
        }])->orderBy('name')->get();

        return $this->successResponse(
            BusinessCategoryResource::collection($categories)
        );
    }

    public function store(StoreBusinessCategoryRequest $request): JsonResponse
    {
        $category = BusinessCategory::create($request->validated());

        return $this->createdResponse(
            BusinessCategoryResource::make($category),
            "Category \"{$category->name}\" created."
        );
    }

    public function update(UpdateBusinessCategoryRequest $request, BusinessCategory $category): JsonResponse
    {
        $category->update($request->validated());

        return $this->successResponse(
            BusinessCategoryResource::make($category->fresh()),
            'Category updated.'
        );
    }

    public function archive(BusinessCategory $category): JsonResponse
    {
        $category->archive();

        return $this->successResponse(
            BusinessCategoryResource::make($category->fresh()),
            "Category \"{$category->name}\" archived."
        );
    }

    public function unarchive(BusinessCategory $category): JsonResponse
    {
        $category->unarchive();

        return $this->successResponse(
            BusinessCategoryResource::make($category->fresh()),
            "Category \"{$category->name}\" restored."
        );
    }

    public function addDocument(Request $request, BusinessCategory $category): JsonResponse
    {
        $validated = $request->validate([
            'document_name' => 'required|string|max:255',
            'document_code' => 'nullable|string|max:100',
            'is_required' => 'boolean',
            'has_expiration' => 'boolean',
            'validity_period' => 'nullable|integer|min:0',
            'description' => 'nullable|string|max:500',
            'required_fields' => 'nullable|array',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        $document = RequiredDocument::create([
            'business_category_id' => $category->id,
            'document_name' => $validated['document_name'],
            'document_code' => $validated['document_code'] ?? null,
            'is_required' => $validated['is_required'] ?? true,
            'has_expiration' => $validated['has_expiration'] ?? false,
            'validity_period' => $validated['validity_period'] ?? null,
            'description' => $validated['description'] ?? null,
            'required_fields' => $validated['required_fields'] ?? ['document_number', 'issue_date', 'expiration_date'],
            'sort_order' => $validated['sort_order'] ?? 0,
            'is_active' => true,
        ]);

        return $this->successResponse(
            BusinessCategoryResource::make($category->fresh()->load('requiredDocuments')),
            "\"{$document->document_name}\" added to {$category->name}."
        );
    }

    public function updateDocument(Request $request, BusinessCategory $category, RequiredDocument $document): JsonResponse
    {
        if ($document->business_category_id !== $category->id) {
            return $this->errorResponse('Document does not belong to this category.', 404);
        }

        $validated = $request->validate([
            'document_name' => 'sometimes|required|string|max:255',
            'document_code' => 'nullable|string|max:100',
            'is_required' => 'boolean',
            'has_expiration' => 'boolean',
            'validity_period' => 'nullable|integer|min:0',
            'description' => 'nullable|string|max:500',
            'sort_order' => 'nullable|integer|min:0',
            'is_active' => 'boolean',
        ]);

        $document->update($validated);

        return $this->successResponse(
            BusinessCategoryResource::make($category->fresh()->load('requiredDocuments')),
            "Document updated."
        );
    }

    public function archiveDocument(BusinessCategory $category, RequiredDocument $document): JsonResponse
    {
        if ($document->business_category_id !== $category->id) {
            return $this->errorResponse('Document does not belong to this category.', 404);
        }

        $document->archive();

        return $this->successResponse(
            BusinessCategoryResource::make($category->fresh()->load('requiredDocuments')),
            "Document \"{$document->document_name}\" archived."
        );
    }

    public function unarchiveDocument(BusinessCategory $category, RequiredDocument $document): JsonResponse
    {
        if ($document->business_category_id !== $category->id) {
            return $this->errorResponse('Document does not belong to this category.', 404);
        }

        $document->unarchive();

        return $this->successResponse(
            BusinessCategoryResource::make($category->fresh()->load('requiredDocuments')),
            "Document \"{$document->document_name}\" restored."
        );
    }

    public function toggleRequired(BusinessCategory $category, RequiredDocument $document): JsonResponse
    {
        if ($document->business_category_id !== $category->id) {
            return $this->errorResponse('Document does not belong to this category.', 404);
        }

        $document->update(['is_required' => !$document->is_required]);

        return $this->successResponse(
            BusinessCategoryResource::make($category->fresh()->load('requiredDocuments')),
            "\"{$document->document_name}\" is now " . ($document->is_required ? 'required' : 'optional') . '.'
        );
    }
}
