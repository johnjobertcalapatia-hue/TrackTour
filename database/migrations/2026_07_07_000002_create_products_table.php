<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_category_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name');
            $table->text('description')->nullable();
            $table->decimal('price', 12, 2)->default(0);
            $table->decimal('compare_price', 12, 2)->nullable();
            $table->string('unit')->nullable()->comment('e.g., piece, serving, kg');
            $table->integer('stock')->default(0)->comment('0 = unlimited/not tracked');
            $table->boolean('is_available')->default(true);
            $table->string('image')->nullable();
            $table->json('images')->nullable();
            $table->integer('sort_order')->default(0);
            $table->string('type')->default('product')->comment('product or service');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};
