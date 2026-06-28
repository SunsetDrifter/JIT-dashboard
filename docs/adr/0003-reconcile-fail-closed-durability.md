# Reconcile + fail-closed durability for grants

Because backing groups are JIT-exclusive, their membership should always equal {users with an active Grant}. A periodic reconcile enforces this (removing orphaned members, re-adding missing ones), and expiry **fails closed** — on uncertainty access is removed, not left open. A lost or empty SQLite DB therefore tends toward revoking everything, which is the safe direction for a security feature, with a **startup guard** that refuses mass-removal when the DB is empty/unmigrated but backing groups still have members (so an unmounted volume can't silently nuke all access).

## Consequences

- SQLite is the source of truth and must live on a persistent, backed-up volume.
- Transient NetBird failures during expiry keep retrying until removal is confirmed; revocation never silently fails open.
- This replaces an earlier per-grant "don't strip pre-existing membership" scheme, which is unnecessary once the group is JIT-exclusive.
