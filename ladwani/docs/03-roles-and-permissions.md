# Phase 1.3 — Role & Permission Matrix

## 1. Model

RBAC with a granular permission layer underneath — roles are just named bundles of permissions, and Admin can edit those bundles (section 85) without a code change. A user can hold more than one role (e.g. Karta + Asset Owner).

```
users ──< user_roles >── roles ──< role_permissions >── permissions
```

- `roles`: MEMBER, KARTA, OPERATOR, ASSET_OWNER, ADMIN (seeded, `is_system = true` so they can't be deleted, but their permission bundle *can* be edited).
- `permissions`: `resource:action` strings, e.g. `family:create`, `family:edit:own`, `member:edit:any`, `asset:approve`, `fee:configure`.
- Scope qualifiers (`:own`, `:family`, `:any`) are part of the permission string itself, checked against the resource's actual owner/family at request time — not just "does this role have this permission" but "does this role have this permission *for this specific record*."

## 2. Permission Catalog (representative, not exhaustive — Phase 4 finalizes the full list)

| Permission | Meaning |
|---|---|
| `profile:edit:own` | Edit your own member profile |
| `profile:edit:any` | Edit any member's profile (Admin escape hatch) |
| `family:create` | Register a new family |
| `family:edit:own` | Karta edits their own family's record |
| `family:member:add` | Add a member to a family (new or link-existing) |
| `family:member:remove` | Remove a member from a family |
| `family:karta:transfer` | Change who the Karta is (Admin-approved) |
| `matrimony:manage:own` | Create/edit own matrimonial profile |
| `matrimony:manage:family` | Karta manages a family member's matrimonial profile, where that member has delegated it |
| `post:create` | Create a community post `[Cfg per role]` |
| `moderation:review` | Review reported content |
| `asset:register` | Submit a new asset for approval |
| `asset:approve` | Approve/reject a submitted asset |
| `asset:manage:own` | Manage an asset you own |
| `booking:create` | Book an asset |
| `booking:manage:own` | Owner manages bookings on their asset |
| `fee:configure` | Create/edit fee types and rules |
| `fee:pay:family` | Karta pays on behalf of their family |
| `payment:verify:offline` | Confirm an offline payment (never the payer themself) |
| `refund:approve` | Approve a refund |
| `role:manage` | Assign/revoke roles |
| `audit:view` | View audit logs (scope varies: own area for Operator, everything for Admin) |

## 3. Permission Matrix (from the brief, formalized)

`Yes*` = granted by default but the specific scope/limit is Admin-configurable. `Req` = the actor can request the action but a higher role must approve.

| Function | Member | Karta | Operator | Asset Owner | Admin |
|---|---|---|---|---|---|
| View own profile | Yes | Yes | Yes | Yes | Yes |
| Edit own profile | Yes | Yes | Yes | Yes | Yes |
| Add family member | No | Yes | Yes* | No | Yes |
| Edit family | No | Yes | Yes* | No | Yes |
| Remove family member | No | Yes | Yes* | No | Yes |
| Transfer Karta | Req | Req | No | No | Yes |
| Search members | Yes | Yes | Yes | Yes | Yes |
| Matrimony (own profile) | Yes | Yes | Yes | Yes | Yes |
| Manage family member's matrimony | No | Yes* | No | No | Yes |
| Create posts | Yes* | Yes | Yes | Yes* | Yes |
| Moderate posts | No | No | Yes | No | Yes |
| Register asset | Req | Req | Yes | Yes | Yes |
| Approve asset | No | No | Yes* | No | Yes |
| Manage asset | No | No | Limited | Yes (own) | Yes |
| Book asset | Yes | Yes | Yes | Yes | Yes |
| Pay family fee | No | Yes | Authorized | Authorized | Yes |
| View family payments | No | Yes | Limited | No | Yes |
| Configure fees | No | No | No | No | Yes |
| Verify offline payment | No | No | Authorized | No | Yes |
| Refund | Req | Req | No | Req | Yes |
| Manage roles | No | No | No | No | Yes |
| View audit logs | No | Limited (own family) | Limited (own area) | Limited (own assets) | Yes |

## 4. Hard Rules (never bypassed by role)

- A member can never edit another member's profile directly — only propose a change that the target approves, or that goes through the approval engine if the target can't/won't respond (e.g. marking someone deceased).
- Karta authority stops at "manage family structure" — it does not extend to overriding an adult member's own sensitive personal data (contact info, matrimony visibility, income) without that member's consent.
- Asset Owner scope is strictly their own assets; there is no implicit escalation to Operator/Admin capability.
- Only Admin can configure fees, gateways, or roles/permissions themselves.
