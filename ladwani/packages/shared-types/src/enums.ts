export const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'NOT_STATED'] as const
export type Gender = (typeof GENDERS)[number]

export const MARITAL_STATUSES = ['UNMARRIED', 'MARRIED', 'WIDOWED', 'DIVORCED', 'SEPARATED', 'NOT_STATED'] as const
export type MaritalStatus = (typeof MARITAL_STATUSES)[number]

export const MEMBER_STATUSES = ['ACTIVE', 'INACTIVE', 'DECEASED', 'SUSPENDED'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

export const USER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'BLOCKED', 'DEACTIVATED'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const FAMILY_STATUSES = ['PENDING', 'ACTIVE', 'INACTIVE', 'MERGED', 'ARCHIVED'] as const
export type FamilyStatus = (typeof FAMILY_STATUSES)[number]

export const VERIFICATION_STATUSES = ['UNVERIFIED', 'VERIFIED', 'REJECTED'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export const JOIN_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'DECLINED'] as const
export type JoinRequestStatus = (typeof JOIN_REQUEST_STATUSES)[number]

export const APPROVAL_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RETURNED', 'ESCALATED'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

export const MATRIMONY_INTEREST_KINDS = ['INTEREST', 'CONTACT_REQUEST'] as const
export type MatrimonyInterestKind = (typeof MATRIMONY_INTEREST_KINDS)[number]

export const MATRIMONY_INTEREST_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN'] as const
export type MatrimonyInterestStatus = (typeof MATRIMONY_INTEREST_STATUSES)[number]

export const POST_STATUSES = ['PENDING_APPROVAL', 'PUBLISHED', 'REJECTED', 'REMOVED'] as const
export type PostStatus = (typeof POST_STATUSES)[number]

export const REACTION_TYPES = ['LIKE', 'LOVE', 'CELEBRATE', 'SUPPORT'] as const
export type ReactionType = (typeof REACTION_TYPES)[number]

export const REPORT_STATUSES = ['PENDING', 'REVIEWED', 'DISMISSED', 'ACTIONED'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export const ASSET_STATUSES = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'REJECTED'] as const
export type AssetStatus = (typeof ASSET_STATUSES)[number]

export const ASSET_AVAILABILITY_STATUSES = ['AVAILABLE', 'PENDING', 'RESERVED', 'BLOCKED', 'MAINTENANCE', 'HOLIDAY'] as const
export type AssetAvailabilityStatus = (typeof ASSET_AVAILABILITY_STATUSES)[number]

export const ASSET_PRICE_TYPES = ['BASE', 'SEASONAL', 'WEEKEND', 'COMMUNITY_MEMBER'] as const
export type AssetPriceType = (typeof ASSET_PRICE_TYPES)[number]

export const BOOKING_TYPES = ['INSTANT', 'REQUEST'] as const
export type BookingType = (typeof BOOKING_TYPES)[number]

export const BOOKING_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'DECLINED',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'EXPIRED',
] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

export const PAYMENT_PURPOSE_TYPES = ['FEE', 'BOOKING', 'DONATION'] as const
export type PaymentPurposeType = (typeof PAYMENT_PURPOSE_TYPES)[number]

// docs/10-payment-architecture.md §4
export const PAYMENT_TRANSACTION_STATUSES = [
  'CREATED',
  'PENDING',
  'INITIATED',
  'PROCESSING',
  'SUCCESSFUL',
  'FAILED',
  'CANCELLED',
  'UNDER_VERIFICATION',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const
export type PaymentTransactionStatus = (typeof PAYMENT_TRANSACTION_STATUSES)[number]

export const REFUND_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const
export type RefundStatus = (typeof REFUND_STATUSES)[number]

export const FEE_INVOICE_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED'] as const
export type FeeInvoiceStatus = (typeof FEE_INVOICE_STATUSES)[number]

export const FEE_FREQUENCIES = ['ONE_TIME', 'MONTHLY', 'ANNUAL', 'EVENT'] as const
export type FeeFrequency = (typeof FEE_FREQUENCIES)[number]

export const OFFLINE_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE'] as const
export type OfflinePaymentMethod = (typeof OFFLINE_PAYMENT_METHODS)[number]

export const OFFLINE_PAYMENT_STATUSES = ['PENDING_VERIFICATION', 'VERIFIED', 'REJECTED'] as const
export type OfflinePaymentStatus = (typeof OFFLINE_PAYMENT_STATUSES)[number]

export const AREA_TYPES = ['COUNTRY', 'STATE', 'DISTRICT', 'CITY', 'AREA', 'GROUP'] as const
export type AreaType = (typeof AREA_TYPES)[number]

export const UPLOAD_PURPOSES = ['PROFILE_PHOTO', 'ASSET_PHOTO', 'DOCUMENT'] as const
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number]

export const UPLOADED_FILE_STATUSES = ['PENDING', 'ACTIVE', 'REJECTED'] as const
export type UploadedFileStatus = (typeof UPLOADED_FILE_STATUSES)[number]

export const INCOME_RANGES = ['BELOW_2L', 'L2_5L', 'L5_10L', 'L10_25L', 'ABOVE_25L', 'NOT_DISCLOSED'] as const
export type IncomeRange = (typeof INCOME_RANGES)[number]
