<?php

use Illuminate\Support\Facades\Route;

Route::view('/', 'app')->name('home');

Route::view('/{any}', 'app')
    ->where('any', '^(?!api).*$')
    ->name('spa');
