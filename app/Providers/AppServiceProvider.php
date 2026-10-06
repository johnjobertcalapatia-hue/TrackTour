<?php

namespace App\Providers;

use App\Models\Booking;
use App\Models\Favorite;
use App\Models\Review;
use App\Observers\BookingObserver;
use App\Observers\FavoriteObserver;
use App\Observers\ReviewObserver;
use App\Repositories\Contracts\BookingRepositoryInterface;
use App\Repositories\Contracts\BusinessRepositoryInterface;
use App\Repositories\Contracts\DeliveryRepositoryInterface;
use App\Repositories\Contracts\FavoriteRepositoryInterface;
use App\Repositories\Contracts\MunicipalityRepositoryInterface;
use App\Repositories\Contracts\NotificationRepositoryInterface;
use App\Repositories\Contracts\OrderRepositoryInterface;
use App\Repositories\Contracts\ReviewRepositoryInterface;
use App\Repositories\Contracts\StaffRepositoryInterface;
use App\Repositories\Contracts\UserRepositoryInterface;
use App\Repositories\Eloquent\BookingRepository;
use App\Repositories\Eloquent\BusinessRepository;
use App\Repositories\Eloquent\DeliveryRepository;
use App\Repositories\Eloquent\FavoriteRepository;
use App\Repositories\Eloquent\MunicipalityRepository;
use App\Repositories\Eloquent\NotificationRepository;
use App\Repositories\Eloquent\OrderRepository;
use App\Repositories\Eloquent\ReviewRepository;
use App\Repositories\Eloquent\StaffRepository;
use App\Repositories\Eloquent\UserRepository;
use App\Services\AdminService;
use App\Services\BookingService;
use App\Services\BusinessService;
use App\Services\DeliveryFareSettings;
use App\Services\DeliveryService;
use App\Services\NotificationService;
use App\Services\OrderService;
use App\Services\PaymongoService;
use App\Services\StaffService;
use App\Services\TourismOfficeService;
use App\Services\TouristService;
use App\Services\UserService;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->register(EventServiceProvider::class);

        // Repository Bindings
        $this->app->bind(UserRepositoryInterface::class, UserRepository::class);
        $this->app->bind(BusinessRepositoryInterface::class, BusinessRepository::class);
        $this->app->bind(OrderRepositoryInterface::class, OrderRepository::class);
        $this->app->bind(BookingRepositoryInterface::class, BookingRepository::class);
        $this->app->bind(DeliveryRepositoryInterface::class, DeliveryRepository::class);
        $this->app->bind(StaffRepositoryInterface::class, StaffRepository::class);
        $this->app->bind(MunicipalityRepositoryInterface::class, MunicipalityRepository::class);
        $this->app->bind(NotificationRepositoryInterface::class, NotificationRepository::class);
        $this->app->bind(ReviewRepositoryInterface::class, ReviewRepository::class);
        $this->app->bind(FavoriteRepositoryInterface::class, FavoriteRepository::class);

        // Service Bindings
        $this->app->singleton(UserService::class);
        $this->app->singleton(BusinessService::class);
        $this->app->singleton(OrderService::class);
        $this->app->singleton(BookingService::class);
        $this->app->singleton(DeliveryService::class);
        $this->app->singleton(DeliveryFareSettings::class);
        $this->app->singleton(StaffService::class);
        $this->app->singleton(TouristService::class);
        $this->app->singleton(AdminService::class);
        $this->app->singleton(TourismOfficeService::class);
        $this->app->singleton(NotificationService::class);
        $this->app->singleton(PaymongoService::class);
    }

    public function boot(): void
    {
        Password::defaults(function () {
            return Password::min(8)
                ->letters()
                ->mixedCase()
                ->numbers()
                ->symbols();
        });

        Review::observe(ReviewObserver::class);
        Favorite::observe(FavoriteObserver::class);
        Booking::observe(BookingObserver::class);
    }
}
