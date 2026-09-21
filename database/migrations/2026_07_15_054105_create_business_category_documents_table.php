<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('business_category_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_category_id')->constrained()->cascadeOnDelete();
            $table->foreignId('required_document_id')->constrained()->cascadeOnDelete();
            $table->boolean('required')->default(true);
            $table->timestamps();

            $table->unique(['business_category_id', 'required_document_id'], 'bcd_cat_doc_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('business_category_documents');
    }
};
