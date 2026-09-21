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

        Schema::table('business_category_documents', function (Blueprint $table) {
            $table->dropForeign(['required_document_id']);
            $table->dropForeign(['business_category_id']);
        });

        Schema::dropIfExists('business_category_documents');
        Schema::dropIfExists('required_documents');

        Schema::create('required_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_category_id')->constrained()->cascadeOnDelete();
            $table->string('document_name');
            $table->string('document_code');
            $table->boolean('is_required')->default(true);
            $table->boolean('has_expiration')->default(false);
            $table->string('validity_period')->nullable();
            $table->text('description')->nullable();
            $table->json('required_fields');
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->unsignedInteger('grace_period_days')->default(30);
            $table->timestamp('effective_date')->nullable();
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();
        });

        Schema::table('business_document_uploads', function (Blueprint $table) {
            $table->foreign('required_document_id')->references('id')->on('required_documents')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('business_document_uploads', function (Blueprint $table) {
            $table->dropForeign(['required_document_id']);
        });

        Schema::dropIfExists('required_documents');

        Schema::create('required_documents', function (Blueprint $table) {
            $table->id();
            $table->string('code')->unique();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('file_types')->default('pdf,jpg,jpeg,png');
            $table->unsignedInteger('max_size_kb')->default(5120);
            $table->boolean('accepts_multiple')->default(false);
            $table->boolean('is_expirable')->default(false);
            $table->text('remarks')->nullable();
            $table->string('status')->default('active');
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();
        });

        Schema::create('business_category_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_category_id')->constrained()->cascadeOnDelete();
            $table->foreignId('required_document_id')->constrained()->cascadeOnDelete();
            $table->boolean('required')->default(true);
            $table->unsignedInteger('display_order')->default(0);
            $table->timestamps();
            $table->unique(['business_category_id', 'required_document_id'], 'bcd_cat_doc_unique');
        });

        Schema::table('business_document_uploads', function (Blueprint $table) {
            $table->foreign('required_document_id')->references('id')->on('required_documents')->cascadeOnDelete();
        });
    }
};
