# Phase 1.5 — Database ER Diagrams

Split into domain-focused diagrams rather than one unreadable mega-diagram. Full column lists live in `06-database-schema.md`; these show cardinality and the shape of each domain.

## 5.1 Identity, Family & Tree

```mermaid
erDiagram
    COMMUNITIES ||--o{ USERS : "role grants scoped to"
    USERS ||--o{ USER_ROLES : has
    ROLES ||--o{ USER_ROLES : "granted via"
    ROLES ||--o{ ROLE_PERMISSIONS : bundles
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : "included in"
    USERS ||--o| MEMBERS : "is (optional 1:1)"
    COMMUNITIES ||--o{ FAMILIES : owns
    FAMILIES ||--o{ FAMILY_MEMBERS : has
    MEMBERS ||--o{ FAMILY_MEMBERS : "belongs to"
    FAMILIES ||--o| MEMBERS : "karta_member_id"
    FAMILIES ||--o{ ADDRESSES : has
    MEMBERS ||--o{ ADDRESSES : has
    MEMBERS ||--o{ MEMBER_RELATIONSHIPS : "from_member"
    MEMBERS ||--o{ MEMBER_RELATIONSHIPS : "to_member"
    RELATIONSHIP_TYPES ||--o{ MEMBER_RELATIONSHIPS : classifies
    FAMILIES ||--o{ FAMILY_JOIN_REQUESTS : receives
    MEMBERS ||--o{ FAMILY_JOIN_REQUESTS : "requested for"

    COMMUNITIES {
        string id PK "cuid, varchar(191)"
        string name
        string slug
    }
    USERS {
        string id PK "cuid, varchar(191)"
        string email
        string mobile
        string password_hash
        string status
    }
    MEMBERS {
        string id PK "cuid, varchar(191)"
        string user_id FK "nullable"
        string first_name
        string last_name
        date date_of_birth
        string gender
        string marital_status
        string status "ACTIVE/DECEASED/..."
    }
    FAMILIES {
        string id PK "cuid, varchar(191)"
        string community_id FK
        string registration_number
        string name
        string karta_member_id FK
        string verification_status
    }
    MEMBER_RELATIONSHIPS {
        string id PK "cuid, varchar(191)"
        string from_member_id FK
        string to_member_id FK
        string relationship_type_id FK
        string family_id FK
    }
```

## 5.2 Education, Employment, Skills, Income

```mermaid
erDiagram
    MEMBERS ||--o{ EDUCATION_RECORDS : has
    MEMBERS ||--o{ EMPLOYMENT_RECORDS : has
    MEMBERS ||--o{ BUSINESSES : owns
    MEMBERS ||--o{ MEMBER_SKILLS : has
    SKILLS ||--o{ MEMBER_SKILLS : "tagged via"
    INCOME_RANGES ||--o{ EMPLOYMENT_RECORDS : buckets
    INCOME_RANGES ||--o{ BUSINESSES : buckets
```

## 5.3 Matrimony

```mermaid
erDiagram
    MEMBERS ||--o| MATRIMONIAL_PROFILES : "opts into"
    MATRIMONIAL_PROFILES ||--o| MATRIMONIAL_PREFERENCES : has
    MEMBERS ||--o{ MATRIMONIAL_INTERESTS : "sends (from)"
    MEMBERS ||--o{ MATRIMONIAL_INTERESTS : "receives (to)"
    MEMBERS ||--o{ MATRIMONIAL_SAVES : saves
```

## 5.4 Community Social Network & Areas

```mermaid
erDiagram
    COMMUNITIES ||--o{ AREAS : "top-level of"
    AREAS ||--o{ AREAS : "parent of"
    AREAS ||--o{ MEMBER_AREAS : "linked to"
    AREAS ||--o{ FAMILY_AREAS : "linked to"
    MEMBERS ||--o{ MEMBER_AREAS : "belongs to"
    FAMILIES ||--o{ FAMILY_AREAS : "belongs to"
    USERS ||--o{ POSTS : authors
    POST_TYPES ||--o{ POSTS : categorizes
    AREAS ||--o{ POSTS : "targets (optional)"
    POSTS ||--o{ COMMENTS : has
    POSTS ||--o{ REACTIONS : has
    COMMENTS ||--o{ REACTIONS : has
    COMMENTS ||--o{ COMMENTS : "replies to"
    USERS ||--o{ REPORTS : files
```

