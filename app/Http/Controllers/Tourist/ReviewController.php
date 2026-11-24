<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Http\Requests\Tourist\CreateReviewRequest;
use App\Http\Resources\ReviewResource;
use App\Models\Review;
use App\Services\TouristReviewFeed;
use App\Services\TouristService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class ReviewController extends Controller
{
    public function __construct(private TouristService $touristService) {}

    /**
     * GET /tourist/reviews — My Reviews: everything this tourist has reviewed,
     * grouped by what was reviewed (food, restaurants, riders, resorts,
     * attractions), with a count per group. See TouristReviewFeed.
     */
    public function index(Request $request, TouristReviewFeed $feed)
    {
        if ($request->expectsJson()) {
            return $this->successResponse($feed->for($request->user()));
        }

        return response()->json([
            'reviews' => $request->user()->reviews()->with('business')->latest()->paginate(12),
        ]);
    }

    public function store(CreateReviewRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $validated['user_id'] = Auth::id();
        $validated['status'] = 'pending';
        $validated['would_recommend'] = $request->boolean('would_recommend', true);

        $review = Review::create($validated);

        return $this->createdResponse(
            ReviewResource::make($review->load('business')),
            'Thank you! Your review has been submitted and is pending approval.'
        );
    }
}
