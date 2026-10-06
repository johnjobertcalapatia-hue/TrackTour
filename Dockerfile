# syntax=docker/dockerfile:1

# TrackTour Laravel API — production container
# Serves the API on :80 (Apache + mod_php) and runs the scheduler + queue worker
# via supervisord inside the same container.

FROM composer:2 AS composer

FROM php:8.2-apache AS runtime

# System dependencies: tesseract for document OCR, GD/zip/intl/curl ext sources,
# plus supervisord for the scheduler/queue workers.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        unzip \
        supervisor \
        libcurl4-openssl-dev \
        libzip-dev \
        libpng-dev \
        libjpeg62-turbo-dev \
        libfreetype6-dev \
        libicu-dev \
        libonig-dev \
        libxml2-dev \
        tesseract-ocr \
        tesseract-ocr-eng \
    && (apt-get install -y --no-install-recommends tesseract-ocr-fil || true) \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" \
        pdo_mysql \
        mbstring \
        exif \
        pcntl \
        bcmath \
        gd \
        zip \
        intl \
        curl \
        opcache \
    && a2enmod rewrite headers \
    && mkdir -p /var/www/html \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/html

# Production PHP tuning (opcache) so every request does not recompile the app.
COPY docker/opcache.ini /usr/local/etc/php/conf.d/opcache-laravel.ini

COPY --from=composer /usr/bin/composer /usr/bin/composer

# Install dependencies without running scripts (schema/app state is not ready
# during build; package discovery + migrations run at container start).
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-interaction --prefer-dist --optimize-autoloader

# Copy the application (node_modules/frontend/vendor are excluded via .dockerignore).
COPY . .

# Runtime-home directories Laravel needs to stay writable. Uploaded media lives
# at storage/app/public on a persistent deployment volume.
RUN mkdir -p bootstrap/cache storage/framework/sessions storage/framework/views storage/app/public \
    && chown -R www-data:www-data storage bootstrap/cache public

ENV APP_ENV=production

COPY docker/apache-vhost.conf /etc/apache2/sites-available/000-default.conf
COPY docker/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/start-container.sh /usr/local/bin/start-container

RUN chmod +x /usr/local/bin/start-container

EXPOSE 80

ENTRYPOINT ["/usr/local/bin/start-container"]