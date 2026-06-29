# Just-in-Time Access

Most access outlives its need. You add an engineer to the group that can reach the production database for one incident, and a year later they are still in it. Every standing membership like that is privilege that sits unused almost all of the time, and unused privilege is pure attack surface: it is what an attacker inherits when an account is phished, and what an auditor flags when nobody can say why it is still there. The obvious manual fix, having an admin grant access on request and remove it afterward, breaks down in practice, because removal is the step everyone forgets.

Just-in-Time Access (JIT) removes the standing membership. Instead of belonging to a sensitive group forever, a user asks for access when they need it, an approver signs off, and the access turns itself off after a set time. The default state is no access.

## The idea in one picture

Think of a **JIT policy** as the **badge desk** for a set of locked rooms. The desk holds the standing rules: which rooms a badge opens, who may ask for one, how long a badge stays valid, and who signs off. When someone needs in, they ask the desk (a **Request**), an **approver** signs off, and they receive a working badge (a **Grant**) that opens those rooms. The badge deactivates itself when its time runs out, so nobody has to remember to collect it.

That is the whole model. There are four concepts, in the order you meet them:

1. **JIT policy**: the standing rule an admin defines.
2. **Request**: a user asking for time-boxed access under a policy.
3. **Approval**: an approver's decision. In this version, every Request needs one.
4. **Grant**: the live, time-boxed access a Request becomes once approved.

Beneath all four sits one mechanism, the **backing group**, that turns a Grant into real access and makes expiry reliable. We define each concept, follow one example through the whole flow, then open the hood.

We will follow a single example throughout. **Dana is an on-call SRE.** During an incident she needs to reach the `prod-db` resource, and the rest of the time she should not be able to touch it at all.

## The four concepts

**JIT policy.** An admin-defined rule, created on the **JIT Policies** page, that describes a class of temporary access. A JIT policy names:

