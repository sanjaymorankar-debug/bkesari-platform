# Phase 1.9 — Privacy Architecture

## 1. Visibility Levels

Every profile field resolves to exactly one of:

1. **PUBLIC** — visible to anyone, including logged-out visitors (rare; e.g. a family's name in a public directory listing, if the community opts into having one).
2. **REGISTERED_COMMUNITY** — any logged-in member of the community.
3. **SAME_AREA** — logged-in members who share at least one area with the profile owner.
4. **SAME_FAMILY** — members of the same family record.
5. **MATRIMONY_ONLY** — visible only within the matrimony module's own access rules (search result vs. detail view vs. post-interest-acceptance may each reveal progressively more).
6. **ADMIN_OPERATOR** — Admin, or the Operator assigned to the owner's area.
7. **PRIVATE** — the owner (and, for a minor or a member without their own login, their Karta) only.

## 2. Defaults (community-configurable, per `field_visibility_defaults`)

| Field | Default |
|---|---|
| Mobile / alternate mobile | PRIVATE |
| Email | PRIVATE |
| Exact current address | PRIVATE |
| City/state (current, native) | REGISTERED_COMMUNITY |
| Income range | PRIVATE (member may opt up to MATRIMONY_ONLY) |
| Education | REGISTERED_COMMUNITY |
| Occupation/employer | REGISTERED_COMMUNITY |
| Photos | REGISTERED_COMMUNITY |
| Date of birth (exact) | SAME_FAMILY |
| Age (derived) | REGISTERED_COMMUNITY |
| Marital status | REGISTERED_COMMUNITY |
| Family tree presence | SAME_FAMILY, with each field on a tree node independently resolved by this same table — a tree is not a visibility bypass |
| Matrimonial profile fields | MATRIMONY_ONLY by default once the profile is created |

A member can raise or lower any user-configurable field's visibility from their privacy center (Screen 27); some fields (e.g. mobile) may be marked `is_user_configurable = false` if the community decides they must never be exposed above PRIVATE.

## 3. Resolution Algorithm

Given `(viewer, field, owner_member)`:

```
1. Look up the owner's override in field_visibility_settings for this field.
   If none, fall back to field_visibility_defaults for this field.
2. If level == PUBLIC → visible.
3. If viewer is not authenticated → not visible (nothing above PUBLIC shows to anonymous users).
4. If level == REGISTERED_COMMUNITY → visible (viewer is authenticated).
5. If level == SAME_AREA → visible iff viewer.areas ∩ owner.areas ≠ ∅.
6. If level == SAME_FAMILY → visible iff viewer.family_id == owner.family_id (any active family_members row in common).
7. If level == MATRIMONY_ONLY → delegate to the matrimony module's own rule for the current view context.
8. If level == ADMIN_OPERATOR → visible iff viewer has ADMIN, or OPERATOR scoped to owner's area.
9. If level == PRIVATE → visible iff viewer.id == owner.user_id, or viewer is owner's Karta AND owner has no independent login (never overrides an adult member's own PRIVATE setting just because they're in the same family).
10. Otherwise → not visible; field omitted from the response entirely (not returned as null — a client should not be able to distinguish "hidden" from "empty" by field presence alone in contexts where that distinction itself would leak information, e.g. profile completeness scoring only runs server-side against the true data).
```

This runs **server-side, in the response serializer**, per §7 of the API architecture — never as a client-side filter over a fully-populated payload.

## 4. Consent Model

`consent_records` captures an explicit, versioned yes/no per consent type at the time it was given:

- `PROFILE_STORAGE` — required to register at all.
- `FAMILY_INFO` — required to be linked into a family record.
- `PHOTO_UPLOAD` — per photo upload action.
- `MATRIMONIAL_VISIBILITY` — required before a matrimonial profile can be set `is_visible = true`.
- `COMMUNITY_DIRECTORY` — whether the member appears in general member search at all (separate from field-level visibility — this is the master on/off switch).
- `NOTIFICATIONS` — channel-level opt-in (in-app is implicit; email/SMS require this).

Consent is never implied by "you joined the community." Each of the above is a distinct, revocable grant, and revoking one doesn't silently revoke the others.

## 5. Data Subject Rights (Privacy Center, Screen 27)

- **Access**: download my own record (profile + family relationships + matrimonial data + consent history) as a structured export.
- **Correction**: request a correction to any field (routed through the same approval engine as any other sensitive change).
- **Deactivation**: self-service — status → `DEACTIVATED`, profile hidden from all non-Admin visibility levels immediately, login disabled, data retained.
- **Deletion request**: not self-executing (family-tree integrity means a member can't just vanish from other people's history) — routed to Admin, who can anonymize the member's personal fields while preserving the relationship graph's structural integrity (a placeholder node remains so the tree doesn't develop a hole, but it carries no identifying data).

## 6. What This Explicitly Rules Out

- No field is ever visible purely because "everyone in the app can see everyone" — REGISTERED_COMMUNITY is a deliberate level a field must be assigned to, not the unstated default architecture.
- Karta authority never overrides an adult member's own PRIVATE setting on their own fields (see §80 hard rule).
- Matrimony visibility is never inferred from directory visibility or vice versa — they're independently controlled.
