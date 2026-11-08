<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Proof of delivery (rider trip flow, decision 2026-11-08): the rider must be
 * within the drop-off radius and upload a photo of the delivered food to
 * complete a food delivery. Confirming also records the COD cash as received.
 * The tourist no longer confirms receipt.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('deliveries', 'delivery_proof_path')) {
            Schema::table('deliveries', function (Blueprint $table) {
                $table->string('delivery_proof_path')->nullable()->after('delivery_confirmed_by');
                $table->timestamp('delivery_proof_at')->nullable()->after('delivery_proof_path');
                $table->decimal('delivery_proof_distance_m', 8, 1)->nullable()->after('delivery_proof_at');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('deliveries', 'delivery_proof_path')) {
            Schema::table('deliveries', function (Blueprint $table) {
                $table->dropColumn(['delivery_proof_path', 'delivery_proof_at', 'delivery_proof_distance_m']);
            });
        }
    }
};
