<?php

use App\Http\Controllers\Admin\AdminAuditLogController;
use App\Http\Controllers\Admin\AdminBusinessCategoryController;
use App\Http\Controllers\Admin\AdminBusinessController;
use App\Http\Controllers\Admin\AdminPayoutController;
use App\Http\Controllers\Admin\AdminPurchasingCashController;
use App\Http\Controllers\Admin\AdminDashboardController;
use App\Http\Controllers\Admin\AdminLiveController;
use App\Http\Controllers\Admin\AdminMapController;
use App\Http\Controllers\Admin\AdminMunicipalityController;
use App\Http\Controllers\Admin\AdminNotificationController;
use App\Http\Controllers\Admin\AdminPosSalesController;
use App\Http\Controllers\Admin\AdminReportController;
use App\Http\Controllers\Admin\AdminRiderController;
use App\Http\Controllers\Admin\AdminRoleController;
use App\Http\Controllers\Admin\AdminSystemController;
use App\Http\Controllers\Admin\AdminUserController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DocumentOcrController;
use App\Http\Controllers\Api\FormDraftController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\StaffDashboardApiController;
use App\Http\Controllers\Api\SocketTokenController;
use App\Http\Controllers\Api\TripTrackingController;
use App\Http\Controllers\Api\VerificationDocumentController;
use App\Http\Controllers\Auth\OtpController;
use App\Http\Controllers\BusinessOwnerBookingController;
use App\Http\Controllers\BusinessRegistrationController;
use App\Http\Controllers\BusinessOwnerBookingManageController;
use App\Http\Controllers\BusinessOwnerBusinessController;
use App\Http\Controllers\BusinessOwnerBusinessManageController;
use App\Http\Controllers\BusinessOwnerCustomerController;
use App\Http\Controllers\BusinessOwnerDashboardController;
use App\Http\Controllers\BusinessOwnerFoodController;
use App\Http\Controllers\BusinessOwnerMenuController;
use App\Http\Controllers\BusinessOwnerMenuManageController;
use App\Http\Controllers\BusinessOwnerNotificationController;
use App\Http\Controllers\BusinessOwnerOfferingController;
use App\Http\Controllers\BusinessOwner\BusinessOwnerArchiveController;
use App\Http\Controllers\BusinessOwner\BusinessOwnerKitchenController;
use App\Http\Controllers\BusinessOwner\BusinessOwnerExportController;
use App\Http\Controllers\BusinessOwner\BusinessOwnerExpenseController;
use App\Http\Controllers\BusinessOwnerOfferingCategoryController;
use App\Http\Controllers\BusinessOwnerOrderController;
use App\Http\Controllers\BusinessOwnerPaymentController;
use App\Http\Controllers\BusinessOwnerPreparationController;
use App\Http\Controllers\BusinessOwnerProfileController;
use App\Http\Controllers\BusinessOwnerPromotionController;
use App\Http\Controllers\BusinessOwnerPromotionManageController;
use App\Http\Controllers\BusinessOwnerReportController;
use App\Http\Controllers\BusinessOwnerSalesController;
use App\Http\Controllers\BusinessOwnerStaffController;
use App\Http\Controllers\Rider\RiderController;
use App\Http\Controllers\Rider\RiderDeliveryController;
use App\Http\Controllers\Rider\RiderDispatchController;
use App\Http\Controllers\Rider\RiderPayoutController;
use App\Http\Controllers\Rider\RiderMapController;
use App\Http\Controllers\Rider\RiderProfileController;
use App\Http\Controllers\Rider\RiderPurchasingController;
use App\Http\Controllers\Rider\RiderPickupStopController;
use App\Http\Controllers\StaffMenuController;
use App\Http\Controllers\TourismOffice\BusinessOwnerApprovalController;
use App\Http\Controllers\TourismOffice\LandingContentController;
use App\Http\Controllers\TourismOffice\TourismOfficeController;
use App\Http\Controllers\TourismOffice\TourismManagementController;
use App\Http\Controllers\TourismOffice\TourismOfficeDocumentController;
use App\Http\Controllers\TourismOffice\TourismOfficeFullController;
use App\Http\Controllers\Tourist\BookingController;
use App\Http\Controllers\Tourist\EventController;
use App\Http\Controllers\Tourist\EventShowController;
use App\Http\Controllers\Tourist\ExploreController;
use App\Http\Controllers\Tourist\FavoriteController;
use App\Http\Controllers\Tourist\FoodController;
use App\Http\Controllers\Tourist\GroupOrderController;
use App\Http\Controllers\Tourist\HistoryController;
use App\Http\Controllers\Tourist\MessageController;
use App\Http\Controllers\Tourist\NotificationController;
use App\Http\Controllers\Tourist\ReviewController;
use App\Http\Controllers\Tourist\TouristProfileController;
use App\Http\Controllers\Tourist\TransportController;
use App\Http\Controllers\Tourist\TransportLocationController;
use App\Http\Controllers\Tourist\TouristController;
use App\Http\Controllers\Tourist\TouristDestinationController;
use App\Models\Municipality;
use Illuminate\Support\Facades\Route;

