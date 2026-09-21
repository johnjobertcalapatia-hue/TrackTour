<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->integer('cancelled_quantity')->default(0)->after('subtotal');
            $table->unsignedBigInteger('cancelled_by')->nullable()->after('cancelled_quantity');
            $table->string('cancellation_reason')->nullable()->after('cancelled_by');
            $table->timestamp('cancelled_at')->nullable()->after('cancellation_reason');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropColumn(['cancelled_quantity', 'cancelled_by', 'cancellation_reason', 'cancelled_at']);
        });
    }
};