## 5.5 Community Services, Assets & Booking

```mermaid
erDiagram
    ASSET_CATEGORIES ||--o{ ASSETS : classifies
    USERS ||--o{ ASSET_OWNERS : "is an"
    ASSET_OWNERS ||--o{ ASSETS : owns
    ASSETS ||--o{ ASSET_PHOTOS : has
    ASSETS ||--o{ ASSET_FACILITIES : has
    ASSETS ||--o{ ASSET_PRICING : has
    ASSETS ||--o{ ASSET_AVAILABILITY : has
    ASSETS ||--o{ ASSET_BLOCKED_DATES : has
    ASSETS ||--o{ ASSET_SERVICES : offers
    ASSET_SERVICES ||--o{ ASSET_SERVICE_PRICING : has
    ASSETS ||--o{ ASSET_VERIFICATION : "goes through"
    USERS ||--o{ BOOKINGS : makes
    ASSETS ||--o{ BOOKINGS : "booked for"
    BOOKINGS ||--o{ BOOKING_ITEMS : "line items (services etc.)"
    BOOKINGS ||--o{ BOOKING_GUESTS : has
    BOOKINGS ||--o{ BOOKING_STATUS_HISTORY : tracked_by
    BOOKINGS ||--o{ REVIEWS : "reviewed via (post-completion)"
    ASSETS ||--o{ REVIEWS : receives
```

## 5.6 Payments, Fees & Financial Ledger

```mermaid
erDiagram
    USERS ||--o{ PAYMENT_TRANSACTIONS : initiates
    PAYMENT_TRANSACTIONS ||--o| PAYMENT_GATEWAY_TRANSACTIONS : "mirrors gateway state for"
    PAYMENT_TRANSACTIONS ||--o{ PAYMENT_WEBHOOKS : "receives events for"
    PAYMENT_TRANSACTIONS ||--o| PAYMENT_RECEIPTS : produces
    PAYMENT_TRANSACTIONS ||--o{ REFUNDS : "may have"
    BOOKINGS ||--o{ BOOKING_PAYMENTS : "paid via"
    BOOKING_PAYMENTS }o--|| PAYMENT_TRANSACTIONS : "is a"
    BOOKINGS ||--o| BOOKING_INVOICES : has
    BOOKINGS ||--o{ BOOKING_REFUNDS : "may have"

    FAMILIES ||--o{ FEE_INVOICES : billed
    COMMUNITY_FEE_TYPES ||--o{ COMMUNITY_FEE_RULES : "configured by"
    COMMUNITY_FEE_RULES ||--o{ FEE_INVOICES : generates
    FEE_INVOICES ||--o{ FEE_INVOICE_ITEMS : "line items"
    FEE_INVOICES ||--o{ DISCOUNTS : "may apply"
    FEE_INVOICES ||--o{ WAIVERS : "may apply"
    FEE_INVOICES ||--o{ LATE_FEES : "may accrue"
    FEE_INVOICES ||--o{ PAYMENT_REMINDERS : triggers
    FEE_INVOICES }o--|| PAYMENT_TRANSACTIONS : "paid via (online)"
    FEE_INVOICES ||--o{ OFFLINE_PAYMENTS : "or paid via"
    FINANCIAL_YEARS ||--o{ FEE_INVOICES : scopes

    PAYMENT_TRANSACTIONS ||--o{ FINANCIAL_LEDGER : "posts to"
    OFFLINE_PAYMENTS ||--o{ FINANCIAL_LEDGER : "posts to"
    REFUNDS ||--o{ FINANCIAL_LEDGER : "posts to"
    DONATIONS ||--o{ FINANCIAL_LEDGER : "posts to"
    PAYMENT_RECONCILIATION }o--o{ FINANCIAL_LEDGER : "checks against gateway records"
```

## 5.7 Approval, Privacy & Audit (cross-cutting)

```mermaid
erDiagram
    APPROVAL_RULES ||--o{ APPROVALS : governs
    USERS ||--o{ APPROVALS : "submits / reviews"
    USERS ||--o{ AUDIT_LOGS : "acts in"
    APPROVALS ||--o{ AUDIT_LOGS : "referenced by"
    MEMBERS ||--o{ FIELD_VISIBILITY_SETTINGS : "configures per field"
    USERS ||--o{ CONSENT_RECORDS : grants
    USERS ||--o{ NOTIFICATIONS : receives
```
