# Just-in-Time Access

The bounded context this fork adds on top of the NetBird dashboard: temporary, approved, self-service access to network resources. (Broader dashboard terms — Peer, Group, Policy, Network Resource, Setup Key — are NetBird's own and are not redefined here.)

## Language

**Just-in-Time Access**:
The feature as a whole, and its dashboard nav section.
_Avoid_: JIT (except as the qualifier in "JIT policy"), temporary access.

**JIT policy**:
The admin-defined object granting a class of temporary access — a backing group, target resources, max duration, eligibility, and approver criteria. Always written with the "JIT" qualifier.
_Avoid_: bare "policy" (collides with NetBird's access-control Policy), entitlement, rule, template.

**Request**:
A user's ask for time-boxed access to one JIT policy (carries the requested duration and optional justification). Lives through approval into a Grant.
_Avoid_: application, ticket.

**Grant**:
The active, time-boxed access produced by an approved Request — the backing-group membership plus its `expires_at`.
_Avoid_: lease, session, assignment.

**Extension (Renewal)**:
A Request that supersedes the requester's active Grant for the same JIT policy. On approval it renews the access window (`approvalTime + requestedDuration`, capped at the policy max) by activating a new Grant that retires the prior one (`superseded`), with no membership change. Renewable repeatedly.

**superseded**:
Terminal Grant status for a Grant that has been replaced by an approved renewal.

**Grant lifecycle**:
The legal status changes a Grant (one `jit_grants` row) may undergo — `pending → approved → active → expired/revoked/superseded`, plus `denied`/`cancelled`/`failed`. Every status change is one **transition**: legal only if its `from → to` edge is allowed, atomic (compare-and-set, so two concurrent callers can't both win), and audited with an action derived from the edge. The grant-lifecycle module in the management server fork is the only path that mutates a Grant's status; the grant service supplies preconditions and membership side-effects around it.
_Avoid_: state machine (in UI prose), status flip.

**Backing group**:
The dedicated, JIT-owned, JIT-exclusive, API-issued NetBird group that a JIT policy provisions; its members are exactly the holders of active Grants. Hidden from non-JIT dashboard pages.
_Avoid_: access group, JIT group (in code/UI prose), shared group.

**Eligibility**:
Which user groups may request a given JIT policy (any group type, evaluated read-only against the requester's `auto_groups`).
_Avoid_: scope, audience, permission.

**Approver**:
Who may approve/deny a Request — any admin/owner, or members of an optional approver group.
_Avoid_: reviewer, authorizer.
