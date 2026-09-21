<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('required_documents', function (Blueprint $table) {
            $table->timestamp('archived_at')->nullable()->after('status');
        });

        Schema::table('business_categories', function (Blueprint $table) {
            $table->timestamp('archived_at')->nullable()->after('description');
        });
    }

    public function down(): void
    {
        Schema::table('required_documents', function (Blueprint $table) {
            $table->dropColumn('archived_at');
        });

        Schema::table('business_categories', function (Blueprint $table) {
            $table->dropColumn('archived_at');
        });
    }
};
