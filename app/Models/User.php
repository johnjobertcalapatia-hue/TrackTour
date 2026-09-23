<?php

namespace App\Models;

use App\Notifications\ResetPassword;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    public function sendPasswordResetNotification(#[\SensitiveParameter] $token): void
    {
        $this->notify(new ResetPassword($token));
    }

    public const ROLE_TOURIST = 'tourist';

    public const ROLE_BUSINESS_OWNER = 'business_owner';

    public const ROLE_RIDER = 'rider';

    public const ROLE_TOURISM_OFFICE = 'tourism_office';

    public const ROLE_BANSUD_TOURISM_OFFICE = 'bansud_tourism_office';

    public const ROLES = [
        self::ROLE_TOURIST,
        self::ROLE_BUSINESS_OWNER,
        self::ROLE_RIDER,
        self::ROLE_TOURISM_OFFICE,
        self::ROLE_BANSUD_TOURISM_OFFICE,
    ];

    public const REGISTRABLE_ROLES = [
        self::ROLE_TOURIST,
        self::ROLE_BUSINESS_OWNER,
        self::ROLE_RIDER,
    ];

    public const ACCOUNT_STATUS_PENDING = 'pending_review';

    public const ACCOUNT_STATUS_APPROVED = 'approved';

    public const ACCOUNT_STATUS_REJECTED = 'rejected';

    public const ACCOUNT_STATUS_SUSPENDED = 'suspended';

    public const ACCOUNT_STATUSES = [
        self::ACCOUNT_STATUS_PENDING,
        self::ACCOUNT_STATUS_APPROVED,
        self::ACCOUNT_STATUS_REJECTED,
        self::ACCOUNT_STATUS_SUSPENDED,
    ];

    public const RIDER_STATUS_OFFLINE = 'offline';

    public const RIDER_STATUS_ONLINE = 'online';

    public const RIDER_STATUS_AVAILABLE = 'available';

    public const RIDER_STATUS_BUSY = 'busy';

    public const RIDER_STATUSES = [
        self::RIDER_STATUS_OFFLINE,
        self::RIDER_STATUS_ONLINE,
        self::RIDER_STATUS_AVAILABLE,
        self::RIDER_STATUS_BUSY,
    ];

    public const SERVICE_FOOD = 'food';

    public const SERVICE_TRANSPORT = 'transport';

    public const RIDER_SERVICES = [
        self::SERVICE_FOOD,
        self::SERVICE_TRANSPORT,
    ];

    public const SEX_OPTIONS = ['male', 'female'];

    public const NATIONALITIES = [
        'Filipino', 'Afghan', 'Albanian', 'Algerian', 'American', 'Andorran', 'Angolan', 'Antiguans', 'Argentinean', 'Armenian',
        'Australian', 'Austrian', 'Azerbaijani', 'Bahamian', 'Bahraini', 'Bangladeshi', 'Barbadian', 'Barbudans', 'Batswana',
        'Belarusian', 'Belgian', 'Belizean', 'Beninese', 'Bhutanese', 'Bolivian', 'Bosnian', 'Brazilian', 'British', 'Bruneian',
        'Bulgarian', 'Burkinabe', 'Burmese', 'Burundian', 'Cambodian', 'Cameroonian', 'Canadian', 'Cape Verdean', 'Central African',
        'Chadian', 'Chilean', 'Chinese', 'Colombian', 'Comoran', 'Congolese', 'Costa Rican', 'Croatian', 'Cuban', 'Cypriot',
        'Czech', 'Danish', 'Djiboutian', 'Dominican', 'Dutch', 'East Timorese', 'Ecuadorian', 'Egyptian', 'Emirian', 'Equatorial Guinean',
        'Eritrean', 'Estonian', 'Ethiopian', 'Fijian', 'Finnish', 'French', 'Gabonese', 'Gambian', 'Georgian', 'German', 'Ghanaian',
        'Greek', 'Grenadian', 'Guatemalan', 'Guinea-Bissauan', 'Guinean', 'Guyanese', 'Haitian', 'Herzegovinian', 'Honduran',
        'Hungarian', 'I-Kiribati', 'Icelander', 'Indian', 'Indonesian', 'Iranian', 'Iraqi', 'Irish', 'Israeli', 'Italian',
        'Ivorian', 'Jamaican', 'Japanese', 'Jordanian', 'Kazakhstani', 'Kenyan', 'Kittian and Nevisian', 'Kuwaiti', 'Kyrgyz',
        'Laotian', 'Latvian', 'Lebanese', 'Liberian', 'Libyan', 'Liechtensteiner', 'Lithuanian', 'Luxembourger', 'Macedonian',
        'Malagasy', 'Malawian', 'Malaysian', 'Maldivian', 'Malian', 'Maltese', 'Marshallese', 'Mauritanian', 'Mauritian',
        'Mexican', 'Micronesian', 'Moldovan', 'Monacan', 'Mongolian', 'Moroccan', 'Mosotho', 'Motswana', 'Mozambican', 'Namibian',
        'Nauruan', 'Nepalese', 'New Zealander', 'Nicaraguan', 'Nigerian', 'Nigerien', 'North Korean', 'Northern Irish', 'Norwegian',
        'Omani', 'Pakistani', 'Palauan', 'Panamanian', 'Papua New Guinean', 'Paraguayan', 'Peruvian', 'Polish', 'Portuguese',
        'Qatari', 'Romanian', 'Russian', 'Rwandan', 'Saint Lucian', 'Salvadoran', 'Samoan', 'San Marinese', 'Sao Tomean', 'Saudi',
        'Scottish', 'Senegalese', 'Serbian', 'Seychellois', 'Sierra Leonean', 'Singaporean', 'Slovakian', 'Slovenian', 'Solomon Islander',
        'Somali', 'South African', 'South Korean', 'Spanish', 'Sri Lankan', 'Sudanese', 'Surinamer', 'Swazi', 'Swedish', 'Swiss',
        'Syrian', 'Taiwanese', 'Tajik', 'Tanzanian', 'Thai', 'Togolese', 'Tongan', 'Trinidadian or Tobagonian', 'Tunisian', 'Turkish',
        'Tuvaluan', 'Ugandan', 'Ukrainian', 'Uruguayan', 'Uzbekistani', 'Venezuelan', 'Vietnamese', 'Welsh', 'Yemenite', 'Zambian',
        'Zimbabwean',
    ];

    public const GOVERNMENT_ID_TYPES = [
        'passport',
        'drivers_license',
        'national_id',
        'umid',
        'prc_id',
        'voters_id',
        'postal_id',
        'tin_id',
        'philhealth_id',
        'sss_id',
        'gsis_id',
        'barangay_id',
        'senior_citizen_id',
        'pwd_id',
        'other',
    ];

    public const BUSINESS_CATEGORIES = [
        'restaurant',
        'hotel',
        'resort',
        'tour_guide',
        'transportation',
        'retail',
        'entertainment',
        'other',
    ];

    protected $fillable = [
        'email',
        'email_verified_at',
        'password',
        'name',
        'role',
        'account_status',
        'municipality_id',
        'gcash_number',
        'gcash_account_name',
        'failed_login_attempts',
        'locked_until',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'locked_until' => 'datetime',
        ];
    }

    public function getFullNameAttribute(): string
    {
        return trim(collect([
            $this->profile?->first_name,
            $this->profile?->middle_name,
            $this->profile?->last_name,
            $this->profile?->suffix,
        ])->filter()->implode(' ')) ?: ($this->name ?? $this->email);
    }

    public function profile(): HasOne
    {
        return $this->hasOne(UserProfile::class);
    }

    public function kyc(): HasOne
    {
        return $this->hasOne(UserKyc::class);
    }

    public function tourist(): HasOne
    {
        return $this->hasOne(Tourist::class);
    }

    public function riderDetail(): HasOne
    {
        return $this->hasOne(RiderDetail::class);
    }

    public function businesses(): HasMany
    {
        return $this->hasMany(Business::class, 'owner_id');
    }

    public function staff(): HasMany
    {
        return $this->hasMany(Staff::class);
    }

    public function notifications(): HasMany
    {
        return $this->hasMany(Notification::class);
    }

    public function activityLogs(): HasMany
    {
        return $this->hasMany(ActivityLog::class);
    }

    public function approvalRequests(): HasMany
    {
        return $this->hasMany(ApprovalRequest::class);
    }

    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class, 'user_roles')
            ->withTimestamps();
    }

    public function reviews(): HasMany
    {
        return $this->hasMany(Review::class);
    }

    public function riderReviews(): HasMany
    {
        return $this->hasMany(RiderReview::class, 'rider_id');
    }

    public function adminReviews(): HasMany
    {
        return $this->hasMany(RiderReview::class, 'admin_id');
    }

    public function deliveries(): HasMany
    {
        return $this->hasMany(Delivery::class, 'rider_id');
    }

    public function locations(): HasMany
    {
        return $this->hasMany(RiderLocation::class, 'rider_id');
    }

    public function dispatchLogs(): HasMany
    {
        return $this->hasMany(BookingDispatchLog::class, 'rider_id');
    }

    public function favorites(): HasMany
    {
        return $this->hasMany(Favorite::class);
    }

    public function municipality(): BelongsTo
    {
        return $this->belongsTo(Municipality::class);
    }
}
