<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->timestamp('acceptance_started_at')->nullable()->after('cancelled_at');
            $table->timestamp('acceptance_deadline')->nullable()->after('acceptance_started_at');

            $table->string('refund_status')->default('none')->after('refunded_amount')->comment('none | pending | processing | refunded | failed');
            $table->decimal('refund_amount', 12, 2)->default(0)->after('refund_status');
            $table->string('paymongo_refund_id')->nullable()->after('refund_amount');
            $table->timestamp('refund_requested_at')->nullable()->after('paymongo_refund_id');
            $table->timestamp('refunded_at')->nullable()->after('refund_requested_at');
            $table->text('refund_failure_reason')->nullable()->after('refunded_at');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn([
                'acceptance_started_at',
                'acceptance_deadline',
                'refund_status',
                'refund_amount',
                'paymongo_refund_id',
                'refund_requested_at',
                'refunded_at',
                'refund_failure_reason',
            ]);
        });
    }
};
