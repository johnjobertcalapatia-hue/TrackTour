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
use App\Services\RideFareSettings;
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
        $this->app->singleton(RideFareSettings::class);
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

        // Secure transaction architecture, Stage 2: every change to these
        // canonical records is appended to the hash-chained transaction ledger.
        foreach ([
            \App\Models\Order::class,
            \App\Models\OrderItem::class,
            \App\Models\Payment::class,
            \App\Models\Refund::class,
            \App\Models\Delivery::class,
            \App\Models\DeliveryPickupStop::class,
            \App\Models\RiderEarning::class,
            \App\Models\TripLog::class,
        ] as $model) {
            $model::observe(\App\Observers\TransactionLedgerObserver::class);
        }

        // Stage 3: menu availability history. MenuAvailabilityService is the
        // authoritative writer; this observer only catches bypassing writes.
        \App\Models\Offering::observe(\App\Observers\MenuAvailabilityObserver::class);
        \App\Models\OfferingVariation::observe(\App\Observers\MenuAvailabilityObserver::class);

        $this->recordIncidents();
    }

    /**
     * System incident history (admin → Incident History). These hooks only
     * WRITE a history row; they never change the payment, refund or job.
     */
    private function recordIncidents(): void
    {
        $failedPayment = function (\App\Models\Payment $payment) {
            \App\Services\SystemIncidentRecorder::record(
                'payment', 'payment_failed', 'warning',
                'Payment failed: '.($payment->payment_number ?? "#{$payment->id}"),
                'The '.strtoupper((string) ($payment->method ?? 'online')).' payment of ₱'.number_format((float) $payment->amount, 2).' did not go through.',
                ['payment_number' => $payment->payment_number, 'amount' => (float) $payment->amount, 'method' => $payment->method, 'provider' => $payment->provider],
                $payment, \App\Models\SystemIncident::STATUS_RECORDED,
                fingerprintKey: (string) $payment->id,
                user: $payment->user_id ? \App\Models\User::find($payment->user_id) : null,
            );
        };
        \App\Models\Payment::created(fn ($p) => $p->status === 'failed' ? $failedPayment($p) : null);
        \App\Models\Payment::updated(fn ($p) => $p->wasChanged('status') && $p->status === 'failed' ? $failedPayment($p) : null);

        \App\Models\Refund::updated(function (\App\Models\Refund $refund) {
            if (! $refund->wasChanged('status') || $refund->status !== 'failed') {
                return;
            }
            \App\Services\SystemIncidentRecorder::record(
                'refund', 'refund_failed', 'error',
                'Refund failed: ₱'.number_format((float) $refund->amount, 2),
                'PayMongo did not complete this refund. The payment stays refundable — try the refund again or contact the customer.',
                ['refund_id' => $refund->id, 'payment_id' => $refund->payment_id, 'amount' => (float) $refund->amount],
                $refund, fingerprintKey: (string) $refund->id,
            );
        });

        \Illuminate\Support\Facades\Queue::failing(function (\Illuminate\Queue\Events\JobFailed $event) {
            $name = $event->job->resolveName();
            \App\Services\SystemIncidentRecorder::record(
                'jobs', 'job_failed', 'error',
                'Background task failed: '.class_basename($name),
                \Illuminate\Support\Str::limit($event->exception->getMessage(), 1000),
                ['job' => $name, 'queue' => $event->job->getQueue(), 'connection' => $event->connectionName, 'exception' => $event->exception::class],
                fingerprintKey: $name.'|'.$event->exception::class,
            );
        });
    }
}