// ─── Public Auth Routes ──────────────────────────────────────────────
Route::post('/register', [AuthController::class, 'register']);
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
Route::post('/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:3,5');
Route::post('/reset-password', [AuthController::class, 'resetPassword']);
Route::post('/auth/send-otp', [OtpController::class, 'sendOtp'])->middleware('throttle:5,1');
Route::post('/auth/verify-otp', [OtpController::class, 'verifyOtp'])->middleware('throttle:10,1');

// PayMongo Webhook (public — verified by signature)
Route::post('/payments/webhook', [PaymentController::class, 'webhook']);

// Payment check (public — payment number is a unique secret)
Route::get('/payments/check/{paymentNumber}', [PaymentController::class, 'checkAndConfirm']);
Route::get('/payments/return', [PaymentController::class, 'paymongoReturn']);


// Public: approved businesses for the landing page map
Route::get('/map/businesses', [ExploreController::class, 'landingMap']);

Route::get('/municipalities', function () {
    $municipalities = Municipality::with('barangays:id,municipality_id,name')
        ->withCount(['destinations', 'businesses'])
        ->orderBy('name')
        ->get(['id', 'name']);

    return response()->json([
        'success' => true,
        'message' => 'Municipalities retrieved successfully.',
        'data' => $municipalities,
    ]);
});

// Public: landing page content (hero video/text, categories, spots)
Route::get('/landing-content', [LandingContentController::class, 'content']);

// Public: landing page card feed (destinations + businesses, live from DB)
Route::get('/landing/cards', [LandingContentController::class, 'cards']);

// ═══════════════════════════════════════════════════════════════════
// Public Tourist Browse (guests can explore without signing in)
// ═══════════════════════════════════════════════════════════════════
Route::prefix('tourist')->group(function () {
    // Explore
    Route::get('/explore', [ExploreController::class, 'index']);
    Route::get('/explore/search', [ExploreController::class, 'searchSuggestions']);
    Route::get('/for-you', [ExploreController::class, 'forYou']);
    Route::get('/explore/categories', [ExploreController::class, 'categories']);
    Route::get('/explore/featured', [ExploreController::class, 'featured']);
    Route::get('/explore/directory', [ExploreController::class, 'directory']);
    Route::get('/explore/map', [ExploreController::class, 'map']);
    Route::get('/explore/municipality/{municipality}', [ExploreController::class, 'municipality']);

    // Destinations
    Route::get('/destinations', [TouristDestinationController::class, 'index']);
    Route::get('/destinations/categories', [TouristDestinationController::class, 'categories']);
    Route::get('/destinations/{destination}', [TouristDestinationController::class, 'show']);

    Route::get('/explore/{business}', [ExploreController::class, 'show']);

    // Food
    Route::get('/food', [FoodController::class, 'index']);
    Route::get('/food/{offering}', [FoodController::class, 'show']);

    // Stays listing & Events
    Route::get('/booking', [BookingController::class, 'index']);
    Route::get('/events', [EventController::class, 'index']);
    Route::get('/events/{id}', EventShowController::class);
});

