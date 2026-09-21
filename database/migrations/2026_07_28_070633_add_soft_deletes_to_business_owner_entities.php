<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', fn (Blueprint $t) => $t->softDeletes());
        Schema::table('orders', fn (Blueprint $t) => $t->softDeletes());
        Schema::table('bookings', fn (Blueprint $t) => $t->softDeletes());
        Schema::table('promotions', fn (Blueprint $t) => $t->softDeletes());
        Schema::table('offerings', fn (Blueprint $t) => $t->softDeletes());
    }

    public function down(): void
    {
        Schema::table('businesses', fn (Blueprint $t) => $t->dropSoftDeletes());
        Schema::table('orders', fn (Blueprint $t) => $t->dropSoftDeletes());
        Schema::table('bookings', fn (Blueprint $t) => $t->dropSoftDeletes());
        Schema::table('promotions', fn (Blueprint $t) => $t->dropSoftDeletes());
        Schema::table('offerings', fn (Blueprint $t) => $t->dropSoftDeletes());
    }
};
