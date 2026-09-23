export type UserRole =
  | 'tourist'
  | 'business_owner'
  | 'staff'
  | 'rider'
  | 'bansud_tourism_office'
  | 'tourism_office'

export interface User {
  id: number
  name: string
  email: string
  role: UserRole
  account_status: 'active' | 'suspended' | 'pending_review'
  email_verified_at: string | null
  profile_photo?: string | null
  municipality?: string
  municipality_id?: number
  municipality_data?: { id: number; name: string }
  barangay?: string
  phone?: string
  created_at: string
  updated_at: string
  rider_status?: 'offline' | 'online' | 'available' | 'busy'
  current_service?: 'food' | 'transport' | null
  auto_accept?: boolean
  rider_rating?: number
}

export interface AuthResponse {
  token: string
  user: User
}

export interface Business {
  id: number
  name: string
  slug: string
  description: string
  category: string
  category_id: number
  municipality_id: number
  municipality: string
  barangay: string
  address: string
  phone: string
  email: string
  logo: string | null
  cover_photo: string | null
  rating: number | null
  is_open: boolean
  force_closed: boolean | null
  status: 'under_review' | 'pending' | 'approved' | 'active' | 'pending_review' | 'suspended' | 'rejected'
  latitude: number | null
  longitude: number | null
  opening_time: string | null
  closing_time: string | null
  created_at: string
  updated_at: string
}

export interface MenuItem {
  id: number
  business_id: number
  name: string
  description: string
  price: number
  category: string
  image: string | null
  is_available: boolean
  is_featured: boolean
  created_at: string
}

export interface Booking {
  id: number
  booking_number: string
  business_id: number
  user_id: number
  customer_name: string
  booking_type: string
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
  check_in_date: string | null
  check_out_date: string | null
  total_amount: number
  notes: string | null
  created_at: string
  updated_at: string
}

/** A single food line inside an order (OrderItemResource payload). */
export interface OrderItem {
  id: number
  business_id?: number
  product_name: string
  quantity: number
  unit_price: number
  /** Line total (subtotal) — server field is `total_price`. */
  total_price?: number
  preparation_time?: number | null
  status?: string
  accepted_at?: string | null
  preparation_started_at?: string | null
  ready_at?: string | null
  special_notes?: string | null
}

export interface Order {
  id: number
  order_number: string
  business_id: number
  user_id: number
  customer_name: string
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'in_progress' | 'completed' | 'cancelled' | string
  total: number
  notes: string | null
  created_at: string
  updated_at: string
  order_type?: string | null
  customer_email?: string | null
  customer_phone?: string | null
  delivery_address?: string | null
  subtotal?: number | null
  delivery_fee?: number | null
  discount?: number | null
  /** OrderResource exposes the order notes as `special_instructions`. */
  special_instructions?: string | null
  items?: OrderItem[]
  group_order_id?: number | null
  group_reference_number?: string | null
  group_paid?: boolean
  rider_tip?: number | string | null
  delivery_speed?: string | null
  preparation_time?: number | null
  preparation_started_at?: string | null
  predicted_ready_at?: string | null
  food_ready_at?: string | null
}

export interface Event {
  id: number
  name: string
  description: string
  date: string
  location: string
  municipality: string
  cover_photo: string | null
  created_at: string
}

export interface Municipality {
  id: number
  name: string
  slug: string
  barangays: Barangay[]
}

export interface Barangay {
  id: number
  name: string
  municipality_id: number
}

export interface RequiredDocument {
  id: number
  business_category_id: number
  document_name: string
  document_code: string | null
  is_required: boolean
  has_expiration: boolean
  validity_period: number | null
  description: string | null
  required_fields: string[] | null
  is_active: boolean
  sort_order: number
  grace_period_days: number | null
}

export interface BusinessCategory {
  id: number
  name: string
  slug: string
  icon: string | null
  description: string | null
  archived_at: string | null
  required_documents?: RequiredDocument[]
}

export interface Review {
  id: number
  user_id: number
  business_id: number
  rating: number
  comment: string
  user_name: string
  created_at: string
}

export interface Delivery {
  id: number
  order_id: number
  rider_id: number | null
  status: 'pending' | 'assigned' | 'picked_up' | 'delivered' | 'cancelled'
  is_cod?: boolean
  cash_due?: number | null
  cash_received?: number | null
  change_given?: number | null
  cash_settled_at?: string | null
  pickup_address: string
  delivery_address: string
  latitude: number | null
  longitude: number | null
  created_at: string
  updated_at: string
}

export interface Notification {
  id: number
  type: string
  title: string
  message: string
  read_at: string | null
  created_at: string
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: {
    current_page: number
    last_page: number
    per_page: number
    total: number
  }
}

export interface ApiResponse<T> {
  data: T
  message?: string
}

export interface DashboardStats {
  [key: string]: number | string
}

export interface FormDraftFile {
  name: string
  mimeType: string
  size: number
  url?: string
  storagePath?: string
  thumbnailUrl?: string
  uploadStatus: 'pending' | 'uploading' | 'uploaded' | 'failed'
  serverId?: string | number
  crop?: { x: number; y: number; width: number; height: number }
  rotation?: number
  zoom?: number
  aspectRatio?: number
  caption?: string
  altText?: string
}

export interface FormDraftUiState {
  currentStep?: number
  completedSteps?: number[]
  expandedSections?: string[]
  activeTab?: string
  selectedAccordion?: string
  wizardPage?: number
  [key: string]: unknown
}

export interface FormDraftData {
  version: number
  lastSaved: number
  formId: string
  fields: Record<string, unknown>
  uiState?: FormDraftUiState
  files?: Record<string, FormDraftFile[]>
}

export interface ServerFormDraft {
  id: number
  user_id: number
  draft_key: string
  form_id: string
  fields: Record<string, unknown>
  ui_state: FormDraftUiState | null
  version: number
  expires_at: string | null
  updated_at: string
}
