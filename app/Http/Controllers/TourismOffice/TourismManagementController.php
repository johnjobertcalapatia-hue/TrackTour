<?php

namespace App\Http\Controllers\TourismOffice;

use App\Http\Controllers\Controller;
use App\Models\TouristDestination;
use App\Models\TourismAnnouncement;
use App\Models\TourismCategory;
use App\Models\TourismEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class TourismManagementController extends Controller
{
    // ─── Dashboard ──────────────────────────────────────────────────

    public function dashboard(): JsonResponse
    {
        return $this->successResponse([
            'stats' => [
                'total_destinations' => TouristDestination::count(),
                'active_destinations' => TouristDestination::where('status', 'active')->count(),
                'total_events' => TourismEvent::count(),
                'upcoming_events' => TourismEvent::where('start_date', '>=', now())->count(),
                'total_announcements' => TourismAnnouncement::count(),
                'published_announcements' => TourismAnnouncement::where('status', 'published')->count(),
            ],
        ]);
    }

    // ─── Destinations ───────────────────────────────────────────────

    public function indexDestinations(Request $request): JsonResponse
    {
        $query = TouristDestination::with('category', 'municipality');

        if ($request->has('search') && $request->search) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('address', 'like', "%{$search}%");
            });
        }

        if ($request->has('category_id') && $request->category_id) {
            $query->where('category_id', $request->category_id);
        }

        if ($request->has('status') && $request->status) {
            $query->where('status', $request->status);
        }

        $destinations = $query->orderByDesc('created_at')->paginate(15);

        return $this->successResponse($destinations);
    }

    public function showDestination(int $id): JsonResponse
    {
        $destination = TouristDestination::with('category', 'municipality')->findOrFail($id);

        return $this->successResponse($destination);
    }

    public function storeDestination(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'required|string',
            'address' => 'required|string|max:500',
            'latitude' => 'required|numeric|between:-90,90',
            'longitude' => 'required|numeric|between:-180,180',
            'category_id' => 'required|exists:tourism_categories,id',
            'municipality_id' => 'required|exists:municipalities,id',
            'opening_hours' => 'nullable|string|max:255',
            'entrance_fee' => 'nullable|numeric|min:0',
            'contact_number' => 'nullable|string|max:20',
            'images' => 'nullable|array',
            'images.*' => 'url|max:2000',
            'amenities' => 'nullable|array',
            'amenities.*' => 'string|max:100',
            'status' => 'nullable|string|in:active,inactive,draft',
        ]);

        $validated['slug'] = Str::slug($validated['name']);
        $validated['status'] = $validated['status'] ?? 'draft';

        $destination = TouristDestination::create($validated);

        return $this->successResponse(
            $destination->load('category', 'municipality'),
            'Destination created.',
            201
        );
    }

    public function updateDestination(Request $request, int $id): JsonResponse
    {
        $destination = TouristDestination::findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'description' => 'sometimes|required|string',
            'address' => 'sometimes|required|string|max:500',
            'latitude' => 'sometimes|required|numeric|between:-90,90',
            'longitude' => 'sometimes|required|numeric|between:-180,180',
            'category_id' => 'sometimes|required|exists:tourism_categories,id',
            'municipality_id' => 'sometimes|required|exists:municipalities,id',
            'opening_hours' => 'nullable|string|max:255',
            'entrance_fee' => 'nullable|numeric|min:0',
            'contact_number' => 'nullable|string|max:20',
            'images' => 'nullable|array',
            'images.*' => 'url|max:2000',
            'amenities' => 'nullable|array',
            'amenities.*' => 'string|max:100',
            'status' => 'nullable|string|in:active,inactive,draft',
        ]);

        if (isset($validated['name'])) {
            $validated['slug'] = Str::slug($validated['name']);
        }

        $destination->update($validated);

        return $this->successResponse(
            $destination->fresh()->load('category', 'municipality'),
            'Destination updated.'
        );
    }

    public function destroyDestination(int $id): JsonResponse
    {
        TouristDestination::findOrFail($id)->delete();

        return $this->successResponse(null, 'Destination deleted.');
    }

    // ─── Events ─────────────────────────────────────────────────────

    public function indexEvents(Request $request): JsonResponse
    {
        $query = TourismEvent::with('municipality');

        if ($request->has('search') && $request->search) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('location', 'like', "%{$search}%");
            });
        }

        if ($request->has('status') && $request->status) {
            $query->where('status', $request->status);
        }

        $events = $query->orderByDesc('start_date')->paginate(15);

        return $this->successResponse($events);
    }

    public function showEvent(int $id): JsonResponse
    {
        $event = TourismEvent::with('municipality')->findOrFail($id);

        return $this->successResponse($event);
    }

    public function storeEvent(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'required|string',
            'location' => 'required|string|max:500',
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
            'municipality_id' => 'required|exists:municipalities,id',
            'image' => 'nullable|url|max:2000',
            'status' => 'nullable|string|in:upcoming,ongoing,completed,cancelled',
        ]);

        $validated['status'] = $validated['status'] ?? 'upcoming';

        $event = TourismEvent::create($validated);

        return $this->successResponse(
            $event->load('municipality'),
            'Event created.',
            201
        );
    }

    public function updateEvent(Request $request, int $id): JsonResponse
    {
        $event = TourismEvent::findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'description' => 'sometimes|required|string',
            'location' => 'sometimes|required|string|max:500',
            'start_date' => 'sometimes|required|date',
            'end_date' => 'sometimes|required|date|after_or_equal:start_date',
            'municipality_id' => 'sometimes|required|exists:municipalities,id',
            'image' => 'nullable|url|max:2000',
            'status' => 'nullable|string|in:upcoming,ongoing,completed,cancelled',
        ]);

        $event->update($validated);

        return $this->successResponse(
            $event->fresh()->load('municipality'),
            'Event updated.'
        );
    }

    public function destroyEvent(int $id): JsonResponse
    {
        TourismEvent::findOrFail($id)->delete();

        return $this->successResponse(null, 'Event deleted.');
    }

    // ─── Announcements ──────────────────────────────────────────────

    public function indexAnnouncements(Request $request): JsonResponse
    {
        $query = TourismAnnouncement::with('municipality');

        if ($request->has('search') && $request->search) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                  ->orWhere('content', 'like', "%{$search}%");
            });
        }

        if ($request->has('status') && $request->status) {
            $query->where('status', $request->status);
        }

        if ($request->has('type') && $request->type) {
            $query->where('type', $request->type);
        }

        $announcements = $query->orderByDesc('published_at')->paginate(15);

        return $this->successResponse($announcements);
    }

    public function showAnnouncement(int $id): JsonResponse
    {
        $announcement = TourismAnnouncement::with('municipality')->findOrFail($id);

        return $this->successResponse($announcement);
    }

    public function storeAnnouncement(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => 'required|string|max:255',
            'content' => 'required|string',
            'type' => 'required|string|in:general,emergency,event,weather,health,safety',
            'municipality_id' => 'required|exists:municipalities,id',
            'status' => 'nullable|string|in:draft,published,archived',
            'published_at' => 'nullable|date',
        ]);

        $validated['status'] = $validated['status'] ?? 'draft';
        if ($validated['status'] === 'published' && empty($validated['published_at'])) {
            $validated['published_at'] = now();
        }

        $announcement = TourismAnnouncement::create($validated);

        return $this->successResponse(
            $announcement->load('municipality'),
            'Announcement created.',
            201
        );
    }

    public function updateAnnouncement(Request $request, int $id): JsonResponse
    {
        $announcement = TourismAnnouncement::findOrFail($id);

        $validated = $request->validate([
            'title' => 'sometimes|required|string|max:255',
            'content' => 'sometimes|required|string',
            'type' => 'sometimes|required|string|in:general,emergency,event,weather,health,safety',
            'municipality_id' => 'sometimes|required|exists:municipalities,id',
            'status' => 'nullable|string|in:draft,published,archived',
            'published_at' => 'nullable|date',
        ]);

        if (isset($validated['status']) && $validated['status'] === 'published' && empty($validated['published_at'])) {
            $validated['published_at'] = $announcement->published_at ?? now();
        }

        $announcement->update($validated);

        return $this->successResponse(
            $announcement->fresh()->load('municipality'),
            'Announcement updated.'
        );
    }

    public function destroyAnnouncement(int $id): JsonResponse
    {
        TourismAnnouncement::findOrFail($id)->delete();

        return $this->successResponse(null, 'Announcement deleted.');
    }

    // ─── Categories ─────────────────────────────────────────────────

    public function indexCategories(): JsonResponse
    {
        $categories = TourismCategory::orderBy('name')->get();

        return $this->successResponse($categories);
    }

    public function storeCategory(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255|unique:tourism_categories,name',
            'description' => 'nullable|string|max:500',
            'icon' => 'nullable|string|max:100',
        ]);

        $validated['slug'] = Str::slug($validated['name']);

        $category = TourismCategory::create($validated);

        return $this->successResponse($category, 'Category created.', 201);
    }

    public function destroyCategory(int $id): JsonResponse
    {
        TourismCategory::findOrFail($id)->delete();

        return $this->successResponse(null, 'Category deleted.');
    }
}
