<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Secure transaction architecture, Stage 4 (ride hailing): observe-only trip
 * location evidence on the existing deliveries table. One entry per step
 * (passenger_on_board, arrived_destination, completed), written once; each
 * keeps the device fix and the server-saved fix apart. The immutable copy is
 * the matching "trip_evidence" transaction ledger event. No PIN (decision).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->json('trip_evidence')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropColumn('trip_evidence');
        });
    }
};
