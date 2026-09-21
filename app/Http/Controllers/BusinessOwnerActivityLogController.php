<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

class BusinessOwnerActivityLogController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        $activities = collect([]);

        return response()->json(compact('user', 'activities'));
    }
}
