<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Opt-in tourist location sharing with the Bansud Tourism Office (admin live
 * map). One row per tourist: their consent and ONLY their latest position —
 * no history. Turning sharing off clears the position; positions older than
 * an hour are wiped by `tourist-locations:prune`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tourist_location_shares', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->boolean('enabled')->default(false);
            $table->timestamp('consented_at')->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->decimal('accuracy_m', 8, 1)->nullable();
            $table->timestamp('location_at')->nullable()->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tourist_location_shares');
    }
};
