<?php

namespace App\Http\Controllers\Api;

use App\Enums\DiscoveryGroup;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\Municipality;
use App\Models\TouristDestination;
use App\Traits\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;

/**
 * GET /api/municipalities/{municipality}/photos
 *
 * Real photos of one municipality for the tourist UI (sidebar "Discover"
 * card, Home hero carousel, "Plan your getaway" card). Order:
 *   1. the municipality's own cover photo
 *   2. its attractions (active destinations + approved spot businesses)
 *   3. cover photos of its other approved businesses (stays, restaurants…)
 * Each source contributes at most one photo per place so the set shows
 * variety. Returns [] when the municipality has no photos; the client then
 * keeps its default artwork.
 */
class MunicipalityPhotosController extends Controller
{
    use ApiResponse;

    public const LIMIT = 8;

    public function __invoke(Municipality $municipality): JsonResponse
    {
        $photos = collect();
        $add = function (?string $path, string $caption, string $kind) use ($photos) {
            if (! filled($path)) {
                return;
            }
            $photos->push(['src' => self::url($path), 'caption' => $caption, 'kind' => $kind]);
        };

        $add($municipality->cover_photo, $municipality->name, 'municipality');

        TouristDestination::query()
            ->where('municipality_id', $municipality->id)
            ->where('status', 'active')
            ->orderBy('name')
            ->get(['id', 'name', 'images'])
            ->each(fn (TouristDestination $d) => $add(collect($d->images ?? [])->first(), $d->name, 'attraction'));

        $spots = Business::query()
            ->where('municipality_id', $municipality->id)
            ->where('status', 'approved')
            ->whereHas('category', fn ($q) => $q->inDiscoveryGroup(DiscoveryGroup::Spot))
            ->with(['media' => fn ($q) => $q->whereIn('type', ['Gallery', 'Logo'])->orderBy('sort_order')])
            ->orderByDesc('popularity_score')
            ->get();

        $spots->each(fn (Business $b) => $add($b->cover_photo ?: $b->media->first()?->file_path, $b->name, 'attraction'));

        Business::query()
            ->where('municipality_id', $municipality->id)
            ->where('status', 'approved')
            ->whereNotIn('id', $spots->pluck('id'))
            ->whereNotNull('cover_photo')
            ->orderByDesc('popularity_score')
            ->limit(self::LIMIT)
            ->get()
            ->each(fn (Business $b) => $add($b->cover_photo, $b->name, 'business'));

        return $this->successResponse(
            $photos->unique('src')->take(self::LIMIT)->values()->all(),
            'Municipality photos retrieved.'
        );
    }

    private static function url(string $path): string
    {
        if (preg_match('#^https?://#', $path) || str_starts_with($path, '/')) {
            return $path;
        }

        return Storage::url($path);
    }
}
