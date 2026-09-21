<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('business_document_uploads', function (Blueprint $table) {
            $table->boolean('flagged')->default(false)->after('owner_remarks');
            $table->text('flag_reason')->nullable()->after('flagged');
            $table->json('ocr_data')->nullable()->after('flag_reason');
        });
    }

    public function down(): void
    {
        Schema::table('business_document_uploads', function (Blueprint $table) {
            $table->dropColumn(['flagged', 'flag_reason', 'ocr_data']);
        });
    }
};
