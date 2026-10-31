<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_cash_funds', function (Blueprint $table) {
            $table->id();
            $table->string('fund_number', 40)->unique();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('municipality_id')->constrained('municipalities')->restrictOnDelete();
            $table->string('status', 16)->default('open');
            $table->unsignedBigInteger('active_rider_key')->nullable()->unique();
            $table->foreignId('opened_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('opened_at');
            $table->timestamp('closed_at')->nullable();
            $table->timestamps();

            $table->index(['rider_id', 'status']);
        });

        Schema::create('cod_purchase_expenses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('cod_purchase_id')->constrained('cod_purchases')->cascadeOnDelete();
            $table->unsignedInteger('revision');
            $table->decimal('actual_purchase_amount', 12, 2);
            $table->decimal('tourism_office_cash_used', 12, 2);
            $table->decimal('rider_personal_contribution', 12, 2);
            $table->string('receipt_path');
            $table->string('status', 16)->default('submitted');
            $table->foreignId('submitted_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('submitted_at');
            $table->foreignId('verified_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('verified_at')->nullable();
            $table->text('rejection_reason')->nullable();
            $table->timestamps();

            $table->unique(['cod_purchase_id', 'revision']);
            $table->index(['status', 'submitted_at']);
        });

        Schema::create('rider_cash_fund_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_cash_fund_id')->constrained('rider_cash_funds')->cascadeOnDelete();
            $table->string('reference_number', 64)->unique();
            $table->string('idempotency_key', 64)->nullable()->unique();
            $table->string('type', 40);
            $table->decimal('amount', 12, 2);
            $table->timestamp('occurred_at');
            $table->foreignId('delivery_id')->nullable()->constrained('deliveries')->nullOnDelete();
            $table->foreignId('cod_purchase_id')->nullable()->constrained('cod_purchases')->nullOnDelete();
            $table->foreignId('cod_purchase_expense_id')->nullable()->constrained('cod_purchase_expenses')->cascadeOnDelete();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('received_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('received_at')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->unique(['cod_purchase_expense_id', 'type'], 'rider_cash_fund_expense_type_unique');
            $table->index(['rider_cash_fund_id', 'type']);
        });

        Schema::table('deliveries', function (Blueprint $table) {
            $table->foreignId('rider_cash_fund_id')->nullable()->after('purchasing_cash_received_at')
                ->constrained('rider_cash_funds')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropConstrainedForeignId('rider_cash_fund_id');
        });

        Schema::dropIfExists('rider_cash_fund_transactions');
        Schema::dropIfExists('cod_purchase_expenses');
        Schema::dropIfExists('rider_cash_funds');
    }
};
