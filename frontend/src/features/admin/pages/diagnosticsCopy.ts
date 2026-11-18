// Plain-language wording for System Diagnostics, written for Tourism Office
// staff rather than developers. The server's own (technical) text stays
// available under "Technical details".

export type FixedBy = 'you' | 'technical' | 'staff'

export interface CheckCopy {
  /** Shown when the check is healthy. */
  ok: string
  /** Shown when there is a problem. */
  problem: string
  /** What the problem means for tourists, riders and restaurants. */
  meaning: string
  /** Who can resolve it. */
  fixedBy: FixedBy
  /** What a technical person must do on the server (shown with a Copy button). */
  techStep?: { text: string; command?: string }
  /** What a staff member must decide or review. */
  staffStep?: string
}

export const CHECK_COPY: Record<string, CheckCopy> = {
  database: {
    ok: 'Database is working',
    problem: 'The database is slow',
    meaning: 'Pages, orders and payments may take longer to load.',
    fixedBy: 'technical',
    techStep: { text: 'Check the database server for heavy load or low resources.' },
  },
  scheduler: {
    ok: 'Automatic tasks are running',
    problem: 'Automatic tasks have stopped',
    meaning: 'New orders are not sent to riders automatically, unanswered rider offers do not move on, food timers do not finish, and refunds are not checked with GCash.',
    fixedBy: 'technical',
    techStep: { text: 'Keep the automatic-task process running on the server:', command: 'php artisan schedule:work' },
  },
  queue: {
    ok: 'Background tasks are working',
    problem: 'Background tasks need attention',
    meaning: 'Things that happen behind the scenes — like notifications — may be delayed or not sent.',
    fixedBy: 'you',
    techStep: { text: 'Keep a background worker running on the server:', command: 'php artisan queue:work' },
  },
  realtime: {
    ok: 'Live tracking is online',
    problem: 'Live tracking is offline',
    meaning: 'Maps do not move live and riders do not get instant order alerts. People can still refresh the page to see updates.',
    fixedBy: 'technical',
    techStep: { text: 'Start the live tracking server:', command: 'node socket-server.js' },
  },
  storage: {
    ok: 'Photos and files are available',
    problem: 'Photos or file storage has a problem',
    meaning: 'Uploaded photos and documents may not show, or the server is running out of space.',
    fixedBy: 'you',
    techStep: { text: 'If space is low, free up disk space on the server.' },
  },
  configuration: {
    ok: 'Settings are complete',
    problem: 'Some settings are missing',
    meaning: 'GCash payments, refunds or payment confirmations may not work until these are set.',
    fixedBy: 'technical',
    techStep: { text: 'Add the missing values to the server settings file (.env), then press "Refresh settings".' },
  },
  migrations: {
    ok: 'Database is up to date',
    problem: 'A database update is waiting',
    meaning: 'A new feature’s database change has not been applied. Nothing is broken now, but that feature may not work yet.',
    fixedBy: 'technical',
    techStep: { text: 'Review the update and apply it on the server. (For safety, this page never applies database updates.)' },
  },
  offer_timeouts: {
    ok: 'Rider offers move on normally',
    problem: 'Rider offers are stuck',
    meaning: 'When a rider does not answer an order, it is not passed on to the next rider.',
    fixedBy: 'you',
  },
  scheduled_dispatch: {
    ok: 'Orders reach riders normally',
    problem: 'Orders are waiting to be sent to riders',
    meaning: 'These orders have not been offered to any rider yet.',
    fixedBy: 'you',
  },
  preparation_starts: {
    ok: 'Restaurants start cooking on time',
    problem: 'Restaurants have not been told to start cooking',
    meaning: 'A rider accepted these orders, but the restaurant still shows them as waiting.',
    fixedBy: 'you',
  },
  preparation_timers: {
    ok: 'Food timers are on time',
    problem: 'Food timers are overdue',
    meaning: 'The food should be ready but is not marked ready, so riders may be kept waiting.',
    fixedBy: 'you',
  },
  stale_riders: {
    ok: 'No riders are stuck',
    problem: 'Some riders are stuck as “busy”',
    meaning: 'They have no delivery, but they cannot receive new orders.',
    fixedBy: 'you',
  },
  double_deliveries: {
    ok: 'Each rider has one delivery at a time',
    problem: 'A rider has two deliveries at once',
    meaning: 'Riders may only carry one delivery at a time. This cannot be fixed automatically.',
    fixedBy: 'staff',
    staffStep: 'Open the deliveries, decide which one to reassign, and release it.',
  },
  trips: {
    ok: 'Active trips are correct',
    problem: 'Some trips show the wrong step',
    meaning: 'The rider’s app may show the wrong next step for these deliveries.',
    fixedBy: 'you',
    staffStep: 'If a trip skipped a pickup confirmation, open it and review what happened.',
  },
  ready_items: {
    ok: 'Ready orders are correct',
    problem: 'Ready orders still show food as cooking',
    meaning: 'Riders may not be able to pick these orders up.',
    fixedBy: 'you',
  },
  refunds: {
    ok: 'No refunds are delayed',
    problem: 'Refunds are waiting for GCash',
    meaning: 'Customers are waiting for their money back. The refund is only finished when GCash / PayMongo confirms it.',
    fixedBy: 'you',
  },
  integrity: {
    ok: 'Payment records match',
    problem: 'Some payment records do not match',
    meaning: 'A record may have been changed outside the app. This is never fixed automatically.',
    fixedBy: 'staff',
    staffStep: 'Review the affected orders, correct the cause, then press "Check again".',
  },
  error_log: {
    ok: 'No errors recorded',
    problem: 'The system recorded errors',
    meaning: 'Something went wrong behind the scenes. Users may have seen an error message.',
    fixedBy: 'technical',
    techStep: { text: 'Share the technical details below with your technical person.' },
  },
}