- the **target resources** it grants, which are NetBird [network resources](https://docs.netbird.io/manage/networks) such as the `prod-db` host,
- the **maximum duration** any Grant from it may last,
- **eligibility**: which user groups are allowed to request it,
- **approver criteria**: who is allowed to approve a Request for it.

One name collision to watch: a *JIT policy* is not a NetBird **Access Control policy**. A JIT policy is a higher-level rule. To make access actually work, it quietly creates and owns a real NetBird group and a real access control policy on your behalf, but it hides both from the Groups and Access Control pages, so you never edit them by hand. You configure everything from the JIT pages.

For Dana, an admin creates a JIT policy named "Prod DB (break-glass)": target resource `prod-db`, maximum duration 4 hours, eligible to the `sre` group, approved by the `sre-leads` group.

**Request.** When Dana is paged, she opens the **Request Access** page, picks "Prod DB (break-glass)", asks for the time she needs (say 2 hours, up to the policy's 4-hour cap), and optionally adds a justification. A Request is only the ask. It grants nothing yet.

**Approval.** A member of `sre-leads` sees Dana's Request on the **Approvals** page and approves it. Approval is always required in this version. There is no auto-approve, so every Grant has a human decision behind it.

**Grant.** On approval, Dana's Request becomes a Grant: live access to `prod-db` that expires on its own. She reaches the database within seconds, with no re-login, and at expiry she is removed just as automatically.

## How a Grant flows, start to finish

Following Dana:

1. **Request (pending).** Dana requests 2 hours on "Prod DB (break-glass)". The Request sits pending. If nobody decides on it, it auto-denies after the policy's pending window (24 hours by default), so stale asks do not linger.
2. **Approve.** An `sre-leads` member approves it. They could instead deny it, with a reason.
3. **Active.** Dana now holds access to `prod-db`.
4. **Expiry.** Two hours later, NetBird removes her access. She can also end it early herself, and an admin can revoke it at any time.

> **The mistake to avoid:** the clock starts at approval, not at request. A Grant expires at `approvalTime + requestedDuration`, not at the moment Dana asked. If her Request is approved an hour after she filed it, her 2 hours begin then. Plan for the approval step rather than assuming access starts the instant you click Request.

## How it works under the hood

This is the part worth understanding, because it is what makes JIT trustworthy.

**The backing group.** Each JIT policy owns one dedicated NetBird group, its *backing group*, which carries an access control policy to the policy's target resources. This is the badge system from the metaphor. Granting access adds the user to that group (their `auto_groups`), which programs their connection to reach those resources; revoking access removes them from it. Because membership rides over the user's existing NetBird connections, a Grant reaches their already-connected peers within seconds, with no re-login.

**One hard rule.** JIT only ever changes the membership of that single backing group, the one it created itself. It never creates, edits, or changes the membership of your identity-provider or JWT groups. Those can be named in eligibility and approver criteria, but they are only ever read, never written. Your IdP-synced groups are safe from it.

**Hidden objects.** The backing group and its access control policy are real NetBird objects, but JIT tags and hides them from the Groups and Access Control pages, and from every group and policy picker. That keeps them from cluttering those pages or being edited out from under JIT. You manage the access through the JIT policy, not the group beneath it.

**How the privileged work gets done.** The dashboard is a static site, and every action you take in it uses your own login token, which a regular user does not have the rights to add themselves to a group with. Reliable expiry also needs something running even when nobody is logged in. JIT is implemented inside the NetBird management server itself, which already holds the account store, the scheduler, and the service-level authority to apply and remove group memberships. It exposes JIT endpoints at `/api/jit/` alongside the rest of the management API — so from the browser's perspective, JIT calls look the same as any other NetBird API call. There is no separate service to deploy.

**Reliable, self-correcting revocation.** A scheduler in that service continuously expires Grants whose time is up, auto-denies stale Requests, and reconciles each backing group so its membership always equals exactly the set of users who currently hold a live Grant. If an apply or a removal ever fails, it retries until confirmed and fails closed, meaning it errs toward removing access rather than leaving it on. Any drift is corrected on the next pass.

**Propagation has a prerequisite.** A Grant only reaches already-connected peers if your account setting `groups_propagation_enabled` is on, which it is by default. If it is off, the dashboard warns you, because access that cannot reach a peer is not real access.

## Extending access

Sometimes 2 hours is not enough. Rather than starting over, Dana can request an **extension** of her active Grant, and an approver approves it like any other Request. Approval renews her window to `approvalTime + requestedDuration`, capped at the policy's maximum. Her access does not drop during the handover: the renewal takes over and the previous Grant retires quietly behind it. Extensions are approved each time, exactly like the first Grant, so the audit trail stays complete. Admins and approvers can also extend an active Grant directly.

## Set it up for least privilege

The first policy you copy becomes the pattern you keep, so start narrow:

- **Target specific resources.** Grant the one host or service the task needs, like `prod-db`, not a broad subnet. Prefer narrow [network resources](https://docs.netbird.io/manage/networks).
- **Keep durations short.** Set the maximum to the smallest window that fits the real task. Users can always extend with another approval.
- **Scope eligibility.** Limit who can request to the groups with a legitimate reason, rather than leaving it open to everyone.
- **Restrict approvers for sensitive access.** For high-value resources, require approval from a dedicated group such as `sre-leads` rather than any admin.

The secure version is not more work. It is the same fields with narrower values.

## When not to use Just-in-Time Access

JIT is for access that is occasional, sensitive, and acceptable to interrupt. It is the wrong tool when:

- **The access is someone's daily job.** If a user needs a resource continuously to do their work, time-boxing it only adds friction and approval noise. Give them standing access through ordinary [Access Control policies](https://docs.netbird.io/manage/networks) and group membership instead.
- **No human is in the loop.** JIT requires an approval per Request. For unattended automation, or a service that must connect on its own, use a service user and a setup key, not JIT.

## Limits to know

This version of Just-in-Time Access:

- **always requires approval.** There is no auto-approve.
- **notifies in the dashboard only.** Approvers see pending Requests in the Approvals queue. There is no email or webhook yet.
- **covers a single NetBird account**, and depends on the management server running. If the server is down, no new Grants are issued and scheduled expiries wait until it returns. Existing access is never silently widened.
- **needs `groups_propagation_enabled`** for Grants to reach already-connected peers.

## In one breath

A JIT policy is a badge desk for a set of resources: it says who may ask, for how long, and who signs off. Dana asks for 2 hours on `prod-db`; an `sre-leads` member approves; NetBird adds her to a hidden backing group that carries access to `prod-db`, then removes her automatically when her time runs out. No standing membership, every Grant approved, the clock starting at approval, and nothing left behind for an auditor to question.
