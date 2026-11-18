<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Rider onboarding, phase 2: trainer/interviewer availability drives the
 * automatic schedule; evaluation checklists; final approval per service.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Application status, kept separate from the account status.
        Schema::table('rider_details', function (Blueprint $table) {
            $table->string('application_status', 30)->nullable()->after('application_submitted_at')->index();
        });

        // Requirement checklist recorded with the interview.
        Schema::table('rider_interviews', function (Blueprint $table) {
            $table->json('checklist')->nullable()->after('documents_verified');
        });

        // Per-item training results (orientation, safety, …).
        Schema::table('rider_training_assessments', function (Blueprint $table) {
            $table->json('items')->nullable()->after('result');
        });

        // A row overrides the default (working days available) for one date.
        Schema::create('rider_training_availability', function (Blueprint $table) {
            $table->id();
            $table->foreignId('municipality_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->boolean('trainer_available')->default(true);
            $table->boolean('interviewer_available')->default(true);
            $table->string('notes', 255)->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['municipality_id', 'date']);
        });

        // Final, per-service eligibility decided by the Tourism Office.
        Schema::create('rider_service_eligibilities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->string('service', 20); // food | transport
            $table->string('status', 20); // approved | not_eligible
            $table->string('remarks', 1000)->nullable();
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();

            $table->unique(['rider_id', 'service']);
        });

        // Final decision history (approve / partially approve / reject / return).
        Schema::create('rider_approval_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->string('decision', 30);
            $table->json('services')->nullable();
            $table->text('remarks')->nullable();
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at');
            $table->timestamps();
            $table->index(['rider_id', 'decided_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_approval_records');
        Schema::dropIfExists('rider_service_eligibilities');
        Schema::dropIfExists('rider_training_availability');

        Schema::table('rider_training_assessments', fn (Blueprint $table) => $table->dropColumn('items'));
        Schema::table('rider_interviews', fn (Blueprint $table) => $table->dropColumn('checklist'));
        Schema::table('rider_details', function (Blueprint $table) {
            $table->dropIndex(['application_status']);
            $table->dropColumn('application_status');
        });
    }
};
