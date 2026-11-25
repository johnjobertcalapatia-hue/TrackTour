<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\Municipality;
use App\Models\TourismSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminMapController extends Controller
{
    /**
     * Map pins. /admin: every municipality. /municipal (Municipal Office plan
     * Stage 2, `municipal.scope` sets the `municipality` attribute): only the
     * officer's businesses and its own town marker.
     */
    public function index(Request $request): JsonResponse
    {
        $town = $request->attributes->get('municipality');

        $businesses = Business::query()
            ->when($town, fn ($q) => $q->where('municipality_id', $town->id))
            ->with(['category:id,name', 'municipality:id,name'])
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->get()
            ->map(fn ($b) => [
                'id' => $b->id,
                'name' => $b->business_name,
                'lat' => (float) $b->latitude,
                'lng' => (float) $b->longitude,
                'address' => $b->address,
                'category' => $b->category?->name,
                'status' => $b->status,
                'municipality' => $b->municipality?->name,
                'cover_photo' => $b->cover_photo,
                'logo' => $b->logo,
                // open | closed | temporarily_closed | no_hours (attractions often set no hours).
                'open_status' => $this->openStatus($b),
            ]);

        // Town markers for the zoomed-out view: each municipality at its own
        // coordinates with its logo. Bansud (home of the office) falls back to
        // the logo uploaded on Office Profile.
        $officeLogo = TourismSetting::query()->whereNull('municipality_id')->where('key', 'office_logo')->value('value');
        $municipalities = Municipality::query()
            ->when($town, fn ($q) => $q->whereKey($town->id))
            ->orderBy('name')
            ->get(['id', 'name', 'latitude', 'longitude', 'logo'])
            ->map(fn (Municipality $m) => [
                'id' => $m->id,
                'name' => $m->name,
                'lat' => $m->latitude !== null ? (float) $m->latitude : null,
                'lng' => $m->longitude !== null ? (float) $m->longitude : null,
                'logo' => $m->logo ?: ($m->isHome() ? ($officeLogo ?: null) : null),
            ]);

        return response()->json([
            'success' => true,
            'data' => [
                'businesses' => $businesses,
                'municipalities' => $municipalities,
            ],
        ]);
    }

    /** @return array{status: string, label: string} */
    private function openStatus(Business $b): array
    {
        $hasHours = (is_array($b->business_hours) && array_filter($b->business_hours) !== [])
            || ($b->opening_time && $b->closing_time);
        if (! $b->force_closed && ! $hasHours && ! $b->isTouristAttraction()) {
            return ['status' => 'no_hours', 'label' => 'Hours not set'];
        }

        return $b->openStatusLabel();
    }
}
