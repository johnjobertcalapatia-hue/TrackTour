<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tourist;
use Illuminate\Http\Request;

class TouristController extends Controller
{
    public function index()
    {
        $tourists = Tourist::with('user')->paginate(15);

        return response()->json($tourists);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'user_id' => 'nullable|exists:users,id',
            'first_name' => 'required|string|max:255',
            'last_name' => 'required|string|max:255',
            'dob' => 'nullable|date',
            'nationality' => 'nullable|string|max:255',
            'bio' => 'nullable|string',
            'preferences' => 'nullable|array',
        ]);

        $tourist = Tourist::create($data);

        return response()->json($tourist, 201);
    }

    public function show(Tourist $tourist)
    {
        return response()->json($tourist->load('user'));
    }

    public function update(Request $request, Tourist $tourist)
    {
        $data = $request->validate([
            'first_name' => 'sometimes|required|string|max:255',
            'last_name' => 'sometimes|required|string|max:255',
            'dob' => 'nullable|date',
            'nationality' => 'nullable|string|max:255',
            'bio' => 'nullable|string',
            'preferences' => 'nullable|array',
        ]);

        $tourist->update($data);

        return response()->json($tourist);
    }

    public function destroy(Tourist $tourist)
    {
        $tourist->delete();

        return response()->json(null, 204);
    }
}
