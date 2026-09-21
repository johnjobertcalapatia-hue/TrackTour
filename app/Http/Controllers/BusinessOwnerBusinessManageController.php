<?php

namespace App\Http\Controllers;

use App\Http\Requests\BusinessOwner\StoreBusinessRequest;
use App\Http\Requests\BusinessOwner\UpdateBusinessRequest;
use App\Http\Resources\BusinessMediaResource;
use App\Http\Resources\BusinessResource;
use App\Models\Barangay;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\BusinessDocument;
use App\Models\BusinessMedia;
use App\Models\Municipality;
use App\Services\BusinessService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class BusinessOwnerBusinessManageController extends Controller
{
    public function __construct(
        private BusinessService $businessService
    ) {}

    public function store(StoreBusinessRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $validated['owner_id'] = $request->user()->id;
        $validated['status'] = 'under_review';
        $business = \App\Models\Business::create($validated);
        $business->syncModulesFromCategory();

        if (! empty($validated['details'])) {
            $business->details()->createMany(
                collect($validated['details'])
                    ->filter(fn ($value) => $value !== null && $value !== '')
                    ->map(fn ($value, $fieldName) => [
                        'field_name' => $fieldName,
                        'field_value' => is_array($value) ? json_encode($value) : (string) $value,
                    ])
                    ->values()
                    ->all()
            );
        }

        $sortOrder = 0;
        if ($request->hasFile('logo')) {
            $logoPath = $request->file('logo')->store('businesses/logos', 'public');
            $business->update(['logo' => $logoPath]);
            $business->media()->create([
                'type' => 'Logo',
                'file_path' => $logoPath,
                'sort_order' => $sortOrder++,
            ]);
        }

        if ($request->hasFile('gallery')) {
            foreach ($request->file('gallery') as $image) {
                $business->media()->create([
                    'type' => 'Gallery',
                    'file_path' => $image->store('businesses/gallery', 'public'),
                    'sort_order' => $sortOrder++,
                ]);
            }
        }

        if (! empty($validated['documents'])) {
            foreach ($validated['documents'] as $doc) {
                $filePath = null;
                if (! empty($doc['file']) && $doc['file'] instanceof \Illuminate\Http\UploadedFile) {
                    $filePath = $doc['file']->store('businesses/documents', 'public');
                }

                $ocrData = [];
                if (! empty($doc['ocr_document_number'])) $ocrData['document_number'] = $doc['ocr_document_number'];
                if (! empty($doc['ocr_registered_name'])) $ocrData['registered_name'] = $doc['ocr_registered_name'];
                if (! empty($doc['ocr_issue_date'])) $ocrData['issue_date'] = $doc['ocr_issue_date'];
                if (! empty($doc['ocr_expiration_date'])) $ocrData['expiration_date'] = $doc['ocr_expiration_date'];

                $flagged = false;
                $flagReasons = [];

                $ocrDocNum = $ocrData['document_number'] ?? null;
                $manualDocNum = $doc['document_number'] ?? null;
                if ($ocrDocNum && $manualDocNum && ! str_contains($manualDocNum, $ocrDocNum)) {
                    $flagged = true;
                    $flagReasons[] = 'Document number mismatch: OCR="' . $ocrDocNum . '", Manual="' . $manualDocNum . '"';
                }
                $ocrIssueDate = $this->normalizeDate($ocrData['issue_date'] ?? null);
                $manualIssueDate = $this->normalizeDate($doc['issue_date'] ?? null);
                if ($ocrIssueDate && $manualIssueDate && $ocrIssueDate !== $manualIssueDate) {
                    $flagged = true;
                    $flagReasons[] = 'Issue date mismatch: OCR="' . ($ocrData['issue_date'] ?? '') . '", Manual="' . ($doc['issue_date'] ?? '') . '"';
                }
                $ocrExpDate = $this->normalizeDate($ocrData['expiration_date'] ?? null);
                $manualExpDate = $this->normalizeDate($doc['expiration_date'] ?? null);
                if ($ocrExpDate && $manualExpDate && $ocrExpDate !== $manualExpDate) {
                    $flagged = true;
                    $flagReasons[] = 'Expiration date mismatch: OCR="' . ($ocrData['expiration_date'] ?? '') . '", Manual="' . ($doc['expiration_date'] ?? '') . '"';
                }

                $business->documents()->create([
                    'required_document_id' => $doc['required_document_id'] ?? null,
                    'file_path' => $filePath,
                    'document_number' => $doc['document_number'] ?? null,
                    'registered_name' => $doc['registered_name'] ?? null,
                    'issue_date' => $doc['issue_date'] ?? null,
                    'expiration_date' => $doc['expiration_date'] ?? null,
                    'owner_remarks' => $doc['owner_remarks'] ?? null,
                    'verification_status' => $flagged ? 'flagged' : 'pending',
                    'flagged' => $flagged,
                    'flag_reason' => $flagged ? implode('; ', $flagReasons) : null,
                    'ocr_data' => $flagged ? $ocrData : null,
                ]);
            }
        }

        return $this->createdResponse($business->fresh()->load('category', 'municipality', 'barangay'), 'Business created successfully.');
    }

    public function show(Business $business): JsonResponse
    {
        if ($business->owner_id !== request()->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }
        $business->load('category', 'municipality', 'barangay', 'details', 'documents', 'media');
        return $this->successResponse(BusinessResource::make($business));
    }

    public function edit(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $business->load('details', 'category', 'municipality', 'barangay', 'documents.requiredDocument', 'media');

        return $this->successResponse(BusinessResource::make($business));
    }

    public function updateHours(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'business_hours' => ['nullable', 'array'],
            'business_hours.*' => ['array'],
            'business_hours.*.*' => ['array'],
            'business_hours.*.*.open' => ['required', 'regex:/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/'],
            'business_hours.*.*.close' => ['required', 'regex:/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/'],
            'force_closed' => ['sometimes', 'boolean'],
        ]);

        $data = [];

        if (array_key_exists('force_closed', $validated)) {
            $data['force_closed'] = (bool) $validated['force_closed'];
        }

        if (array_key_exists('business_hours', $validated)) {
            $data['business_hours'] = $this->normalizeBusinessHours($validated['business_hours']);
        }

        if (! empty($data)) {
            $business->update($data);
        }

        return $this->successResponse(
            BusinessResource::make($business->fresh()->load('category', 'municipality', 'barangay')),
            'Operating hours updated successfully.'
        );
    }

    public function update(UpdateBusinessRequest $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validated();

        $wasApproved = $business->status === 'approved';
        $details = $validated['details'] ?? null;

        $business->update([
            'business_name' => $validated['business_name'] ?? $business->business_name,
            'business_description' => $validated['business_description'] ?? $business->business_description,
            'business_category_id' => $validated['business_category_id'] ?? $business->business_category_id,
            'tagline' => $validated['tagline'] ?? $business->tagline,
            'contact_number' => $validated['contact_number'] ?? $business->contact_number,
            'email' => $validated['email'] ?? $business->email,
            'website' => $validated['website'] ?? $business->website,
            'facebook' => $validated['facebook'] ?? $business->facebook,
            'instagram' => $validated['instagram'] ?? $business->instagram,
            'other_social_media' => $validated['other_social_media'] ?? $business->other_social_media,
            'address' => $validated['address'] ?? $business->address,
            'municipality_id' => $validated['municipality_id'] ?? $business->municipality_id,
            'barangay_id' => $validated['barangay_id'] ?? $business->barangay_id,
            'latitude' => $validated['latitude'] ?? $business->latitude,
            'longitude' => $validated['longitude'] ?? $business->longitude,
            'opening_time' => $validated['opening_time'] ?? $business->opening_time,
            'closing_time' => $validated['closing_time'] ?? $business->closing_time,
            'business_days' => $validated['business_days'] ?? $business->business_days,
            'business_hours' => $validated['business_hours'] ?? $business->business_hours,
            'force_closed' => array_key_exists('force_closed', $validated)
                ? (bool) $validated['force_closed']
                : $business->force_closed,
        ]);

        if ($details !== null) {
            foreach ($details as $fieldName => $fieldValue) {
                $business->details()->updateOrCreate(
                    ['field_name' => $fieldName],
                    ['field_value' => (string) $fieldValue],
                );
            }
        }

        if ($wasApproved) {
            $business->update(['status' => 'pending']);
            $business->statusLogs()->create([
                'status' => 'pending',
                'remarks' => 'Business details were updated by owner. Re-submitted for admin approval.',
            ]);
        }

        return $this->successResponse(
            BusinessResource::make($business->fresh()->load('category', 'municipality', 'barangay')),
            $wasApproved
                ? 'Business information updated. Changes require admin re-approval.'
                : 'Business information updated successfully.'
        );
    }

    public function documents(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $business->load('documents.requiredDocument');

        $uploadedDocIds = $business->documents->pluck('required_document_id')->toArray();
        $availableDocs = $business->category->requiredDocuments()
            ->whereNotIn('required_documents.id', $uploadedDocIds)
            ->get();

        return $this->successResponse([
            'documents' => $business->documents,
            'available_docs' => $availableDocs,
            'business_status' => $business->status,
        ]);
    }

    public function uploadDocument(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($business->status === 'approved') {
            return $this->errorResponse('Documents cannot be modified once the business is approved.', 422);
        }

        $validated = $request->validate([
            'required_document_id' => ['required', 'integer', 'exists:required_documents,id'],
            'file' => ['required', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
            'document_number' => ['nullable', 'string', 'max:255'],
            'registered_name' => ['nullable', 'string', 'max:255'],
            'issued_by' => ['nullable', 'string', 'max:255'],
            'issue_date' => ['nullable', 'date'],
            'expiration_date' => ['nullable', 'date', 'after_or_equal:issue_date'],
            'owner_remarks' => ['nullable', 'string', 'max:1000'],
            'ocr_document_number' => ['nullable', 'string', 'max:255'],
            'ocr_registered_name' => ['nullable', 'string', 'max:255'],
            'ocr_issue_date' => ['nullable', 'string', 'max:50'],
            'ocr_expiration_date' => ['nullable', 'string', 'max:50'],
        ]);

        $requiredDoc = \App\Models\RequiredDocument::find($validated['required_document_id']);

        if ($requiredDoc?->is_expirable && empty($validated['expiration_date'])) {
            return $this->errorResponse('An expiration date is required for this document type.', 422);
        }

        $ocrData = [];
        if (! empty($validated['ocr_document_number'])) $ocrData['document_number'] = $validated['ocr_document_number'];
        if (! empty($validated['ocr_registered_name'])) $ocrData['registered_name'] = $validated['ocr_registered_name'];
        if (! empty($validated['ocr_issue_date'])) $ocrData['issue_date'] = $validated['ocr_issue_date'];
        if (! empty($validated['ocr_expiration_date'])) $ocrData['expiration_date'] = $validated['ocr_expiration_date'];

        $flagged = false;
        $flagReasons = [];

        $ocrDocNum = $ocrData['document_number'] ?? null;
        $manualDocNum = $validated['document_number'] ?? null;
        if ($ocrDocNum && $manualDocNum && ! str_contains($manualDocNum, $ocrDocNum)) {
            $flagged = true;
            $flagReasons[] = 'Document number mismatch: OCR="' . $ocrDocNum . '", Manual="' . $manualDocNum . '"';
        }
        $ocrIssueDate = $this->normalizeDate($ocrData['issue_date'] ?? null);
        $manualIssueDate = $this->normalizeDate($validated['issue_date'] ?? null);
        if ($ocrIssueDate && $manualIssueDate && $ocrIssueDate !== $manualIssueDate) {
            $flagged = true;
            $flagReasons[] = 'Issue date mismatch: OCR="' . ($ocrData['issue_date'] ?? '') . '", Manual="' . ($validated['issue_date'] ?? '') . '"';
        }
        $ocrExpDate = $this->normalizeDate($ocrData['expiration_date'] ?? null);
        $manualExpDate = $this->normalizeDate($validated['expiration_date'] ?? null);
        if ($ocrExpDate && $manualExpDate && $ocrExpDate !== $manualExpDate) {
            $flagged = true;
            $flagReasons[] = 'Expiration date mismatch: OCR="' . ($ocrData['expiration_date'] ?? '') . '", Manual="' . ($validated['expiration_date'] ?? '') . '"';
        }

        $document = $business->documents()->create([
            'required_document_id' => $validated['required_document_id'],
            'file_path' => $request->file('file')->store('businesses/documents', 'public'),
            'document_number' => $validated['document_number'] ?? null,
            'registered_name' => $validated['registered_name'] ?? null,
            'issued_by' => $validated['issued_by'] ?? null,
            'issue_date' => $validated['issue_date'] ?? null,
            'expiration_date' => $validated['expiration_date'] ?? null,
            'owner_remarks' => $validated['owner_remarks'] ?? null,
            'verification_status' => $flagged ? 'flagged' : 'pending',
            'flagged' => $flagged,
            'flag_reason' => $flagged ? implode('; ', $flagReasons) : null,
            'ocr_data' => $flagged ? $ocrData : null,
        ]);

        return $this->createdResponse($document, 'Document uploaded successfully.');
    }

    public function deleteDocument(Request $request, BusinessDocument $businessDocument): JsonResponse
    {
        if ($businessDocument->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($businessDocument->business->status === 'approved') {
            return $this->errorResponse('Documents cannot be modified once the business is approved.', 422);
        }

        Storage::disk('public')->delete($businessDocument->file_path);
        $businessDocument->delete();

        return $this->noContentResponse('Document archived successfully.');
    }

    public function gallery(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $query = $business->media();

        if ($request->filled('category')) {
            $query->where('category', $request->category);
        }

        if ($request->filled('type')) {
            $query->where('type', $request->type);
        }

        if ($request->boolean('featured_only')) {
            $query->where('featured', true);
        }

        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }

        $media = $query->orderBy('sort_order')->get();

        return $this->successResponse(
            BusinessMediaResource::collection($media)
        );
    }

    public function uploadGallery(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'images' => ['required', 'array'],
            'images.*' => ['file', 'mimes:jpg,jpeg,png,webp', 'max:10240'],
            'title' => ['required', 'string', 'max:100'],
            'caption' => ['nullable', 'string', 'max:500'],
            'category' => ['nullable', 'string', 'in:food,restaurant,promotion,event,signature_dish,interior,dining_area,behind_the_scenes,new_menu,best_seller,dessert,drink,beach,nature,attraction'],
            'status' => ['nullable', 'string', 'in:published,draft'],
        ]);

        $maxSort = $business->media()->max('sort_order') ?? 0;
        $media = [];

        foreach ($request->file('images') as $image) {
            $media[] = $business->media()->create([
                'type' => 'Gallery',
                'title' => $validated['title'],
                'category' => $validated['category'] ?? 'restaurant',
                'file_path' => $image->store('businesses/gallery', 'public'),
                'caption' => $validated['caption'] ?? null,
                'sort_order' => ++$maxSort,
                'status' => $validated['status'] ?? 'published',
            ]);
        }

        return $this->createdResponse(BusinessMediaResource::collection($media), 'Gallery post published successfully.');
    }

    public function updateMedia(Request $request, BusinessMedia $businessMedia): JsonResponse
    {
        if ($businessMedia->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'title' => ['nullable', 'string', 'max:100'],
            'caption' => ['nullable', 'string', 'max:500'],
            'category' => ['nullable', 'string', 'in:food,restaurant,promotion,event,signature_dish,interior,dining_area,behind_the_scenes,new_menu,best_seller,dessert,drink,beach,nature,attraction'],
            'visibility' => ['nullable', 'string', 'in:public,hidden'],
            'status' => ['nullable', 'string', 'in:published,draft,archived'],
        ]);

        $businessMedia->update($validated);

        return $this->successResponse(
            BusinessMediaResource::make($businessMedia->fresh()),
            'Media updated successfully.'
        );
    }

    public function toggleFeatured(Request $request, BusinessMedia $businessMedia): JsonResponse
    {
        if ($businessMedia->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if (!$businessMedia->featured) {
            $featuredCount = $businessMedia->business->media()->where('featured', true)->count();
            if ($featuredCount >= 5) {
                return $this->errorResponse('Maximum of 5 featured gallery images allowed.', 422);
            }
        }

        $businessMedia->update(['featured' => !$businessMedia->featured]);

        return $this->successResponse(
            BusinessMediaResource::make($businessMedia->fresh()),
            $businessMedia->featured ? 'Media featured.' : 'Media unfeatured.'
        );
    }

    public function toggleVisibility(Request $request, BusinessMedia $businessMedia): JsonResponse
    {
        if ($businessMedia->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $newVisibility = $businessMedia->visibility === 'public' ? 'hidden' : 'public';
        $businessMedia->update(['visibility' => $newVisibility]);

        return $this->successResponse(
            BusinessMediaResource::make($businessMedia->fresh()),
            $newVisibility === 'public' ? 'Media is now visible.' : 'Media is now hidden.'
        );
    }

    public function uploadVideo(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'video' => ['required', 'file', 'mimes:mp4,mov,avi', 'max:102400'],
            'title' => ['required', 'string', 'max:100'],
            'caption' => ['nullable', 'string', 'max:500'],
            'category' => ['nullable', 'string', 'in:food,restaurant,promotion,event,signature_dish,interior,dining_area,behind_the_scenes,new_menu,best_seller,dessert,drink,beach,nature,attraction'],
            'status' => ['nullable', 'string', 'in:published,draft'],
        ]);

        $maxSort = $business->media()->max('sort_order') ?? 0;

        $media = $business->media()->create([
            'type' => 'Promotional Video',
            'title' => $validated['title'],
            'category' => $validated['category'] ?? 'promotion',
            'file_path' => $validated['video']->store('businesses/videos', 'public'),
            'caption' => $validated['caption'] ?? null,
            'sort_order' => ++$maxSort,
            'status' => $validated['status'] ?? 'published',
        ]);

        return $this->createdResponse(
            BusinessMediaResource::make($media),
            'Video uploaded successfully.'
        );
    }

    public function updateProfile(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'welcome_message' => ['nullable', 'string', 'max:1000'],
            'signature_dishes' => ['nullable', 'array'],
            'signature_dishes.*' => ['string', 'max:255'],
            'featured_banner' => ['nullable', 'string', 'max:500'],
            'featured_video' => ['nullable', 'string', 'max:500'],
        ]);

        $business->update($validated);

        return $this->successResponse(
            BusinessResource::make($business->fresh()->load('category', 'municipality', 'barangay')),
            'Restaurant profile updated successfully.'
        );
    }

    public function uploadLogo(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'logo' => ['required', 'file', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
        ]);

        if ($business->logo) {
            $oldPath = str_replace('/storage/', '', $business->logo);
            Storage::disk('public')->delete($oldPath);
        }

        $path = $validated['logo']->store('businesses/logos', 'public');
        $business->update(['logo' => Storage::url($path)]);

        return $this->successResponse(
            BusinessResource::make($business->fresh()->load('category', 'municipality', 'barangay')),
            'Logo uploaded successfully.'
        );
    }

    public function removeLogo(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($business->logo) {
            $path = str_replace('/storage/', '', $business->logo);
            Storage::disk('public')->delete($path);
            $business->update(['logo' => null]);
        }

        return $this->successResponse(
            BusinessResource::make($business->fresh()->load('category', 'municipality', 'barangay')),
            'Logo removed successfully.'
        );
    }

    public function uploadCoverPhoto(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'cover_photo' => ['required', 'file', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
        ]);

        if ($business->cover_photo) {
            $oldPath = str_replace('/storage/', '', $business->cover_photo);
            Storage::disk('public')->delete($oldPath);
        }

        $path = $validated['cover_photo']->store('businesses/covers', 'public');
        $business->update(['cover_photo' => Storage::url($path)]);

        return $this->successResponse(
            BusinessResource::make($business->fresh()->load('category', 'municipality', 'barangay')),
            'Cover photo uploaded successfully.'
        );
    }

    public function removeCoverPhoto(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($business->cover_photo) {
            $path = str_replace('/storage/', '', $business->cover_photo);
            Storage::disk('public')->delete($path);
            $business->update(['cover_photo' => null]);
        }

        return $this->successResponse(
            BusinessResource::make($business->fresh()->load('category', 'municipality', 'barangay')),
            'Cover photo removed successfully.'
        );
    }

    public function reviews(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $reviews = $business->reviews()
            ->with('user:id,name')
            ->where('status', 'approved')
            ->latest()
            ->limit(20)
            ->get()
            ->map(fn ($review) => [
                'id' => $review->id,
                'rating' => (int) $review->rating,
                'comment' => $review->review,
                'user_name' => $review->user?->name ?? 'Anonymous',
                'created_at' => $review->created_at?->toISOString(),
            ]);

        return $this->successResponse([
            'reviews' => $reviews,
            'average_rating' => round((float) $business->reviews()->where('status', 'approved')->avg('rating'), 1),
            'review_count' => (int) $business->reviews()->where('status', 'approved')->count(),
        ]);
    }

    public function deleteMedia(Request $request, BusinessMedia $businessMedia): JsonResponse
    {
        if ($businessMedia->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        Storage::disk('public')->delete($businessMedia->file_path);
        $businessMedia->delete();

        return $this->noContentResponse('Media archived successfully.');
    }

    public function verification(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $business->load('documents', 'statusLogs.reviewer', 'category.requiredDocuments');

        $statusLogs = $business->statusLogs->map(fn ($log) => [
            'id' => $log->id,
            'status' => $log->status,
            'remarks' => $log->remarks,
            'created_at' => $log->created_at,
        ]);

        $requiredDocuments = $business->category->requiredDocuments->map(fn ($doc) => [
            'type' => $doc->document_name,
            'uploaded' => $business->documents->contains('required_document_id', $doc->id),
        ]);

        $latestLog = $business->statusLogs->last();

        return $this->successResponse([
            'current_status' => $business->status,
            'remarks' => $latestLog?->remarks ?? '',
            'history' => $statusLogs,
            'required_documents' => $requiredDocuments,
        ]);
    }

    public function submitForReview(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($business->status !== 'under_review' && $business->status !== 'rejected') {
            return $this->errorResponse('Business is not eligible for submission.', 422);
        }

        $flaggedDocs = $business->documents()->where('flagged', true)->get();
        if ($flaggedDocs->isNotEmpty()) {
            $names = $flaggedDocs->pluck('document_number')->filter()->implode(', ');
            return $this->errorResponse(
                'Cannot submit: ' . $flaggedDocs->count() . ' document(s) flagged for data mismatch' .
                ($names ? ' (' . $names . ')' : '') .
                '. Please upload correct documents or wait for admin review.',
                422
            );
        }

        $business->update(['status' => 'pending']);

        $business->statusLogs()->create([
            'status' => 'pending',
            'remarks' => 'Business submitted for review by owner.',
        ]);

        return $this->successResponse(
            BusinessResource::make($business->fresh()),
            'Business submitted for review.'
        );
    }

    private function normalizeBusinessHours(array $hours): array
    {
        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        $normalized = [];
        foreach ($days as $day) {
            $periods = $hours[$day] ?? [];
            $cleaned = [];
            foreach ($periods as $period) {
                if (! is_array($period) || empty($period['open']) || empty($period['close'])) {
                    continue;
                }
                $cleaned[] = [
                    'open' => substr((string) $period['open'], 0, 5),
                    'close' => substr((string) $period['close'], 0, 5),
                ];
            }
            $normalized[$day] = $cleaned;
        }
        return $normalized;
    }

    private function normalizeDate(?string $date): ?string
    {
        if (!$date) return null;

        $date = trim($date);

        // Already YYYY-MM-DD
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return $date;
        }

        // Try parsing common formats
        $formats = [
            'F j, Y', 'j F Y', 'M j, Y', 'j M Y',
            'Y/m/d', 'm/d/Y', 'd/m/Y', 'Y.m.d',
            'd F Y', 'jS F Y', 'd M Y', 'jS M Y',
        ];

        foreach ($formats as $format) {
            $parsed = \DateTime::createFromFormat($format, $date);
            if ($parsed) {
                return $parsed->format('Y-m-d');
            }
        }

        // Try strtotime as fallback
        $ts = strtotime($date);
        if ($ts !== false) {
            return date('Y-m-d', $ts);
        }

        return null;
    }
}
