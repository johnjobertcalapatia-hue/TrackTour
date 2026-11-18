<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Grab-style rider onboarding: online application, Tourism Office
 * appointment slots with real capacity, then interview, training and
 * assessment before the existing rider approval activates the account.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_details', function (Blueprint $table) {
            $table->json('requested_services')->nullable()->after('current_service');
            $table->string('application_reference', 40)->nullable()->unique()->after('requested_services');
            $table->timestamp('application_submitted_at')->nullable()->after('application_reference');
        });

        // One bookable onboarding session at a Tourism Office.
        Schema::create('rider_training_schedules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('municipality_id')->constrained()->cascadeOnDelete();
            $table->timestamp('starts_at');
            $table->unsignedSmallInteger('capacity');
            $table->unsignedSmallInteger('booked_count')->default(0);
            $table->string('location_name', 150);
            $table->string('location_address', 255)->nullable();
            $table->string('status', 20)->default('open'); // open | closed
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['municipality_id', 'starts_at']);
            $table->index(['municipality_id', 'status', 'starts_at']);
        });

        Schema::create('rider_appointments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('schedule_id')->constrained('rider_training_schedules')->cascadeOnDelete();
            // booked | checked_in | completed | cancelled | no_show
            $table->string('status', 20)->default('booked');
            // Equals rider_id while the appointment is active, NULL otherwise:
            // the unique index allows only one active appointment per rider.
            $table->unsignedBigInteger('active_rider_id')->nullable()->unique();
            $table->boolean('walk_in')->default(false);
            $table->foreignId('booked_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('checked_in_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();

            $table->index(['schedule_id', 'status']);
            $table->index(['rider_id', 'created_at']);
        });

        Schema::create('rider_interviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('appointment_id')->nullable()->constrained('rider_appointments')->nullOnDelete();
            $table->string('result', 20); // passed | failed
            $table->boolean('documents_verified')->default(false);
            $table->text('notes')->nullable();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['rider_id', 'created_at']);
        });

        Schema::create('rider_training_attendance', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('appointment_id')->nullable()->constrained('rider_appointments')->nullOnDelete();
            $table->string('status', 20); // present | absent
            $table->text('notes')->nullable();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['rider_id', 'created_at']);
        });

        Schema::create('rider_training_assessments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('appointment_id')->nullable()->constrained('rider_appointments')->nullOnDelete();
            $table->unsignedTinyInteger('score');
            $table->string('result', 20); // passed | failed
            $table->text('notes')->nullable();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['rider_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_training_assessments');
        Schema::dropIfExists('rider_training_attendance');
        Schema::dropIfExists('rider_interviews');
        Schema::dropIfExists('rider_appointments');
        Schema::dropIfExists('rider_training_schedules');

        Schema::table('rider_details', function (Blueprint $table) {
            $table->dropUnique(['application_reference']);
            $table->dropColumn(['requested_services', 'application_reference', 'application_submitted_at']);
        });
    }
};
