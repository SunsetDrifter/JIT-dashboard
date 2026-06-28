# JIT owns and provisions its backing group + policy, hidden from other pages

Each JIT policy provisions and owns a dedicated, marker-tagged, JIT-exclusive NetBird group **and** the NetBird access policy that grants it the selected resources — rather than reusing an admin-made group. This is required to keep these objects from flooding the normal Groups/Access-Control pages and pickers: they are tagged by a name marker and stripped from every `/groups` and `/policies` response by a single SWR middleware wrapped around `DashboardLayout`. JIT-exclusivity also makes the backing group's membership a clean source of truth ({active Grants}), enabling safe reconciliation.

## Consequences

- Admins configure JIT entirely inside the JIT page (pick resources, not a pre-made group); JIT manages the group+policy lifecycle (create on JIT-policy create, revoke-then-delete on delete).
- Hiding is name-marker based (NetBird groups have no metadata field) and client-side only — it declutters the UI, it is not a security boundary. JIT must own/control the names.
- One central (but additive) upstream edit to `DashboardLayout.tsx` is accepted beyond the nav line.
