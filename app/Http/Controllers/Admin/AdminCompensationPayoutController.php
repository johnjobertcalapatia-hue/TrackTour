<?php

namespace App\Http\Controllers\Admin;

use App\Exceptions\PayoutConflictException;
use App\Http\Controllers\Controller;
use App\Models\RiderCompensationPayout;
use App\Models\User;
use App\Services\PayoutStatementService;
use App\Services\RiderStatementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Stage D2 (§P.5): cancellation compensation paid on its own (a rider with no
 * online earnings to cash out). A compensation linked to an earnings cashout
 * is handled through that cashout (one office action); these actions refuse it.
 * Also the rider earnings statement for the office.
 */
class AdminCompensationPayoutController extends Controller
{
    public function __construct(private readonly PayoutStatementService $statements) {}

    /** GET /admin/compensation-payouts?status= */
    public function index(Request $request): JsonResponse
    {
        $status = $request->query('status');
        $rows = RiderCompensationPayout::with('rider:id,name')
            ->when($status === 'open', fn ($q) => $q->whereIn('status', RiderCompensationPayout::LIVE_STATUSES))
            ->when($status && $status !== 'open', fn ($q) => $q->where('status', $status))
            ->latest('id')->limit(100)->get();

        return $this->successResponse($rows->map(fn ($p) => $p->present() + ['rider_name' => $p->rider?->name, 'standalone' => $p->rider_payout_id === null])->values());
    }

    public function show(RiderCompensationPayout $payout): JsonResponse
    {
        return $this->successResponse($this->detail($payout));
    }

    public function startReview(Request $request, RiderCompensationPayout $payout): JsonResponse
    {
        return $this->act(fn () => $this->statements->startReviewCompensationOnly($payout, $request->user()), 'Review started.');
    }

    public function approve(Request $request, RiderCompensationPayout $payout): JsonResponse
    {
        // Same re-authentication as the existing cashout approval.
        $data = $request->validate(['password' => ['required', 'string'], 'note' => ['nullable', 'string', 'max:500']]);
        $this->reauthenticate($request->user(), $data['password']);

        return $this->act(fn () => $this->statements->approveCompensationOnly($payout, $request->user(), $data['note'] ?? null), 'Approved. Send the GCash transfer, then confirm the payment.');
    }

    public function reject(Request $request, RiderCompensationPayout $payout): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:500']]);

        return $this->act(fn () => $this->statements->rejectCompensationOnly($payout, $request->user(), $data['reason']), 'Rejected; the compensation is available again.');
    }

    public function markPaid(Request $request, RiderCompensationPayout $payout): JsonResponse
    {
        $data = $request->validate([
            'password' => ['required', 'string'],
            'reference' => ['required', 'string', 'max:64'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'recipient_number' => ['required', 'string', 'regex:/^09\d{9}$/'],
            'recipient_name' => ['required', 'string', 'max:120'],
            'paid_at' => ['required', 'date', 'before_or_equal:now'],
            'proof' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:8192'],
        ], ['recipient_number.regex' => 'Enter the GCash number as 09XXXXXXXXX.', 'proof.required' => 'Attach the screenshot or photo of the GCash transfer.']);
        $this->reauthenticate($request->user(), $data['password']);

        return $this->act(fn () => $this->statements->markPaidCompensationOnly($payout, $request->user(), [
            'reference' => $data['reference'], 'amount' => $data['amount'], 'recipient_number' => $data['recipient_number'],
            'recipient_name' => $data['recipient_name'], 'paid_at' => $data['paid_at'], 'proof' => $request->file('proof'),
        ]), 'Payment confirmed.');
    }

    public function markFailed(Request $request, RiderCompensationPayout $payout): JsonResponse
    {
        $data = $request->validate(['password' => ['required', 'string'], 'reason' => ['required', 'string', 'min:3', 'max:500']]);
        $this->reauthenticate($request->user(), $data['password']);

        return $this->act(fn () => $this->statements->markFailedCompensationOnly($payout, $request->user(), $data['reason']), 'Marked failed; the compensation is available again.');
    }

    /** GET /admin/riders/{rider}/statement */
    public function riderStatement(User $rider, RiderStatementService $statement): JsonResponse
    {
        if ($rider->role !== User::ROLE_RIDER) {
            return $this->errorResponse('Not a rider.', 404);
        }

        return $this->successResponse($statement->for($rider));
    }

    private function reauthenticate(User $staff, string $password): void
    {
        if (! Hash::check($password, $staff->password)) {
            throw ValidationException::withMessages(['password' => 'Your password is incorrect.']);
        }
    }

    private function act(callable $action, string $message): JsonResponse
    {
        try {
            return $this->successResponse($this->detail($action()), $message);
        } catch (PayoutConflictException $e) {
            return $this->errorResponse($e->getMessage(), 409);
        }
    }

    private function detail(RiderCompensationPayout $payout): array
    {
        $payout = $payout->fresh() ?? $payout;

        return $payout->present() + [
            'rider_name' => $payout->rider?->name,
            'standalone' => $payout->rider_payout_id === null,
            'validation' => $this->statements->validate($payout),
        ];
    }
}