/** Plain button labels and explanations for the server's fix actions. */
export const FIX_COPY: Record<string, { label: string; explain: string }> = {
  run_automation: { label: 'Run them once now', explain: 'Sends waiting orders to riders, moves on unanswered offers and updates food timers — one time. They will stop again until the automatic-task process is restarted.' },
  process_offer_timeouts: { label: 'Move offers on now', explain: 'Passes unanswered orders to the next available rider.' },
  dispatch_scheduled: { label: 'Send to riders now', explain: 'Offers the waiting orders to the nearest available riders.' },
  advance_preparation: { label: 'Update restaurants now', explain: 'Tells restaurants to start cooking where a rider has accepted, and marks finished food timers as ready.' },
  reconcile_refunds: { label: 'Check with GCash now', explain: 'Asks GCash / PayMongo whether each refund went through. It never sends money twice.' },
  repair_ready_items: { label: 'Mark the food ready', explain: 'Marks the food as ready on orders the restaurant already marked ready.' },
  release_stale_riders: { label: 'Free these riders', explain: 'Makes riders who have no delivery available for new orders again.' },
  resync_trips: { label: 'Correct the trips', explain: 'Updates each trip to match what the rider actually recorded. It never marks a step done that was not done.' },
  retry_failed_jobs: { label: 'Try them again', explain: 'Runs the failed background tasks again.' },
  clear_failed_jobs: { label: 'Delete failed tasks', explain: 'Removes the failed background tasks permanently. They cannot be tried again afterwards.' },
  process_queue: { label: 'Process them now', explain: 'Works through the waiting background tasks now.' },
  verify_integrity: { label: 'Check again', explain: 'Checks the payment records again. It only reads them and never changes anything.' },
  storage_link: { label: 'Repair photo link', explain: 'Reconnects the folder that serves uploaded photos and documents.' },
  clear_caches: { label: 'Refresh settings', explain: 'Reloads the system settings so recent changes take effect.' },
  acknowledge_errors: { label: 'Mark as seen', explain: 'Hides the errors recorded so far. Only new errors will be shown.' },
}

/** Plain names and one-line meanings for the health measures. */
export const MEASURE_COPY: Record<string, { label: string; meaning: string }> = {
  db_latency: { label: 'Database speed', meaning: 'How fast the system answers.' },
  realtime_latency: { label: 'Live tracking speed', meaning: 'How fast the live map server answers.' },
  scheduler_lag: { label: 'Automatic tasks last ran', meaning: 'Should run every minute.' },
  queue_backlog: { label: 'Background tasks waiting', meaning: 'Tasks waiting more than 5 minutes.' },
  failed_jobs: { label: 'Failed background tasks', meaning: 'In the last 24 hours.' },
  disk_free: { label: 'Free storage space', meaning: 'Room left for photos and records.' },
  error_rate: { label: 'Errors recorded', meaning: 'In the last 24 hours.' },
  dispatch_success: { label: 'Orders that found a rider', meaning: 'Share of orders a rider accepted.' },
  time_to_rider: { label: 'Time to find a rider', meaning: 'Typical wait after an order is placed.' },
  on_time: { label: 'Delivered within 60 minutes', meaning: 'From rider acceptance to delivery.' },
  order_completion: { label: 'Orders completed', meaning: 'Finished orders that were not cancelled.' },
  payment_success: { label: 'Successful payments', meaning: 'GCash payments that went through.' },
  gps_freshness: { label: 'Riders sharing location', meaning: 'Online riders seen on the map recently.' },
}

export const GRADE_MEANING: Record<string, string> = {
  Excellent: 'Everything is running smoothly.',
  Good: 'Running well, with a few small issues.',
  Fair: 'Working, but some things need attention.',
  Poor: 'Several important things need fixing.',
  'Not enough data': 'Not enough activity yet to measure.',
}
