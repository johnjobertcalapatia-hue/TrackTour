<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->string('tagline')->nullable()->after('business_description');
            $table->string('price_range')->nullable()->after('tagline')->comment('budget, affordable, mid_range, premium, luxury');
            $table->string('landmark')->nullable()->after('address');
            $table->text('navigation_instructions')->nullable()->after('landmark');
            $table->string('dining_style')->nullable()->after('closing_time')->comment('JSON array: dine_in, take_out, delivery, drive_thru, buffet, fine_dining, casual_dining');
            $table->boolean('accepts_reservation')->default(false)->after('dining_style');
            $table->boolean('reservation_required')->default(false)->after('accepts_reservation');
            $table->unsignedSmallInteger('average_wait_time')->nullable()->after('reservation_required')->comment('minutes');
            $table->json('facilities')->nullable()->after('average_wait_time')->comment('JSON array of facility codes');
            $table->json('services')->nullable()->after('facilities')->comment('JSON array of service codes');
            $table->json('payment_methods')->nullable()->after('services')->comment('JSON array: cash, gcash, maya, credit_card, debit_card, bank_transfer');
            $table->unsignedInteger('popularity_score')->default(0)->after('payment_methods');
            $table->unsignedInteger('booking_count')->default(0)->after('popularity_score');
            $table->unsignedInteger('favorite_count')->default(0)->after('booking_count');
            $table->unsignedInteger('review_count')->default(0)->after('favorite_count');
            $table->decimal('average_rating', 3, 2)->default(0)->after('review_count');
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn([
                'tagline', 'price_range', 'landmark', 'navigation_instructions',
                'dining_style', 'accepts_reservation', 'reservation_required',
                'average_wait_time', 'facilities', 'services', 'payment_methods',
                'popularity_score', 'booking_count', 'favorite_count', 'review_count', 'average_rating',
            ]);
        });
    }
};
