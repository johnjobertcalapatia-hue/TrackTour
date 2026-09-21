<?php

namespace App\Http\Controllers\TourismOffice;

use App\Http\Controllers\Controller;
use App\Models\TourismSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LandingContentController extends Controller
{
    private const DEFAULTS = [
        'landing_hero_badge' => 'Bansud, Oriental Mindoro',
        'landing_hero_title' => 'Discover the Beauty of',
        'landing_hero_title_highlight' => 'Oriental Mindoro',
        'landing_hero_subtitle' => 'Book hotels, reserve activities, order food, and request transportation — all from one platform.',
        'landing_hero_video' => '/assets/tracktour-web.mp4',
    ];

    private const CATEGORIES = [
        ['label' => 'Tourist Spots', 'color' => '#087F3F', 'image' => 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=60', 'tab' => 'places'],
        ['label' => 'Food', 'color' => '#D97706', 'image' => 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?auto=format&fit=crop&w=600&q=60', 'tab' => 'food'],
        ['label' => 'Businesses', 'color' => '#2563EB', 'image' => 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=600&q=60', 'tab' => 'businesses'],
        ['label' => 'Resorts', 'color' => '#7C3AED', 'image' => 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=60', 'tab' => 'stays'],
    ];

    private const SPOTS = [
        ['title' => 'White Beach', 'location' => 'Puerto Galera', 'rating' => 4.8, 'category' => 'Beach'],
        ['title' => 'Tamaraw Falls', 'location' => 'Puerto Galera', 'rating' => 4.6, 'category' => 'Nature'],
        ['title' => 'Apo Reef', 'location' => 'Sablayan', 'rating' => 4.9, 'category' => 'Diving'],
        ['title' => 'Mt. Halcon', 'location' => 'Baco', 'rating' => 4.7, 'category' => 'Adventure'],
        ['title' => 'Bulalacao Beaches', 'location' => 'Bulalacao', 'rating' => 4.5, 'category' => 'Beach'],
        ['title' => 'Mangyan Village', 'location' => 'Oriental Mindoro', 'rating' => 4.3, 'category' => 'Culture'],
    ];

    /**
     * Public landing page content used by guests without auth.
     */
    public function content(): JsonResponse
    {
        return $this->successResponse($this->contentData(), 'Landing content retrieved successfully.');
    }

    /**
     * Alias used by the tourism office to load the editable settings.
     */
    public function index(): JsonResponse
    {
        return $this->content();
    }

    /**
     * Update landing page content. Supports a video file upload or a
     * video URL for the hero, plus JSON strings for categories/spots.
     */
    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'hero_badge' => 'nullable|string|max:255',
            'hero_title' => 'nullable|string|max:255',
            'hero_title_highlight' => 'nullable|string|max:255',
            'hero_subtitle' => 'nullable|string|max:2000',
            'hero_video' => 'nullable|file|mimes:mp4,mov,m4v,webm|max:204800',
            'hero_video_url' => 'nullable|string|max:500',
            'categories_json' => 'nullable|string',
            'spots_json' => 'nullable|string',
        ], [
            'hero_video.max' => 'The hero video may not exceed 200MB.',
        ]);

        $settings = [];

        if (array_key_exists('hero_badge', $validated)) {
            $settings['landing_hero_badge'] = (string) $validated['hero_badge'];
        }

        if (array_key_exists('hero_title', $validated)) {
            $settings['landing_hero_title'] = (string) $validated['hero_title'];
        }

        if (array_key_exists('hero_title_highlight', $validated)) {
            $settings['landing_hero_title_highlight'] = (string) $validated['hero_title_highlight'];
        }

        if (array_key_exists('hero_subtitle', $validated)) {
            $settings['landing_hero_subtitle'] = (string) $validated['hero_subtitle'];
        }

        if ($request->hasFile('hero_video')) {
            $path = $request->file('hero_video')->store('assets/videos', 'public');
            $settings['landing_hero_video'] = '/storage/'.$path;
        } elseif ($request->filled('hero_video_url')) {
            $settings['landing_hero_video'] = (string) $request->input('hero_video_url');
        }

        if ($request->filled('categories_json')) {
            $decoded = json_decode((string) $request->input('categories_json'), true);
            if (is_array($decoded) && array_is_list($decoded)) {
                $settings['landing_categories'] = json_encode($decoded);
            }
        }

        if ($request->filled('spots_json')) {
            $decoded = json_decode((string) $request->input('spots_json'), true);
            if (is_array($decoded) && array_is_list($decoded)) {
                $settings['landing_spots'] = json_encode($decoded);
            }
        }

        foreach ($settings as $key => $value) {
            TourismSetting::updateOrCreate(
                ['municipality_id' => null, 'key' => $key],
                ['value' => $value]
            );
        }

        return $this->successResponse($this->contentData(), 'Landing content updated successfully.');
    }

    protected function contentData(): array
    {
        $stored = TourismSetting::whereIn('key', $this->keys())
            ->whereNull('municipality_id')
            ->pluck('value', 'key')
            ->toArray();

        return [
            'hero_badge' => $stored['landing_hero_badge'] ?? self::DEFAULTS['landing_hero_badge'],
            'hero_title' => $stored['landing_hero_title'] ?? self::DEFAULTS['landing_hero_title'],
            'hero_title_highlight' => $stored['landing_hero_title_highlight'] ?? self::DEFAULTS['landing_hero_title_highlight'],
            'hero_subtitle' => $stored['landing_hero_subtitle'] ?? self::DEFAULTS['landing_hero_subtitle'],
            'hero_video' => $stored['landing_hero_video'] ?? self::DEFAULTS['landing_hero_video'],
            'categories' => $this->decodeSetting($stored, 'landing_categories', self::CATEGORIES),
            'spots' => $this->decodeSetting($stored, 'landing_spots', self::SPOTS),
        ];
    }

    protected function decodeSetting(array $stored, string $key, array $default): array
    {
        if (empty($stored[$key])) {
            return $default;
        }

        $decoded = json_decode((string) $stored[$key], true);

        return is_array($decoded) && array_is_list($decoded) ? $decoded : $default;
    }

    protected function keys(): array
    {
        return [
            'landing_hero_badge',
            'landing_hero_title',
            'landing_hero_title_highlight',
            'landing_hero_subtitle',
            'landing_hero_video',
            'landing_categories',
            'landing_spots',
        ];
    }
}