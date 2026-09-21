<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('business_document_uploads', function (Blueprint $table) {
            $table->dropForeign(['required_document_id']);
        });

        Schema::table('business_document_uploads', function (Blueprint $table) {
            $table->unsignedBigInteger('required_document_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('business_document_uploads', function (Blueprint $table) {
            $table->unsignedBigInteger('required_document_id')->nullable(false)->change();
            $table->foreign('required_document_id')->references('id')->on('required_documents')->onDelete('cascade');
        });
    }
};
