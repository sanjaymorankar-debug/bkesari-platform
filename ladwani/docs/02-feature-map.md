# Phase 1.2 — Complete Feature Map

Checklist form, organized by module. `[Auto]` = system-driven, no user action. `[Cfg]` = admin-configurable.

## 1. Authentication & User Management
- [ ] Register (mobile or email + password), mobile/email OTP verification
- [ ] Login (identifier + password), JWT access + refresh token, session revocation
- [ ] Password reset via OTP
- [ ] Account deactivation (self-service) and deletion request (routed to admin)
- [ ] Role assignment (Admin only), multiple roles per user supported
- [ ] Permission checks centralized in one guard/decorator, not duplicated per route

## 2. Family Registry
- [ ] Register new family (goes to Operator/Admin verification queue)
- [ ] Request to join an existing family (routed to Karta for approval)
- [ ] Karta: edit family info (name, native place, Kuladevata/Gotra, address, photo)
- [ ] Karta: add member (new person) or link existing platform member (with that member's approval)
- [ ] Karta: remove member (soft-remove with reason), change member status
- [ ] Karta transfer (Admin-approved action, not self-service)
- [ ] Duplicate-family detection at registration `[Auto]`

## 3. Family Tree
- [ ] Auto-generated tree from `member_relationships`, not manually drawn
- [ ] Zoom / pan / expand-collapse / search-within-tree
- [ ] Visual states: living/deceased, married/unmarried
- [ ] Open member profile from a tree node
- [ ] Print / download (PDF or image export)
- [ ] Privacy-filtered: a viewer only sees nodes/fields they're allowed to see

## 4. Member Directory
- [ ] Structured profile: identity, contact, residence (current + native), marital status, education, skills, employment/business, income range, bio
- [ ] Profile photo + additional photos
- [ ] Multi-field search (name, family, member ID, area, city, state, native place, education, occupation, skills, marital status, age range, gender, matrimony availability)
- [ ] Paginated, indexed search — never a full table scan client-side

## 5. Community Social Network
- [ ] Post categories: general, announcement, event, matrimonial, achievement, birthday, marriage, condolence, job, business, service, lost & found, other `[Cfg]`
- [ ] Create post (text + photos), comment, react, report
- [ ] Feed ranking: My Area → City → Community → announcements → events → relevant members → matrimony
- [ ] Feed filters: My Area / City / Community
- [ ] Operator/Admin moderation queue for reported content

## 6. Area/Group Management
- [ ] Hierarchical areas: Country → State → District → City → Area → Local Group
- [ ] Member/family can belong to more than one area
- [ ] Admin CRUD on area tree `[Cfg]`

## 7. Matrimony
- [ ] Opt-in only — profile never auto-created from the base member profile
- [ ] Profile fields: photo, age (derived), education, occupation, skills, city, native place, family background, about, partner preferences
- [ ] Actions: Send Interest, Request Contact, Contact Family, Save Profile, Report
- [ ] Contact details never shown by default; reveal only per configured policy (accept-first or family-approval)
- [ ] Search filters: age, gender, location, native place, education, profession, income range, marital status, skills, subgroup

## 8–9. Community Services & Asset Directory
- [ ] Asset categories: accommodation (hotel/hostel/guest house/dormitory), events (marriage hall/banquet/function hall/community hall/conference room), extensible for future categories `[Cfg]`
- [ ] Asset Owner registers asset: description, address, map location, photos/videos, facilities, capacity, pricing, policies
- [ ] Verification workflow: Pending → Under Verification → Approved/Rejected/Suspended/Temporarily Unavailable/Closed
- [ ] "Verified Community Asset" badge on approved assets
- [ ] Search by category, city, area, distance, date, capacity, price, facilities, rating, verified status

## 10. Online Booking
- [ ] Booking flow: select asset → date/time → duration/rooms/people → additional services → price calc → confirm → pay or request → confirmation
- [ ] Instant booking (available slot → pay → auto-confirm) vs. request booking (owner approval → pay → confirm)
- [ ] Availability calendar: available/reserved/pending/blocked/maintenance/holiday
- [ ] Owner can block dates
- [ ] Double-booking prevented at the DB layer (not just UI validation)
- [ ] Additional services selectable at booking time (catering, decoration, DJ, photography, etc.) `[Cfg]`
- [ ] QR booking confirmation code, scannable by asset staff for on-site verification (minimal info exposed)
- [ ] Cancellation with configurable deadline/refund-percentage/charges `[Cfg]`
- [ ] Reviews after completed, verified bookings only

## 11. Online Payment
- [ ] Gateway abstraction (Razorpay/Cashfree/PayU pluggable, not hardcoded)
- [ ] UPI, cards, net banking, wallets — whatever the active gateway supports
- [ ] Server-side payment verification; webhook signature verification; idempotent webhook handling
- [ ] Full / advance / partial / milestone payment support
- [ ] Payment statuses: created, pending, initiated, processing, successful, failed, cancelled, refunded, partially refunded, under verification

## 12. Community Family Fee Collection
- [ ] Fee types: registration, annual, monthly/quarterly/half-yearly, lifetime, event, special, other `[Cfg]`
- [ ] Fee rules: amount, frequency, effective date, applicable families/areas/member category, discounts, late fee, grace period, due date, financial year `[Cfg]`
- [ ] Karta: view outstanding, pay now, view history, download receipts
- [ ] Automated reminders at 30/7/0/overdue days, in-app + email now, SMS/WhatsApp later
- [ ] Offline payments (cash/bank transfer/cheque) — pending verification, an Operator/Admin (never the payer) confirms

## 13. Donations/Contributions
- [ ] Separately categorized from mandatory fees, both in UI and in the ledger
- [ ] Configurable causes (community development, education, medical, events, charity, emergency) `[Cfg]`

## 14. Invoices & Receipts
- [ ] Auto-generated receipt on successful payment (community name/logo, receipt #, family, fee type, financial year, amount, method, transaction ref)
- [ ] Download / print / email
- [ ] Invoice generation where applicable (e.g. asset bookings with tax lines)

## 15. Financial Ledger
- [ ] Single ledger table every financial event writes to, regardless of source (fee, booking, donation, refund)
- [ ] Never edited in place — corrections are new reversal/adjustment entries

## 16. Refunds & Reconciliation
- [ ] Refunds tracked end-to-end and, where applicable, processed via the gateway
- [ ] Admin reconciliation view: gateway records vs. internal records, flags missing/duplicate/mismatched amounts

## 17. Notifications
- [ ] In-app (Phase 1), email (Phase 1), SMS/WhatsApp (designed for, wired later)
- [ ] Event-driven: approval outcomes, matrimonial interest, announcements, fee reminders, payment/booking/refund events

## 18. Approval Workflow
- [ ] One generic engine: Draft → Submitted → Under Review → Approved / Rejected / Returned
- [ ] Configurable per action type (`approval_rules`): which role approves, whether approval is required at all

## 19. Privacy & Consent
- [ ] Per-field visibility: Public / Registered Community / Same Area / Same Family / Matrimony Only / Admin-Operator / Private
- [ ] Consent records for profile, family info, photos, matrimony visibility, directory listing, notifications
- [ ] Self-service data access, correction, deactivation, deletion request

## 20. Audit Log
- [ ] Every sensitive mutation logged: actor, role, action, entity, field, before/after, timestamp, related approval

## 21. Reporting
- [ ] Family/member demographics, matrimony pipeline, service/asset utilization, financial (billed/collected/outstanding/overdue/donations, by area/month/year)
- [ ] Authorized CSV/Excel export

## 22. Administration
- [ ] Config surfaces for: roles/permissions, relationship types, member statuses, education levels, occupations, skills, areas, post types, privacy defaults, matrimony fields, asset categories/facilities, booking rules, payment gateway selection, fee types/rules, financial years, discounts/waivers/late fees, notification rules
