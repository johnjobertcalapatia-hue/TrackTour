<?php

use Illuminate\Support\Facades\Route;

Route::get('/', static fn () => response()->json([
    'service' => 'TrackTour API',
]))->name('home');
