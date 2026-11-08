<?php

namespace App\Http\Controllers;

use App\Models\Offering;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

class BusinessOwnerMenuManageController extends Controller
{
    /**
     * Extra food photos and videos per menu item, besides the main `image` (8 in total).
     * Stored as storage paths in `offerings.images`; the tourist food page shows
     * the main image followed by these in its photo carousel.
     */
    public const MAX_GALLERY_IMAGES = 7;

    /** Photos: JPG/PNG/WebP up to 5 MB. Videos: MP4/MOV/WebM up to 20 MB. */
    private const GALLERY_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'];

    private const GALLERY_VIDEO_EXT = ['mp4', 'mov', 'webm'];

    private const GALLERY_IMAGE_MAX_KB = 5120;

    private const GALLERY_VIDEO_MAX_KB = 20480;

    /** 'video' or 'image', from the stored file's extension. */
    public static function galleryType(string $path): string
    {
        return in_array(strtolower(pathinfo($path, PATHINFO_EXTENSION)), self::GALLERY_VIDEO_EXT, true) ? 'video' : 'image';
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $offering = Offering::whereIn('business_id', $request->user()->businesses()->pluck('id'))->findOrFail($id);

        return $this->successResponse($this->present($offering));
    }

    /** Response shape: main image as a URL, plus `gallery` = [{ path, url }] for the extra photos. */
    private function present(Offering $offering): Offering
    {
        $offering->setAttribute('gallery', collect($offering->images ?? [])
            ->filter(fn ($path) => is_string($path) && $path !== '')
            ->values()
            ->map(fn (string $path) => ['path' => $path, 'url' => $this->resolveImageUrl($path), 'type' => self::galleryType($path)])
            ->all());
        $offering->image = $this->resolveImageUrl($offering->image);

        return $offering;
    }

    /**
     * Applies gallery changes from the request: removes the listed existing
     * photos (only ones that belong to this item) and appends new uploads.
     * Returns the new list, or null when nothing changed.
     *
     * @param  list<string>  $current
     * @return list<string>|null
     */
    private function applyGallery(Request $request, array $current): ?array
    {
        $request->validate([
            'gallery_images' => ['nullable', 'array', 'max:'.self::MAX_GALLERY_IMAGES],
            'gallery_images.*' => [
                'file',
                'mimes:'.implode(',', [...self::GALLERY_IMAGE_EXT, ...self::GALLERY_VIDEO_EXT]),
                'max:'.self::GALLERY_VIDEO_MAX_KB,
                function (string $attribute, $file, \Closure $fail) {
                    $isVideo = in_array(strtolower($file->getClientOriginalExtension()), self::GALLERY_VIDEO_EXT, true)
                        || str_starts_with((string) $file->getMimeType(), 'video/');
                    if (! $isVideo && $file->getSize() > self::GALLERY_IMAGE_MAX_KB * 1024) {
                        $fail('Each photo must be 5 MB or smaller.');
                    }
                },
            ],
            'remove_gallery' => ['nullable', 'array'],
            'remove_gallery.*' => ['string', 'max:500'],
        ]);

        $remove = array_values(array_intersect($current, (array) $request->input('remove_gallery', [])));
        $uploads = $request->file('gallery_images', []);
        if ($remove === [] && $uploads === []) {
            return null;
        }

        $kept = array_values(array_diff($current, $remove));
        if (count($kept) + count($uploads) > self::MAX_GALLERY_IMAGES) {
            throw ValidationException::withMessages([
                'gallery_images' => 'A menu item can have up to '.self::MAX_GALLERY_IMAGES.' more photos or videos besides the main image.',
            ]);
        }

        foreach ($uploads as $file) {
            $kept[] = $file->store('menu-items', 'public');
        }
        foreach ($remove as $path) {
            Storage::disk('public')->delete($path);
        }

        return $kept;
    }

    private function resolveImageUrl(?string $image): ?string
    {
        if (!$image) return null;
        if (str_starts_with($image, 'http://') || str_starts_with($image, 'https://')) {
            return $image;
        }
        return Storage::url($image);
    }

    public function store(Request $request): JsonResponse
    {
        $rules = [
            'business_id' => 'required|exists:businesses,id',
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'price' => 'required|numeric|min:0',
            'compare_price' => 'nullable|numeric|min:0',
            'offering_category_id' => 'nullable|integer|exists:offering_categories,id',
            'new_category' => 'nullable|string|max:255',
            'is_available' => 'boolean',
            'is_featured' => 'boolean',
            'stock' => 'nullable|integer|min:0',
            'unit' => 'nullable|string|max:50',
        ];

        if ($request->hasFile('image')) {
            $rules['image'] = 'nullable|file|mimes:jpg,jpeg,png,webp,gif,mp4,mov,avi|max:10240';
        } else {
            $rules['image'] = 'nullable|string|max:500';
        }

        $validated = $request->validate($rules);

        $business = $request->user()->businesses()->find($validated['business_id']);
        if (! $business) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if (! empty($validated['new_category'])) {
            $cat = $business->offeringCategories()->create(['name' => $validated['new_category']]);
            $validated['offering_category_id'] = $cat->id;
        }
        unset($validated['new_category']);

        if ($request->hasFile('image')) {
            $validated['image'] = $request->file('image')->store('menu-items', 'public');
        }

        $gallery = $this->applyGallery($request, []);
        if ($gallery !== null) {
            $validated['images'] = $gallery;
        }

        $validated['offering_type'] = 'menu';
        $validated['status'] = 'available';
        $validated['bestseller'] = $request->boolean('is_featured');
        unset($validated['is_featured']);
        $offering = Offering::create($validated);

        return $this->createdResponse($this->present($offering));
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $offering = Offering::whereIn('business_id', $request->user()->businesses()->pluck('id'))->findOrFail($id);

        $data = $request->only(['name', 'description', 'price', 'compare_price', 'offering_category_id', 'is_available', 'stock', 'unit']);
        $data = array_filter($data, fn ($value) => $value !== null);

        if ($request->has('new_category') && ! empty($request->input('new_category'))) {
            $cat = $offering->business->offeringCategories()->create(['name' => $request->input('new_category')]);
            $data['offering_category_id'] = $cat->id;
        }

        if ($request->has('is_featured')) {
            $data['bestseller'] = $request->boolean('is_featured');
        }

        if ($request->hasFile('image')) {
            $request->validate(['image' => 'nullable|file|mimes:jpg,jpeg,png,webp,gif,mp4,mov,avi|max:10240']);
            if ($offering->image) {
                Storage::disk('public')->delete($offering->image);
            }
            $data['image'] = $request->file('image')->store('menu-items', 'public');
        } elseif ($request->has('image')) {
            $data['image'] = $request->input('image');
        }

        $gallery = $this->applyGallery($request, array_values(array_filter((array) ($offering->images ?? []), 'is_string')));
        if ($gallery !== null) {
            $data['images'] = $gallery;
        }

        if (! empty($data)) {
            $offering->update($data);
        }

        return $this->successResponse($this->present($offering->fresh()));
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $offering = Offering::whereIn('business_id', $request->user()->businesses()->pluck('id'))->findOrFail($id);
        if ($offering->image) {
            Storage::disk('public')->delete($offering->image);
        }
        foreach ((array) ($offering->images ?? []) as $path) {
            if (is_string($path) && $path !== '') {
                Storage::disk('public')->delete($path);
            }
        }
        $offering->delete();
        return $this->noContentResponse('Menu item deleted.');
    }
}
