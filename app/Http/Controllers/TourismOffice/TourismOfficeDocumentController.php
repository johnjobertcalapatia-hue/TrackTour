<?php

namespace App\Http\Controllers\TourismOffice;

use App\Http\Controllers\Controller;
use App\Models\BusinessCategory;
use App\Models\RequiredDocument;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class TourismOfficeDocumentController extends Controller
{
    public function indexCategories(): JsonResponse
    {
        $categories = BusinessCategory::with(['requiredDocuments' => function ($q) {
            $q->orderBy('sort_order');
        }])->orderBy('name')->get();

        return $this->successResponse($categories);
    }

    public function showCategory(int $id): JsonResponse
    {
        $category = BusinessCategory::with(['requiredDocuments' => function ($q) {
            $q->orderBy('sort_order');
        }])->findOrFail($id);

        return $this->successResponse($category);
    }

    public function indexDocuments(): JsonResponse
    {
        $documents = RequiredDocument::orderBy('name')->get();

        return $this->successResponse($documents);
    }

    public function storeDocument(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string|max:1000',
            'file_types' => 'nullable|string|max:255',
            'max_size_kb' => 'nullable|integer|min:100|max:20480',
            'accepts_multiple' => 'nullable|boolean',
            'is_expirable' => 'nullable|boolean',
            'remarks' => 'nullable|string|max:500',
        ]);

        $validated['code'] = Str::slug($validated['name']);
        $validated['file_types'] = $validated['file_types'] ?? 'pdf,jpg,jpeg,png';
        $validated['max_size_kb'] = $validated['max_size_kb'] ?? 5120;
        $validated['accepts_multiple'] = $validated['accepts_multiple'] ?? false;
        $validated['is_expirable'] = $validated['is_expirable'] ?? false;
        $validated['status'] = 'active';

        $document = RequiredDocument::create($validated);

        return $this->successResponse($document, 'Document type created.', 201);
    }

    public function updateDocument(Request $request, int $id): JsonResponse
    {
        $document = RequiredDocument::findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'description' => 'nullable|string|max:1000',
            'file_types' => 'nullable|string|max:255',
            'max_size_kb' => 'nullable|integer|min:100|max:20480',
            'accepts_multiple' => 'nullable|boolean',
            'is_expirable' => 'nullable|boolean',
            'remarks' => 'nullable|string|max:500',
            'status' => 'nullable|string|in:active,inactive',
        ]);

        if (isset($validated['name'])) {
            $validated['code'] = Str::slug($validated['name']);
        }

        $document->update($validated);

        return $this->successResponse($document->fresh(), 'Document type updated.');
    }

    public function destroyDocument(int $id): JsonResponse
    {
        $document = RequiredDocument::findOrFail($id);

        if ($document->categories()->count() > 0) {
            return $this->errorResponse('Cannot delete a document type that is assigned to categories.', 422);
        }

        $document->delete();

        return $this->successResponse(null, 'Document type deleted.');
    }

    public function addCategoryDocument(Request $request, int $categoryId): JsonResponse
    {
        $category = BusinessCategory::findOrFail($categoryId);

        $validated = $request->validate([
            'document_name' => 'required|string|max:255',
            'document_code' => 'required|string|max:255',
            'is_required' => 'nullable|boolean',
            'has_expiration' => 'nullable|boolean',
            'validity_period' => 'nullable|string|max:255',
            'description' => 'nullable|string|max:1000',
            'required_fields' => 'nullable|array',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        $document = RequiredDocument::create([
            'business_category_id' => $categoryId,
            'document_name' => $validated['document_name'],
            'document_code' => $validated['document_code'],
            'is_required' => $validated['is_required'] ?? true,
            'has_expiration' => $validated['has_expiration'] ?? false,
            'validity_period' => $validated['validity_period'] ?? null,
            'description' => $validated['description'] ?? null,
            'required_fields' => $validated['required_fields'] ?? ['document_number', 'issue_date', 'expiration_date'],
            'sort_order' => $validated['sort_order'] ?? 0,
            'is_active' => true,
        ]);

        return $this->successResponse(
            $category->load('requiredDocuments'),
            'Document added to category.',
            201
        );
    }

    public function updateCategoryDocument(Request $request, int $categoryId, int $documentId): JsonResponse
    {
        $document = RequiredDocument::where('business_category_id', $categoryId)
            ->where('id', $documentId)
            ->first();

        if (!$document) {
            return $this->errorResponse('Document not found in this category.', 404);
        }

        $validated = $request->validate([
            'document_name' => 'sometimes|required|string|max:255',
            'is_required' => 'nullable|boolean',
            'has_expiration' => 'nullable|boolean',
            'validity_period' => 'nullable|string|max:255',
            'description' => 'nullable|string|max:1000',
            'required_fields' => 'nullable|array',
            'sort_order' => 'nullable|integer|min:0',
            'is_active' => 'nullable|boolean',
        ]);

        $document->update($validated);

        $category = BusinessCategory::with(['requiredDocuments' => function ($q) {
            $q->orderBy('sort_order');
        }])->findOrFail($categoryId);

        return $this->successResponse($category, 'Category document updated.');
    }

    public function removeCategoryDocument(int $categoryId, int $documentId): JsonResponse
    {
        $document = RequiredDocument::where('business_category_id', $categoryId)
            ->where('id', $documentId)
            ->first();

        if (!$document) {
            return $this->errorResponse('Document not found in this category.', 404);
        }

        $document->delete();

        $category = BusinessCategory::with(['requiredDocuments' => function ($q) {
            $q->orderBy('sort_order');
        }])->findOrFail($categoryId);

        return $this->successResponse($category, 'Document removed from category.');
    }
}
