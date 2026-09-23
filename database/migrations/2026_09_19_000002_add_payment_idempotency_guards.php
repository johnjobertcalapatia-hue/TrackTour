<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // One DB row can never reference the same PayMongo checkout session or
        // payment twice, so a provider retry after a timeout / HTTP 5xx /
        // duplicate delivery can never create a second payment record that
        // aliases the same provider intent. NULLs are allowed (COD cash rows,
        // local-credit rows) and never collide.
        $paymentIndexes = collect(Schema::getIndexes('payments'))->pluck('name');
        Schema::table('payments', function (Blueprint $table) use ($paymentIndexes) {
            if (! $paymentIndexes->contains('payments_provider_payment_id_unique')) {
                $table->unique('provider_payment_id');
            }
            if (! $paymentIndexes->contains('payments_provider_source_id_unique')) {
                $table->unique('provider_source_id');
            }
        });

        // Processed-webhook-event ledger. provider_event_id is the stable
        // PayMongo event ID (data.id); the UNIQUE constraint is the DB-level
        // "already processed" backstop that repeated/concurrent delivery of the
        // same webhook has to beat before any financial transition can run.
        if (! Schema::hasTable('payment_webhook_events')) {
            Schema::create('payment_webhook_events', function (Blueprint $table) {
                $table->id();
                $table->string('provider_event_id', 255);
                $table->string('event_type', 64);
                $table->unsignedBigInteger('payment_id')->nullable();
                $table->json('payload')->nullable();
                $table->timestamp('processed_at')->nullable();
                $table->timestamps();

                $table->unique('provider_event_id');
                $table->index('payment_id');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_webhook_events');

        Schema::table('payments', function (Blueprint $table) {
            $table->dropUnique(['provider_payment_id']);
            $table->dropUnique(['provider_source_id']);
        });
    }
};