// ─── Authenticated Routes ────────────────────────────────────────────
Route::middleware('token.only')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/user', [AuthController::class, 'user']);
    Route::post('/email/verification-notification', [AuthController::class, 'sendVerificationEmail']);
    Route::post('/password/confirm', [AuthController::class, 'confirmPassword']);

    // Realtime socket room token (user:{id}) for the Zero-DB socket engine.
    Route::get('/socket/user-token', [SocketTokenController::class, 'userToken']);
    Route::get('/business-documents/{businessDocument}/file', [VerificationDocumentController::class, 'business'])
        ->name('api.business-documents.file');
    Route::get('/users/{kyc}/verification-documents/{document}', [VerificationDocumentController::class, 'kyc'])
        ->name('api.user-kyc.file');
    Route::get('/rider-details/{riderDetail}/verification-documents/{document}', [VerificationDocumentController::class, 'rider'])
        ->name('api.rider-documents.file');

    // Form Drafts
    Route::get('/drafts', [FormDraftController::class, 'index']);
    Route::get('/drafts/{draftKey}', [FormDraftController::class, 'show']);
    Route::post('/drafts', [FormDraftController::class, 'store']);
    Route::delete('/drafts/{draftKey}', [FormDraftController::class, 'destroy']);

    // Document OCR
    Route::post('/documents/extract', [DocumentOcrController::class, 'extract']);
    Route::get('/documents/ocr-status', [DocumentOcrController::class, 'status']);

    // ═══════════════════════════════════════════════════════════════════
    // Payment API (PayMongo / GCash)
    // ═══════════════════════════════════════════════════════════════════
    Route::prefix('payments')->group(function () {
        Route::post('/create-intent', [PaymentController::class, 'createIntent']);
        Route::get('/callback', [PaymentController::class, 'callback']);
        Route::get('/status/{paymentNumber}', [PaymentController::class, 'status']);
        Route::post('/{paymentNumber}/refund', [PaymentController::class, 'refund']);
    });

    // Trip Tracking API
    Route::prefix('trips')->group(function () {
        Route::post('{trip}/start', [TripTrackingController::class, 'start']);
        Route::post('{trip}/location', [TripTrackingController::class, 'updateLocation']);
        Route::post('{trip}/end', [TripTrackingController::class, 'end']);
        Route::get('{trip}/tracking', [TripTrackingController::class, 'tracking']);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Tourist API
    // ═══════════════════════════════════════════════════════════════════
    Route::middleware('role:tourist')->prefix('tourist')->group(function () {
        Route::get('/dashboard', [TouristController::class, 'dashboard']);

        // Food
        Route::post('/food/order', [FoodController::class, 'orderFlat']);
        Route::post('/food/delivery-fee', [FoodController::class, 'quoteDeliveryFee']);
        Route::post('/food/availability', [FoodController::class, 'checkAvailability']);
        Route::get('/food/order/{order}/status', [FoodController::class, 'orderStatus']);
        Route::post('/food/order/{order}/cancel', [FoodController::class, 'cancelOrder']);
        Route::post('/food/order/{order}/cancel-item', [FoodController::class, 'cancelItem']);
        Route::post('/food/order/{order}/rate', [FoodController::class, 'rateOrder']);
        Route::post('/food/order/{order}/confirm-delivery', [FoodController::class, 'confirmDelivery']);

        // Multi-restaurant group checkout
        Route::post('/food/group-order', [GroupOrderController::class, 'store']);
        Route::get('/food/group-order/{id}', [GroupOrderController::class, 'show']);

        // Bookings (index is public; show requires auth — business detail)
        Route::get('/booking/{id}/detail', [BookingController::class, 'detail']);
        Route::get('/booking/{business}', [BookingController::class, 'show']);
        Route::post('/booking/{business}', [BookingController::class, 'store']);
        Route::post('/booking/{id}/cancel', [BookingController::class, 'cancel']);

        // Transport
        Route::get('/transport', [TransportController::class, 'index']);
        Route::post('/transport/estimate', [TransportController::class, 'estimate']);
        Route::post('/transport/route', [TransportController::class, 'route']);
        Route::post('/transport/book', [TransportController::class, 'book']);
        Route::get('/transport/trip/{id}/status', [TransportController::class, 'tripStatus']);
        Route::post('/transport/trip/{id}/cancel', [TransportController::class, 'cancelTrip']);
        Route::post('/transport/trip/{id}/rate', [TransportController::class, 'rateTrip']);

        // Transport — pickup & destination selection (local registry search)
        Route::get('/transport/locations/search', [TransportLocationController::class, 'search']);
        Route::get('/transport/locations/reverse-geocode', [TransportLocationController::class, 'reverseGeocode']);

        // Events (public — see public browse group above)

        // Favorites
        Route::get('/favorites', [FavoriteController::class, 'index']);
        Route::post('/favorites/toggle', [FavoriteController::class, 'toggle']);

        // Reviews
        Route::get('/reviews', [ReviewController::class, 'index']);

        // Messages
        Route::get('/messages', [MessageController::class, 'index']);
        Route::post('/messages', [MessageController::class, 'store']);

        // Notifications
        Route::get('/notifications', [NotificationController::class, 'index']);
        Route::get('/notifications/unread-count', [NotificationController::class, 'unreadCount']);
        Route::patch('/notifications/{id}/read', [NotificationController::class, 'markAsRead']);
        Route::patch('/notifications/read-all', [NotificationController::class, 'readAll']);

        // History
        Route::get('/history', [HistoryController::class, 'index']);

        // Profile
        Route::get('/profile', [TouristProfileController::class, 'show']);
        Route::put('/profile', [TouristProfileController::class, 'update']);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Business Owner API
    // ═══════════════════════════════════════════════════════════════════
    Route::middleware('role:business_owner')->prefix('business-owner')->group(function () {
        // Profile & Account (accessible even when pending)
        Route::get('/profile', [BusinessOwnerProfileController::class, 'show']);
        Route::put('/profile', [BusinessOwnerProfileController::class, 'update']);
        Route::get('/account-status', [BusinessOwnerProfileController::class, 'accountStatus']);
        Route::put('/account-settings', [BusinessOwnerProfileController::class, 'updateSettings']);
        Route::get('/activity-logs', [BusinessOwnerProfileController::class, 'activityLogs']);

        // All other routes require approved account
        Route::middleware('business.approved')->group(function () {
            // Dashboard
            Route::get('/dashboard', [BusinessOwnerDashboardController::class, 'index']);

            // Notifications
            Route::get('/notifications', [BusinessOwnerNotificationController::class, 'index']);
            Route::patch('/notifications/{id}/read', [BusinessOwnerNotificationController::class, 'markRead']);
            Route::patch('/notifications/read-all', [BusinessOwnerNotificationController::class, 'markAllRead']);

            // Businesses
            Route::get('/businesses', [BusinessOwnerBusinessController::class, 'index'])->name('business-owner.businesses');
            Route::get('/businesses/create', [BusinessOwnerBusinessController::class, 'create'])->name('business-owner.businesses.create');
            Route::post('/businesses', [BusinessOwnerBusinessManageController::class, 'store'])->name('business-owner.businesses.store');
            Route::get('/businesses/switcher', [BusinessOwnerBusinessController::class, 'switcher']);
            Route::get('/businesses/document-requirements', [BusinessRegistrationController::class, 'getDocumentRequirements']);
            Route::get('/business-categories/{categoryId}/documents', [BusinessRegistrationController::class, 'getCategoryDocuments']);
            Route::get('/businesses/category-fields/{categoryId}', [BusinessRegistrationController::class, 'getCategoryFields']);
            Route::get('/businesses/barangays/{municipalityId}', [BusinessRegistrationController::class, 'getBarangays']);
            Route::get('/businesses/{business}', [BusinessOwnerBusinessManageController::class, 'show']);
            Route::put('/businesses/{business}', [BusinessOwnerBusinessManageController::class, 'update']);
            Route::put('/businesses/{business}/hours', [BusinessOwnerBusinessManageController::class, 'updateHours']);
            Route::put('/businesses/{business}/payment-methods', [BusinessOwnerBusinessManageController::class, 'updatePaymentMethods']);
            Route::get('/businesses/{business}/payments', [BusinessOwnerPaymentController::class, 'index']);
            Route::get('/businesses/{business}/payments/{order}', [BusinessOwnerPaymentController::class, 'show']);
            Route::get('/businesses/{business}/documents', [BusinessOwnerBusinessManageController::class, 'documents']);
            Route::post('/businesses/{business}/documents', [BusinessOwnerBusinessManageController::class, 'uploadDocument']);
            Route::delete('/businesses/{business}/documents/{businessDocument}', [BusinessOwnerBusinessManageController::class, 'deleteDocument']);
            Route::get('/businesses/{business}/gallery', [BusinessOwnerBusinessManageController::class, 'gallery']);
            Route::post('/businesses/{business}/gallery', [BusinessOwnerBusinessManageController::class, 'uploadGallery']);
            Route::put('/businesses/{business}/gallery/{businessMedia}', [BusinessOwnerBusinessManageController::class, 'updateMedia']);
            Route::patch('/businesses/{business}/gallery/{businessMedia}/feature', [BusinessOwnerBusinessManageController::class, 'toggleFeatured']);
            Route::patch('/businesses/{business}/gallery/{businessMedia}/visibility', [BusinessOwnerBusinessManageController::class, 'toggleVisibility']);
            Route::delete('/businesses/{business}/gallery/{businessMedia}', [BusinessOwnerBusinessManageController::class, 'deleteMedia']);
            Route::post('/businesses/{business}/gallery/video', [BusinessOwnerBusinessManageController::class, 'uploadVideo']);
            Route::put('/businesses/{business}/profile', [BusinessOwnerBusinessManageController::class, 'updateProfile']);
            Route::post('/businesses/{business}/logo', [BusinessOwnerBusinessManageController::class, 'uploadLogo']);
            Route::delete('/businesses/{business}/logo', [BusinessOwnerBusinessManageController::class, 'removeLogo']);
            Route::post('/businesses/{business}/cover-photo', [BusinessOwnerBusinessManageController::class, 'uploadCoverPhoto']);
            Route::delete('/businesses/{business}/cover-photo', [BusinessOwnerBusinessManageController::class, 'removeCoverPhoto']);
            Route::get('/businesses/{business}/verification', [BusinessOwnerBusinessManageController::class, 'verification']);
            Route::post('/businesses/{business}/verification/submit', [BusinessOwnerBusinessManageController::class, 'submitForReview']);
            Route::get('/businesses/{business}/reviews', [BusinessOwnerBusinessManageController::class, 'reviews']);

            // Menu Items (menu = offerings with type menu)
            Route::get('/menu', [BusinessOwnerMenuController::class, 'index']);
            Route::get('/menu/{id}', [BusinessOwnerMenuManageController::class, 'show']);
            Route::post('/menu', [BusinessOwnerMenuManageController::class, 'store']);
            Route::put('/menu/{id}', [BusinessOwnerMenuManageController::class, 'update']);
            Route::delete('/menu/{id}', [BusinessOwnerMenuManageController::class, 'destroy']);

            // Food (shortcut for creating food offerings)
            Route::post('/food', [BusinessOwnerFoodController::class, 'store']);

            // Offering Categories
            Route::get('/offerings/categories', [BusinessOwnerOfferingCategoryController::class, 'index']);
            Route::post('/offerings/categories', [BusinessOwnerOfferingCategoryController::class, 'store']);
            Route::put('/offerings/categories/{id}', [BusinessOwnerOfferingCategoryController::class, 'update']);
            Route::delete('/offerings/categories/{id}', [BusinessOwnerOfferingCategoryController::class, 'destroy']);

            // Offerings
            Route::get('/offerings', [BusinessOwnerOfferingController::class, 'index']);
            Route::get('/offerings/{offering}', [BusinessOwnerOfferingController::class, 'show']);
            Route::post('/offerings', [BusinessOwnerOfferingController::class, 'store']);
            Route::put('/offerings/{offering}', [BusinessOwnerOfferingController::class, 'update']);
            Route::delete('/offerings/{offering}', [BusinessOwnerOfferingController::class, 'destroy']);

            // Orders
            Route::get('/orders', [BusinessOwnerOrderController::class, 'index']);
            Route::get('/orders/deliveries', [BusinessOwnerOrderController::class, 'deliveryTracking']);
            Route::get('/orders/{order}', [BusinessOwnerOrderController::class, 'show']);
            Route::patch('/orders/{order}/status', [BusinessOwnerOrderController::class, 'updateStatus']);
            Route::post('/orders/{order}/assign-rider', [BusinessOwnerOrderController::class, 'assignRider']);
            Route::post('/orders/{order}/start-preparation', [BusinessOwnerOrderController::class, 'startPreparation']);
            Route::post('/orders/{order}/mark-ready', [BusinessOwnerOrderController::class, 'markReady']);
            Route::patch('/orders/{order}/items/{item}/status', [BusinessOwnerOrderController::class, 'updateItemStatus']);

            // Realtime socket room token (business:{id}) for the Zero-DB socket engine.
            Route::get('/socket/token', [SocketTokenController::class, 'businessToken']);

            // Preparation Prediction Settings + preparation countdown settings
            $prepCtrl = BusinessOwnerPreparationController::class;
            Route::get('/restaurants/{restaurant}/preparation-prediction/status', [$prepCtrl, 'predictionStatus']);
            Route::patch('/restaurants/{restaurant}/settings/preparation-prediction', [$prepCtrl, 'togglePrediction']);
            Route::get('/restaurants/{restaurant}/preparation-settings', [$prepCtrl, 'preparationSettings']);
            Route::patch('/restaurants/{restaurant}/settings/preparation', [$prepCtrl, 'updatePreparationSettings']);

            // Bookings
            Route::get('/bookings', [BusinessOwnerBookingController::class, 'index']);
            Route::get('/bookings/{booking}', [BusinessOwnerBookingController::class, 'show']);
            Route::patch('/bookings/{id}/status', [BusinessOwnerBookingManageController::class, 'updateStatus']);

            // Promotions
            Route::get('/promotions', [BusinessOwnerPromotionController::class, 'index']);
            Route::get('/promotions/featured', [BusinessOwnerPromotionController::class, 'featured']);
            Route::get('/promotions/{id}', [BusinessOwnerPromotionManageController::class, 'show']);
            Route::post('/promotions', [BusinessOwnerPromotionController::class, 'store']);
            Route::put('/promotions/{promotion}', [BusinessOwnerPromotionController::class, 'update']);
            Route::delete('/promotions/{promotion}', [BusinessOwnerPromotionController::class, 'destroy']);

            // Staff
            Route::get('/staff', [BusinessOwnerStaffController::class, 'index']);
            Route::get('/staff/roles', function (\Illuminate\Http\Request $request) {
                $query = \App\Models\StaffRole::select('id', 'name');

                if ($businessId = $request->query('business_id')) {
                    $business = \App\Models\Business::with('category.staffRoles')->find($businessId);
                    if ($business && $business->owner_id === $request->user()->id) {
                        $roleIds = $business->category?->staffRoles->pluck('id');
                        if ($roleIds?->isNotEmpty()) {
                            $query->whereIn('id', $roleIds);
                        }
                    }
                }

                return response()->json([
                    'success' => true,
                    'message' => 'Staff roles retrieved.',
                    'data' => $query->get(),
                ]);
            });
            Route::get('/staff/riders/{business}', [BusinessOwnerStaffController::class, 'getRiders']);
            Route::post('/staff', [BusinessOwnerStaffController::class, 'store']);
            Route::get('/staff/{staff}', [BusinessOwnerStaffController::class, 'show']);
            Route::put('/staff/{staff}', [BusinessOwnerStaffController::class, 'update']);
            Route::delete('/staff/{staff}', [BusinessOwnerStaffController::class, 'destroy']);

            // Reports
            Route::get('/reports', [BusinessOwnerReportController::class, 'sales']);
            Route::get('/reports/sales', [BusinessOwnerReportController::class, 'sales']);
            Route::get('/reports/orders', [BusinessOwnerReportController::class, 'orders']);
            Route::get('/reports/bookings', [BusinessOwnerReportController::class, 'bookings']);
            Route::get('/reports/cod-settlements', [BusinessOwnerReportController::class, 'codSettlements']);

            // Sales & Payments Dashboard
            $salesCtrl = BusinessOwnerSalesController::class;
            Route::get('/sales', [$salesCtrl, 'index']);
            Route::get('/sales/payments', [$salesCtrl, 'payments']);
            Route::get('/sales/summary', [$salesCtrl, 'summary']);

            // Customer Management
            $customerCtrl = BusinessOwnerCustomerController::class;
            Route::get('/customers', [$customerCtrl, 'index']);
            Route::get('/customers/summary', [$customerCtrl, 'summary']);
            Route::get('/customers/{customerId}', [$customerCtrl, 'show']);

            // Archive Vault
            $archiveCtrl = BusinessOwnerArchiveController::class;
            Route::get('/archive', [$archiveCtrl, 'index']);
            Route::post('/archive/{type}/{id}/restore', [$archiveCtrl, 'restore']);
            Route::delete('/archive/{type}/{id}', [$archiveCtrl, 'destroy']);

            // Kitchen Display System
            $kitchenCtrl = BusinessOwnerKitchenController::class;
            Route::get('/kitchen/orders', [$kitchenCtrl, 'orders']);
            Route::patch('/kitchen/orders/{order}/status', [$kitchenCtrl, 'updateStatus']);
            Route::patch('/kitchen/orders/{order}/items/{item}/status', [$kitchenCtrl, 'updateItemStatus']);

            // Reports Export
            $exportCtrl = BusinessOwnerExportController::class;
            Route::get('/exports/pdf', [$exportCtrl, 'pdf']);
            Route::get('/exports/csv', [$exportCtrl, 'csv']);
            Route::get('/exports/excel', [$exportCtrl, 'excel']);

            // Expenses
            $expenseCtrl = BusinessOwnerExpenseController::class;
            Route::get('/expenses', [$expenseCtrl, 'index']);
            Route::get('/expenses/summary', [$expenseCtrl, 'summary']);
            Route::post('/expenses', [$expenseCtrl, 'store']);
            Route::get('/expenses/{expense}', [$expenseCtrl, 'show']);
            Route::put('/expenses/{expense}', [$expenseCtrl, 'update']);
            Route::delete('/expenses/{expense}', [$expenseCtrl, 'destroy']);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Staff API
    // ═══════════════════════════════════════════════════════════════════
    Route::middleware('role:staff')->prefix('staff')->group(function () {
        $ctrl = StaffDashboardApiController::class;
        Route::get('/dashboard', [$ctrl, 'dashboard']);
        Route::get('/orders', [$ctrl, 'orders']);
        Route::patch('/orders/{order}/status', [$ctrl, 'updateOrderStatus']);
        Route::get('/bookings', [$ctrl, 'bookings']);
        Route::patch('/bookings/{booking}/status', [$ctrl, 'updateBookingStatus']);
        Route::get('/menu', [\App\Http\Controllers\Staff\StaffMenuController::class, 'index']);
        Route::get('/menu/{id}', [\App\Http\Controllers\Staff\StaffMenuController::class, 'show']);
        Route::post('/menu', [\App\Http\Controllers\Staff\StaffMenuController::class, 'store']);
        Route::put('/menu/{id}', [\App\Http\Controllers\Staff\StaffMenuController::class, 'update']);
        Route::delete('/menu/{id}', [\App\Http\Controllers\Staff\StaffMenuController::class, 'destroy']);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Rider API
    // ═══════════════════════════════════════════════════════════════════
    Route::middleware('role:rider')->prefix('rider')->group(function () {
        Route::get('/dashboard', [RiderController::class, 'dashboard']);
        Route::get('/profile', [RiderProfileController::class, 'show']);
        Route::put('/profile', [RiderProfileController::class, 'update']);
        Route::post('/profile/photo', [RiderProfileController::class, 'uploadPhoto']);
        Route::get('/earnings', [RiderController::class, 'earnings']);
        Route::get('/earnings/{delivery}', [RiderController::class, 'earning']);
        Route::post('/availability/toggle', [RiderController::class, 'toggleAvailability']);
        Route::post('/service', [RiderController::class, 'switchService']);
        Route::patch('/auto-accept', [RiderController::class, 'switchAutoAccept']);
        Route::get('/deliveries/pending', [RiderDeliveryController::class, 'pending']);
        Route::get('/deliveries/active', [RiderDeliveryController::class, 'active']);
        Route::get('/deliveries/completed', [RiderDeliveryController::class, 'completed']);
        Route::patch('/deliveries/{delivery}/status', [RiderDeliveryController::class, 'updateStatus']);
        Route::post('/deliveries/{delivery}/cancel-ride', [RiderDeliveryController::class, 'cancelRide']);
        Route::post('/deliveries/{delivery}/settle-cod', [RiderDeliveryController::class, 'settleCod']);
        Route::get('/deliveries/{delivery}/purchases', [RiderPurchasingController::class, 'purchases']);
        Route::get('/deliveries/{delivery}/pickup-route', [RiderDeliveryController::class, 'pickupRoute']);
        Route::get('/deliveries/{delivery}/pickup-stops', [RiderPickupStopController::class, 'index']);
        Route::post('/deliveries/{delivery}/pickup-stops/{business}/confirm', [RiderPickupStopController::class, 'confirm']);
        Route::post('/deliveries/{delivery}/purchases/{purchase}/mark', [RiderPurchasingController::class, 'mark']);
        Route::post('/deliveries/{delivery}/purchasing-cash/receive', [RiderPurchasingController::class, 'confirmCashReceipt']);
        Route::get('/dispatch/pending-request', [RiderDispatchController::class, 'pendingRequest']);
        Route::get('/dispatch/offers', [RiderDispatchController::class, 'offers']);
        Route::get('/dispatch/eligibility', [RiderDispatchController::class, 'eligibility']);
        Route::patch('/dispatch/accept', [RiderDispatchController::class, 'accept']);
        Route::patch('/dispatch/decline', [RiderDispatchController::class, 'decline']);
        Route::get('/map/location', [RiderMapController::class, 'location']);
        Route::post('/map/location', [RiderMapController::class, 'updateLocation']);
        Route::get('/messages', [MessageController::class, 'index']);

        // Payouts
        Route::get('/payouts/available', [RiderPayoutController::class, 'available']);
        Route::get('/payouts', [RiderPayoutController::class, 'index']);
        Route::post('/payouts/request', [RiderPayoutController::class, 'request']);
        Route::get('/payouts/{payout}', [RiderPayoutController::class, 'show']);
        Route::post('/payouts/{payout}/cancel', [RiderPayoutController::class, 'cancel']);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Admin API
    // ═══════════════════════════════════════════════════════════════════
    Route::middleware('role:bansud_tourism_office')->prefix('admin')->group(function () {
        // Dashboard
        Route::get('/dashboard', [AdminDashboardController::class, 'index']);
        Route::get('/map-data', [AdminMapController::class, 'index']);

        // Users
        Route::get('/users', [AdminUserController::class, 'index']);
        Route::post('/users', [AdminUserController::class, 'store']);
        Route::get('/users/{user}', [AdminUserController::class, 'show']);
        Route::put('/users/{user}', [AdminUserController::class, 'update']);
        Route::delete('/users/{user}', [AdminUserController::class, 'destroy']);
        Route::post('/users/{user}/approve', [AdminUserController::class, 'approve']);
        Route::post('/users/{user}/reject', [AdminUserController::class, 'reject']);
        Route::post('/users/{user}/suspend', [AdminUserController::class, 'suspend']);
        Route::post('/users/{user}/archive', [AdminUserController::class, 'archive']);
        Route::post('/users/{user}/restore', [AdminUserController::class, 'restore']);
        Route::post('/users/{user}/reset-password', [AdminUserController::class, 'resetPassword']);

        // Tourists (filtered users)
        Route::get('/tourists', [AdminUserController::class, 'index']);

        // Roles
        Route::get('/roles', [AdminRoleController::class, 'index']);

        // Businesses
        Route::get('/businesses', [AdminBusinessController::class, 'index']);
        Route::get('/businesses/{business}', [AdminBusinessController::class, 'show']);
        Route::post('/businesses/{business}/approve', [AdminBusinessController::class, 'approve']);
        Route::post('/businesses/{business}/reject', [AdminBusinessController::class, 'reject']);
        Route::post('/businesses/{business}/suspend', [AdminBusinessController::class, 'suspend']);
        Route::put('/businesses/{business}/documents/{document}/review', [AdminBusinessController::class, 'reviewDocument']);

        // Business Categories
        Route::get('/business-categories', [AdminBusinessCategoryController::class, 'index']);
        Route::post('/business-categories', [AdminBusinessCategoryController::class, 'store']);
        Route::put('/business-categories/{category}', [AdminBusinessCategoryController::class, 'update']);
        Route::post('/business-categories/{category}/archive', [AdminBusinessCategoryController::class, 'archive']);
        Route::post('/business-categories/{category}/unarchive', [AdminBusinessCategoryController::class, 'unarchive']);

        // Category Documents
        Route::post('/business-categories/{category}/documents', [AdminBusinessCategoryController::class, 'addDocument']);
        Route::put('/business-categories/{category}/documents/{document}', [AdminBusinessCategoryController::class, 'updateDocument']);
        Route::post('/business-categories/{category}/documents/{document}/archive', [AdminBusinessCategoryController::class, 'archiveDocument']);
        Route::post('/business-categories/{category}/documents/{document}/unarchive', [AdminBusinessCategoryController::class, 'unarchiveDocument']);
        Route::post('/business-categories/{category}/documents/{document}/toggle-required', [AdminBusinessCategoryController::class, 'toggleRequired']);

        // Municipalities
        Route::get('/municipalities', [AdminMunicipalityController::class, 'index']);

        // Riders
        Route::get('/riders', [AdminRiderController::class, 'index']);
        Route::get('/riders/fares', [AdminRiderController::class, 'fareSettings']);
        Route::put('/riders/fares', [AdminRiderController::class, 'updateFareSettings']);
        Route::get('/riders/{rider}', [AdminRiderController::class, 'show']);
        Route::post('/riders/{rider}/approve', [AdminRiderController::class, 'approve']);
        Route::post('/riders/{rider}/reject', [AdminRiderController::class, 'reject']);
        Route::post('/riders/{rider}/suspend', [AdminRiderController::class, 'suspend']);
        // Rider Payouts (admin review workflow)
        Route::get('/payouts', [AdminPayoutController::class, 'index']);
        Route::get('/payouts/{payout}', [AdminPayoutController::class, 'show']);
        Route::post('/payouts/{payout}/approve', [AdminPayoutController::class, 'approve']);
        Route::post('/payouts/{payout}/reject', [AdminPayoutController::class, 'reject']);
        Route::post('/payouts/{payout}/mark-paid', [AdminPayoutController::class, 'markPaid']);

        // Purchasing-cash (COD)
        Route::post('/deliveries/{delivery}/issue-purchasing-cash', [AdminPurchasingCashController::class, 'issue']);

        // Reports
        Route::get('/reports', [AdminReportController::class, 'system']);
        Route::get('/reports/summary', [AdminReportController::class, 'system']);
        Route::get('/reports/system', [AdminReportController::class, 'system']);
        Route::get('/reports/tourism', [AdminReportController::class, 'tourism']);
        Route::get('/reports/business', [AdminReportController::class, 'business']);
        Route::get('/reports/cod-settlements', [AdminReportController::class, 'codSettlements']);

        // POS & Sales (read-only Tourism Office sales monitoring)
        Route::get('/pos/sales', [AdminPosSalesController::class, 'sales']);
        Route::get('/pos/sales/summary', [AdminPosSalesController::class, 'summary']);
        Route::get('/pos/sales/transactions', [AdminPosSalesController::class, 'transactions']);
        Route::get('/pos/sales/by-business', [AdminPosSalesController::class, 'byBusiness']);
        Route::get('/pos/sales/trend', [AdminPosSalesController::class, 'trend']);

        // Audit Logs
        Route::get('/audit-logs', [AdminAuditLogController::class, 'index']);

        // Notifications
        Route::get('/notifications', [AdminNotificationController::class, 'index']);
        Route::post('/notifications/mark-all-read', [AdminNotificationController::class, 'markAllRead']);

        // System
        Route::get('/system/config', [AdminSystemController::class, 'config']);
        Route::get('/system/backup', [AdminSystemController::class, 'backup']);
        Route::post('/system/backup', [AdminSystemController::class, 'createBackup']);
        Route::delete('/system/backup/{id}', [AdminSystemController::class, 'deleteBackup']);
        Route::get('/system/security', [AdminSystemController::class, 'security']);
        Route::get('/system/security/logs', [AdminSystemController::class, 'securityLogs']);
        Route::get('/system/ocr-settings', [AdminSystemController::class, 'ocrSettings']);
        Route::put('/system/ocr-settings', [AdminSystemController::class, 'updateOcrSettings']);

        // Live Monitoring
        Route::get('/live/deliveries', [AdminLiveController::class, 'deliveries']);
        Route::get('/live/tours', [AdminLiveController::class, 'tours']);
        Route::get('/live/sos', [AdminLiveController::class, 'sos']);
        Route::post('/live/sos/{id}/acknowledge', [AdminLiveController::class, 'acknowledgeSos']);
        Route::post('/live/sos/{id}/respond', [AdminLiveController::class, 'respondSos']);
        Route::post('/live/sos/{id}/resolve', [AdminLiveController::class, 'resolveSos']);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Tourism Office API
    // ═══════════════════════════════════════════════════════════════════
    Route::middleware('role:tourism_office,bansud_tourism_office')->prefix('tourism-office')->group(function () {
        Route::get('/dashboard', [TourismOfficeFullController::class, 'dashboard']);
        Route::get('/business-owners', [BusinessOwnerApprovalController::class, 'index']);
        Route::get('/business-owners/{id}', [TourismOfficeFullController::class, 'showBusinessOwner']);
        Route::patch('/business-owners/{id}/status', [TourismOfficeFullController::class, 'updateBusinessOwnerStatus']);
        Route::get('/reports', [TourismOfficeFullController::class, 'reports']);

        // ─── Municipalities (for forms) ────────────────────────────────
        Route::get('/municipalities', function () {
            $municipalities = \App\Models\Municipality::select('id', 'name')->orderBy('name')->get();
            return response()->json(['success' => true, 'data' => $municipalities]);
        });

        // ─── Tourism Management ────────────────────────────────────────
        Route::get('/management/dashboard', [TourismManagementController::class, 'dashboard']);

        // Destinations
        Route::get('/destinations', [TourismManagementController::class, 'indexDestinations']);
        Route::get('/destinations/{id}', [TourismManagementController::class, 'showDestination']);
        Route::post('/destinations', [TourismManagementController::class, 'storeDestination']);
        Route::put('/destinations/{id}', [TourismManagementController::class, 'updateDestination']);
        Route::delete('/destinations/{id}', [TourismManagementController::class, 'destroyDestination']);

        // Events
        Route::get('/events', [TourismManagementController::class, 'indexEvents']);
        Route::get('/events/{id}', [TourismManagementController::class, 'showEvent']);
        Route::post('/events', [TourismManagementController::class, 'storeEvent']);
        Route::put('/events/{id}', [TourismManagementController::class, 'updateEvent']);
        Route::delete('/events/{id}', [TourismManagementController::class, 'destroyEvent']);

        // Announcements
        Route::get('/announcements', [TourismManagementController::class, 'indexAnnouncements']);
        Route::get('/announcements/{id}', [TourismManagementController::class, 'showAnnouncement']);
        Route::post('/announcements', [TourismManagementController::class, 'storeAnnouncement']);
        Route::put('/announcements/{id}', [TourismManagementController::class, 'updateAnnouncement']);
        Route::delete('/announcements/{id}', [TourismManagementController::class, 'destroyAnnouncement']);

        // Categories
        Route::get('/categories', [TourismManagementController::class, 'indexCategories']);
        Route::post('/categories', [TourismManagementController::class, 'storeCategory']);
        Route::delete('/categories/{id}', [TourismManagementController::class, 'destroyCategory']);

        // ─── Landing Page Content ─────────────────────────────────────
        Route::get('/landing-content', [LandingContentController::class, 'index']);
        Route::put('/landing-content', [LandingContentController::class, 'update']);

        // ─── Document Management ────────────────────────────────────────
        Route::get('/documents', [TourismOfficeDocumentController::class, 'indexDocuments']);
        Route::post('/documents', [TourismOfficeDocumentController::class, 'storeDocument']);
        Route::put('/documents/{id}', [TourismOfficeDocumentController::class, 'updateDocument']);
        Route::delete('/documents/{id}', [TourismOfficeDocumentController::class, 'destroyDocument']);

        // Category-Document assignments
        Route::get('/category-documents', [TourismOfficeDocumentController::class, 'indexCategories']);
        Route::get('/category-documents/{id}', [TourismOfficeDocumentController::class, 'showCategory']);
        Route::post('/category-documents/{categoryId}/documents', [TourismOfficeDocumentController::class, 'addCategoryDocument']);
        Route::put('/category-documents/{categoryId}/documents/{documentId}', [TourismOfficeDocumentController::class, 'updateCategoryDocument']);
        Route::delete('/category-documents/{categoryId}/documents/{documentId}', [TourismOfficeDocumentController::class, 'removeCategoryDocument']);
    });
});
