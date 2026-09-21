<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('required_documents', function (Blueprint $table) {
            $table->string('status')->default('active')->after('remarks');
        });

        DB::table('required_documents')->update(['status' => 'active']);

        Schema::table('business_category_documents', function (Blueprint $table) {
            $table->unsignedInteger('display_order')->default(0)->after('required');
        });
    }

    public function down(): void
    {
        Schema::table('required_documents', function (Blueprint $table) {
            $table->dropColumn('status');
        });

        Schema::table('business_category_documents', function (Blueprint $table) {
            $table->dropColumn('display_order');
        });
    }
};
