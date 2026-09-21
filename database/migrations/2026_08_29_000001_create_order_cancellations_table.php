<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_cancellations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->string('cancelled_by')->nullable()->comment('User ID or "system"');
            $table->string('reason_code')->default('manual')->comment('restaurant_timeout | manual | rejected | etc');
            $table->text('reason')->nullable();
            $table->timestamp('cancelled_at');
            $table->string('refund_status')->default('pending')->comment('pending | succeeded | failed');
            $table->decimal('refund_amount', 10, 2)->default(0);
            $table->timestamp('refunded_at')->nullable();
            $table->timestamps();

            $table->index(['order_id', 'refund_status']);
            $table->index('reason_code');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_cancellations');
    }
};
