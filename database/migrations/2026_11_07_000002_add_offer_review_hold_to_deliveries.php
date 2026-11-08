<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Exclusive offer review hold: while one rider has an offer open, no other
 * rider can view its details or accept it, until the hold is released,
 * expires, or the reviewer accepts (OfferReviewService). Enforced inside the
 * delivery row lock of every accept path (NearestRiderService).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('deliveries', 'review_rider_id')) {
            Schema::table('deliveries', function (Blueprint $table) {
                $table->foreignId('review_rider_id')->nullable()->after('rider_id')
                    ->constrained('users')->nullOnDelete();
                $table->timestamp('review_expires_at')->nullable()->after('review_rider_id');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('deliveries', 'review_rider_id')) {
            Schema::table('deliveries', function (Blueprint $table) {
                $table->dropConstrainedForeignId('review_rider_id');
                $table->dropColumn('review_expires_at');
            });
        }
    }
};
