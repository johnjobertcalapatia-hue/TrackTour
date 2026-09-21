<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Http\Requests\Tourist\ToggleFavoriteRequest;
use App\Services\TouristService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class FavoriteController extends Controller
{
    public function __construct(private TouristService $touristService) {}

    public function index(Request $request)
    {
        $user = Auth::user();
        $favorites = $user->favorites()->with('favoritable')->get();

        if ($request->expectsJson()) {
            return $this->successResponse(compact('favorites'));
        }

        return response()->json($favorites);
    }

    public function toggle(ToggleFavoriteRequest $request): JsonResponse
    {
        $user = Auth::user();
        $result = $this->touristService->toggleFavorite(
            $user->id,
            $request->favoritable_type,
            $request->favoritable_id
        );

        return $this->successResponse([
            'favorited' => $result,
        ], $result ? 'Added to favorites.' : 'Removed from favorites.');
    }
}
