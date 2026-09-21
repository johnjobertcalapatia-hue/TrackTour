<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('paid_amount', 12, 2)->default(0)->after('total');
        });

        Schema::table('bookings', function (Blueprint $table) {
            $table->unsignedBigInteger('user_id')->nullable()->after('business_id');
            $table->string('payment_status')->default('pending')->after('paid_amount');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('paid_amount');
        });

        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn(['user_id', 'payment_status']);
        });
    }
};
