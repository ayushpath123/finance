# ARTI FINANCE — Architecture & Financial Design

Status: **Business rules final (§2).** Schema, invariants, finance core, services, auth core and cron are implemented and tested.

---

## 1. Guiding principles

1. **The database is the source of truth.** Every rupee is a row: `Disbursement` (out), `Payment` (in),
   `PaymentAllocation` (which day that rupee paid for), `LedgerEntry` (journal), `AuditLog` (who/why).
2. **Facts are append-only; projections are rebuildable.** Payments, disbursements, allocations,
   ledger and audit rows are never edited or deleted (Postgres triggers enforce it). Schedule
   `allocatedAmount`/`status` are *projections* of the allocation rows, rewritten in the same DB
   transaction, and a deferred constraint verifies at COMMIT that projection = Σ allocations.
3. **Integer paise, calendar dates.** No floats anywhere in money paths. Business dates are
   `YYYY-MM-DD` values in Postgres `DATE` columns; the business timezone (Asia/Kolkata) is applied only
   when deciding "what is today / has today closed".
4. **Pure core, thin I/O shell.** All financial logic lives in `lib/finance/*` as pure functions with no
   Prisma/React imports. Server actions load facts under a row lock, call the core, persist its plan.
5. **One contract = one financial universe.** Nothing is ever netted across contracts. Person-level
   numbers are sums of per-contract numbers.

---

## 2. Final business rules (confirmed 27 Sep 2026)

| Rule | Implementation |
|---|---|
| Fixed contract, **no pause/resume/extension/shifting** | No PAUSED status exists. Terms + schedule immutable (triggers). CHECK `end = first + days − 1`. |
| **Every calendar day** is a collection day | No frequency/holiday concept at all. 100 days from 27 Sep 2026 → last day **4 Jan 2027** (tested). |
| Missed after the **Asia/Kolkata** cutoff | `closedThrough(now, {tz, cutoff})`; default cutoff 23:59 IST. Browser timezone never consulted. |
| Late payment settles **oldest first** | OLDEST_FIRST engine. Late-settled day → `SETTLED_LATE`; `missedAt`, memo ledger + audit stay forever. |
| Partial / multiple same-day / overpayment | Each payment is its own row; day aggregates via allocations. Excess → future days → unallocated credit. |
| UI distinguishes overdue / today / prepaid / credit | `summarizeContract` → `overdue`, `todayExpected/todayAllocated`, `prepaid`, `credit` — all derived, none stored. |
| **No principal/profit split** | Obligation = daily × days. Principal given, contracted collection, contractual margin reported separately; allocation never uses principal. |
| Cancellation | Future days not fully paid → `CANCELLED` (sticky `cancelledAt`). Past/today stay owed. Fully prepaid future days stay PAID. Money on a partly-prepaid cancelled day is released to credit. Reported as **"Cancelled Obligation"**, never "written off". |
| Completion | Automatic only when **every** non-cancelled obligation is fully covered. A later reversal reopens it (`CONTRACT_REOPENED`). |
| Corrections | Reverse original (kept, `REVERSED`) + replacement with `correctsPaymentId`, one transaction; works across contracts. |
| Wrong contract terms | Cancel contract → reverse disbursement (only allowed once cancelled) → create a new contract. |

Other decisions still in force: contract numbers `AF-0001` (global sequence); person URLs `/people/dharmjit-pandey`
(`-2` on collision); payment date must be `startDate ≤ date ≤ today (IST)`; single-row amounts ≤ ₹2,14,74,836.

## 3. System architecture

```
Browser ──(RSC render / Server Actions, same-origin, CSRF-checked by Next)──▶ Next.js 16 (App Router, Node runtime)
                                                                               │
    app/(dashboard)/…   Server Components: read models (aggregate SQL)          │
    app/actions/…       Server Actions: zod-validate → authorize → service      │
    app/api/cron/…      Vercel Cron → reconcileDailyCollections() (CRON_SECRET) │
                                                                               ▼
    lib/services/…      Transaction scripts (Prisma $transaction, row locks)  ──▶ Neon Postgres
    lib/finance/…       PURE: money, dates, terms, allocation, status, summary   (constraints + triggers)
    lib/audit/…         audit writer (inside the same transaction)
```

- **Runtime:** Node.js runtime for everything touching the DB. Prisma 7 with `@prisma/adapter-pg` (node-postgres over TCP — works
  with Neon's pooled endpoint and any Postgres, so the same integration suite runs locally and on Neon).
- **Reads:** Server Components call read-model functions that use aggregate queries
  (`groupBy`/raw SQL `SUM … GROUP BY contractId`) — never "load every payment".
- **Writes:** only Server Actions / route handlers. Each mutation = one interactive transaction.
- **Background:** Vercel Cron at **19:00 UTC = 00:30 IST** (Hobby plans may fire anywhere in that hour, i.e. 00:30–01:29 IST — always after the 23:59 cutoff) calls `/api/cron/reconcile`. The dashboard
  also triggers a (cheap, idempotent) reconciliation on load so stale statuses self-heal.

### Folder layout

```
app/
  (auth)/login/
  (dashboard)/dashboard | people | contracts | collections/{today,missed} | transactions
              reports | admin/audit-log | settings
  api/cron/reconcile/route.ts
components/{dashboard,people,contracts,collections,transactions,audit,ui}/
lib/
  finance/        ← pure, unit-tested  (done)
  services/       ← payments.ts, contracts.ts, reconciliation.ts, people.ts (DB transaction scripts)
  db/             ← prisma client singleton
  auth/           ← session, password, guards, rate limit
  audit/          ← writeAudit(tx, …)
  validation/     ← zod schemas shared by forms + actions
  generated/prisma← Prisma client output (gitignored)
prisma/ schema.prisma · sql/invariants.sql · migrations/ · seed.ts
tests/ finance/ (pure) · services/ (against a real Postgres)
```

---

## 4. Data model

See `prisma/schema.prisma` (fully commented). Summary:

| Model | Role | Mutability |
|---|---|---|
| `User`, `Session`, `LoginAttempt` | identity, sessions, login throttling | normal |
| `Person` | customer | editable (audited), soft-delete only |
| `Contract` | terms + lifecycle | **terms immutable** (trigger); status/notes editable (audited); COMPLETED/CANCELLED terminal |
| `Disbursement` | principal handed over | append-only; one-way ACTIVE→REVERSED |
| `CollectionSchedule` | one row per expected day | expectation immutable; `allocatedAmount/status` = projection; `missedAt` sticky |
| `Payment` | money received | append-only; one-way ACTIVE→REVERSED; correction links via `correctsPaymentId` |
| `AllocationRun` | one execution of the engine; explains *why* allocations changed | append-only |
| `PaymentAllocation` | "₹X of payment P pays day S" | append-only; may be **voided once** |
| `LedgerEntry` | signed cash journal (+ zero-amount MISSED memo) | append-only; unique keys → idempotent |
| `AuditLog` | who did what, before/after JSON | append-only (UPDATE/DELETE/TRUNCATE rejected) |
| `ReconciliationRun` | ops record of each job run | normal |
| `BusinessSettings` | single row (id=1) | audited |

**Integrity by construction**

- Composite FKs `(contractId, personId) → contracts(id, personId)` make it impossible for a payment,
  disbursement or ledger row to name a person who doesn't own the contract.
- Composite FKs `(paymentId, contractId)` and `(scheduleId, contractId)` on allocations make
  cross-contract allocation impossible (§42 "never combine contracts").
- CHECKs: positive amounts, `expected = daily × days`, `first ≥ start`, `end = first + days − 1`,
  `0 ≤ allocated ≤ expected`, ledger sign matches type, settings cutoff format.
- Deferred constraint triggers (checked at COMMIT): Σ active allocations per schedule = projection;
  per payment ≤ amount; a reversed payment has no active allocations.

All of the above was verified against a real Postgres 18 (each rejection path fires, valid paths pass).

**Derived, not stored:** advance balance, outstanding, overdue, person totals. `AdvanceBalance` and
`Notification` models from the brief are intentionally omitted — advance is computable exactly from
allocations; storing it would create a second source of truth. Notifications come with that feature.

---

## 5. Payment allocation algorithm

### 5.1 Policy `OLDEST_FIRST` (`lib/finance/allocation.ts`)

```
due      = contract schedules (not cancelled), sorted by (scheduledDate, sequence)
payments = ACTIVE payments, sorted by (paymentDate, recordedAt, id)
for each payment:
    while payment has money left and a due day has room:
        take = min(room on oldest not-full day, money left)
        emit allocation(payment → day, take)
leftover per payment = contract credit
```

This yields exactly the brief's order: oldest outstanding → current → future → credit.
Coverage is a function of the *total* paid, so the result is identical regardless of the order in
which payments were typed in (tested).

### 5.2 Rebuild-and-diff instead of mutate

Every mutation computes the **complete target allocation set** for the contract and diffs it
against the active rows (`diffAllocations`), matching on `(payment, schedule, amount)`:

- New payment that is the latest (≈99% of cases): diff = *insert its rows only*. Nothing is voided.
- Reversal / correction / back-dated payment: only rows that actually change are voided and
  re-created, all under one `AllocationRun` that records the trigger and a human summary.
- Re-planning an already-applied state produces an empty diff → reconciliation is idempotent.

So there is one code path, no incremental-bookkeeping bugs, and full history (voided rows remain).

### 5.3 Missed-at-close is time-independent

`coverageAtClose(day D)` = how much of D was covered by payments **dated ≤ D**. Because
coverage is prefix-shaped, it's `clamp(Σpaid(≤D) − Σexpected(before D), 0, expected(D))`.
It decides:

- `PAID` — fully covered and was covered by close of day (includes prepaid future days)
- `SETTLED_LATE` — fully covered now, but not by close of day (missed/short, later settled)
- `MISSED` / `PARTIAL` — closed day with nothing / something

Whether cron runs at 00:05 or three days late, the same days are flagged.

### 5.4 Worked example (tested)

```
27 Sep  pay ₹750   → S27 ₹750                           S27 PAID
28 Sep  nothing    → reconcile at 00:05 29 Sep           S28 MISSED  (missedAt set, memo ledger, audit)
29 Sep  pay ₹1,500 → S28 ₹750 (arrears), S29 ₹750 (today) S28 SETTLED_LATE, S29 PAID
```
Confirmation shown to the user: *"₹1,500 received — ₹750 → 28 Sep (overdue), ₹750 → 29 Sep (today)."*

### 5.5 Record-payment transaction (service layer, next phase)

```
BEGIN
  if Payment with idempotencyKey exists → return it (duplicate submit / refresh / retry)
  SELECT … FROM contracts WHERE id = $1 FOR UPDATE      -- serialise per contract
  assert contract not COMPLETED, startDate ≤ date ≤ today, amount > 0   (zod + server re-check)
  INSERT payment
  load schedules + active payments + active allocations
  plan = planContractState(facts, clock)
  INSERT allocation_run; void plan.toVoid; insert plan.toCreate
  UPDATE changed schedules (allocatedAmount, status, settledAt)
  INSERT ledger_entry COLLECTION (+amount)                -- unique(entryType, paymentId)
  INSERT audit PAYMENT_CREATED + PAYMENT_ALLOCATED (before/after, explanation)
  if plan.fullyCollected → contract COMPLETED + audit CONTRACT_COMPLETED
COMMIT                                                     -- deferred invariant checks fire here
```
Any failure rolls back everything; the deferred checks make a "payment without allocation
projection" state impossible even with a buggy caller.

**Correction** = in one transaction: mark original REVERSED (+ `COLLECTION_REVERSAL` ledger,
`PAYMENT_REVERSED` audit), insert replacement with `correctsPaymentId`, re-plan, `PAYMENT_CORRECTED`
audit. **Wrong contract** = the same correction flow, targeting the other contract (both contracts
re-planned in one transaction, locked in id order to avoid deadlocks).

---

## 6. Daily reconciliation — `reconcileDailyCollections()`

```
closed = closedThrough(now, {timeZone, cutoff})   -- e.g. 00:05 IST 29 Sep → 2026-09-28
INSERT reconciliation_run(RUNNING)
for each ACTIVE/DEFAULTED/CANCELLED contract having a schedule dated ≤ today still PENDING/PARTIAL
    (partial index collection_schedules_open_idx makes this cheap)
    BEGIN; lock contract FOR UPDATE
      plan = planContractState(facts, {today, closedThrough: closed})
      apply schedule updates
      for each update.markMissed (only rows with missedAt IS NULL):
          set missedAt, shortfallAtClose
          INSERT ledger SCHEDULE_MISSED ₹0        ON CONFLICT (entryType, scheduleId) DO NOTHING
          INSERT audit SCHEDULE_MARKED_MISSED     ON CONFLICT (dedupeKey) DO NOTHING
      complete contract if fully collected
    COMMIT
finish run (counts)
```

Idempotent three ways: `missedAt IS NULL` guard, unique ledger key, unique audit `dedupeKey`
(`SCHEDULE_MARKED_MISSED:<scheduleId>`). Concurrent runs (cron + dashboard) serialise on the
contract row lock; the second sees nothing to do (tested with 3 parallel runs). Prepaid future
days are never candidates, so they are untouched. Cancelled contracts are still reconciled
because their past/today obligations remain owed.

---

## 7. Financial invariants (enforced where)

| Invariant | App (zod/core) | DB |
|---|---|---|
| Payment / disbursement / allocation amount > 0 | ✓ | CHECK |
| Contract dates valid; end = first + days − 1; expected = daily × days | ✓ `buildContractTerms` | CHECK |
| Schedule expected ≥ 0; 0 ≤ allocated ≤ expected | ✓ | CHECK |
| Σ allocations(schedule) = projection | ✓ | deferred trigger |
| Σ allocations(payment) ≤ payment | ✓ | deferred trigger |
| Reversed payment has no active allocations | ✓ | deferred trigger |
| Allocation, payment, schedule share one contract; payment's person owns contract | — | composite FKs |
| History immutable (payments, disbursements, allocations, ledger, audit, contract terms, schedule expectations, `missedAt`) | ✓ | triggers |
| Totals derived from transactions, never from client | ✓ server recomputes | — |
| Exactly-once payment creation | idempotency key | UNIQUE |

Operational hardening: run the app with a DB role that is **not** the table owner (so it cannot
`DROP TRIGGER`), and keep migrations under a separate owner role.

---

## 8. Authentication & security

**Who can use it:** only `ADMIN` accounts (currently two, identified by mobile number). `OPERATOR` / `VIEWER`
exist in the enum for the future; such accounts can authenticate but are sent to `/access-denied`.

**Login:** mobile number + password via **Auth.js v5 (Credentials provider)**. The number is normalised to a
canonical 10-digit form (`+91 93165 68042` → `9316568042`, `lib/auth/mobile.ts`); the DB CHECK only accepts
that form, so formatting can't create duplicate accounts.

**Passwords:** Argon2id (`@node-rs/argon2`, m=19 MiB, t=2, p=1). A DB CHECK rejects any `passwordHash` that
isn't an Argon2id PHC string, so plaintext can't be stored even by mistake. Policy: 12–128 chars, letters +
digits, not common, not containing the mobile number. Passwords never appear in logs or audit rows
(`snapshot()` also strips any `password*`/`token`/`secret` keys defensively).

**Sessions — server-side, revocable.** Auth.js only supports the JWT strategy with Credentials, so the JWT
(encrypted with `AUTH_SECRET`, `HttpOnly`, `SameSite=Lax`, `Secure` + `__Secure-` prefix in production) is only
a carrier for a random 256-bit session id. The `sessions` table (storing only its SHA-256) is the authority:
the Auth.js `jwt` callback re-validates the row on every request, so **logout, password change and account
disable take effect immediately**. Sessions expire after 12 hours (absolute).

```
Browser ──cookie──▶ proxy.ts            optimistic: no cookie → 307 /login   (no DB)
                  ▶ page/action        requireAdmin() / requireAdminActor()  (lib/auth/dal.ts)
                                         └ auth() → jwt callback → sessions row valid? user active?
                                            → not signed in: /login · not ADMIN: /access-denied
```

**Enumeration & brute force:** unknown number and wrong password give the same message and the same Argon2
work (dummy hash). "Account disabled" is shown only when the password was correct. Limits (DB-backed, so they
work on serverless): 5 failures per number (reset by a success) and 10 per IP within 15 minutes.

**Audit:** `LOGIN_SUCCESS`, `LOGIN_FAILED` (with reason; attempted number only if well-formed), `LOGOUT`,
`PASSWORD_CHANGED`, `ACCOUNT_CREATED`, `ACCOUNT_DISABLED`, `ACCOUNT_ENABLED` — with IP and user agent.

**Ownership:** every financial service requires an authenticated actor (`requireUserActor`) and records it:
`createdById` (person, contract, disbursement, payment), `reversedById` (payment, disbursement),
`cancelledById` (contract), and `AuditLog.userId`. Only reconciliation runs as the system actor.

**Admin rules:** accounts are never deleted (financial/audit FKs). An admin can't disable themselves; the last
active admin can't be disabled (admin rows are locked, so two admins disabling each other concurrently leaves
exactly one active).

**Bootstrap:** `npm run db:seed` creates `INITIAL_ADMIN_<n>_MOBILE/_PASSWORD` accounts from the environment if
missing; existing accounts (and their passwords) are never touched. Safe to re-run.

**Secrets:** `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET` are server-only env vars (never `NEXT_PUBLIC_`).
`npm run security:scan` fails the build output if any of them — or password hashing / session code — appears
in the client bundle. Security headers: `X-Frame-Options: DENY`, `nosniff`, HSTS, strict referrer; authenticated
pages are `Cache-Control: no-store` so Back after logout can't show cached data.

---

## 9. Where the design goes beyond the brief (and why)

1. **No stored OVERPAID status / AdvanceBalance table** — prepaid and credit are derived exactly from
   allocations; storing them would be a second source of truth.
2. **`AllocationRun` model** — groups allocation changes so the UI can answer "why did this money move?".
3. **`ReconciliationRun` model** — observable job history (`closedThrough`, counts, errors).
4. **Rebuild-and-diff allocation** instead of ad-hoc incremental updates (§5.2).
5. **Deferred DB constraint triggers** verify the schedule projection and payment allocation totals at
   COMMIT, so a partially-applied payment is impossible even with buggy application code.
6. **`db:verify`** re-derives every contract from its facts and checks ledger ↔ transaction parity.

---

## 10. Build status

1. ✅ Schema, migration, DB invariants
2. ✅ Pure finance core (`lib/finance`) — unit tests
3. ✅ Services (`lib/services`): people, contracts + disbursement + schedule, payments, reversal,
   correction (incl. cross-contract), cancellation, default, disbursement reversal, reconciliation,
   integrity check, contract summary read model
4. ✅ Authentication (§8): Auth.js v5 mobile + password, Argon2id, revocable DB sessions, rate limiting, audit,
   `/login`, `/access-denied`, `/settings/{account,security,users}`, admin bootstrap
5. ✅ Cron route `/api/cron/reconcile` + `vercel.json` (00:05 IST), seed that replays history through the services
6. ✅ Integration suite (`tests/integration`) — passes on Postgres 18; **pending: run on a Neon branch**
7. ✅ Mobile-first UI (§12): bottom nav (Home · People · Collect · Activity · More), People directory + search,
   person dashboard, Add Person → Add Contract (preview + review) → Record Payment (allocation receipt),
   contract page + collection calendar with day sheets, Activity, person statement
8. ⏭ Missed-collections page, payment reversal/correction and contract cancellation screens
9. ⏭ Audit log page, reports + CSV, statements, settings

## 12. UI architecture

**Principle:** Person → Contracts → Collections → Payments. The person dashboard is the operating screen.

- **Mobile-first, one codebase.** Fixed bottom nav on phones (`md:hidden`), sidebar on desktop; cards on
  phones, tables on `lg+`. 44px+ touch targets, sticky primary action above the nav, native date/select pickers,
  bottom sheets (vaul) for day detail. Tested at 360/390/430px with no horizontal overflow.
- **No financial logic in React.** Pages are Server Components reading `lib/services/read-models.ts`, whose
  per-contract SQL mirrors `summarizeContract` exactly (proved by `tests/integration/read-models.test.ts`).
  Person and portfolio totals are sums of independent contract aggregates. The only shared logic on the client
  is the pure `buildContractTerms` for the live contract preview; the server recomputes on submit.
- **Mutations** are server actions (`app/actions/*`) → `adminActorOrRedirect()` → zod → the existing services.
  Payment/contract forms carry a per-form idempotency key, so double taps and retries record once.
- **Receipts explain money.** After a payment the engine's allocation explanation is shown
  (₹750 → 28 Sep outstanding, ₹750 → 29 Sep collection) with outstanding before → after.
- **Auth gate:** the `(app)` layout calls `requireAdmin()` so full page loads get a real 307 before streaming
  starts; every page and action also checks, because layouts don't re-run on client navigation.

---

## 13. Short-term loans

A lump sum given now, returned later with a **fixed interest amount** agreed up front. No schedule, no daily
obligations, no time limit — separate from contracts, but in the same ledger, audit log and person totals.

| Step | What happens |
|---|---|
| Give money | `ShortTermLoan` row (terms immutable) + ledger `SHORT_TERM_GIVEN` (−principal) + audit |
| Money back | `ShortTermRepayment` (one or many) + ledger `SHORT_TERM_REPAYMENT` (+amount). Never more than outstanding |
| Fully back | Loan closes automatically (`CLOSED`, closedOn = repayment date, closedBy = admin) |
| Settle & close | Close now taking a final amount (₹0 allowed); the shortfall is stored as `waivedAmount`, a note is required |
| Mistake in a repayment | Reverse it (kept, `REVERSED`, ledger reversal). A closed loan reopens and its waiver is undone |
| Loan entered by mistake | Cancel — only while nothing has been received; ledger `SHORT_TERM_CANCELLED` (+principal) |

Outstanding = principal + interest − Σ active repayments (0 once closed/cancelled). Money back counts toward
principal first, then interest. Person "Total Outstanding" = contracts + open short-term loans.

**Database guarantees** (migration `20261005000000_short_term_loans`): positive amounts, immutable terms and
repayments, no deletes, composite FK so a repayment can't name another person, each ledger row belongs to exactly
one contract *or* one loan, and deferred COMMIT-time checks: never over-repaid, a fully repaid loan can't stay
OPEN, a CLOSED loan's received + waived = due, a CANCELLED loan has no repayments. Rows are locked per loan, so two
simultaneous repayments can't over-collect (tested).

---

## 14. Borrowings (money you owe)

The same short-term engine with `direction = BORROWED`: someone lends **you** money, you pay back principal + a
fixed interest amount, no time limit. Labels are `BR-0004` (lent loans stay `ST-0003`; one shared number sequence).

| | Lent (`ST-`) | Borrowed (`BR-`) |
|---|---|---|
| Start | `SHORT_TERM_GIVEN` −principal | `BORROWING_RECEIVED` +principal |
| Money back / paid back | `SHORT_TERM_REPAYMENT` + | `BORROWING_REPAID` − |
| Reversal | `SHORT_TERM_REPAYMENT_REVERSAL` − | `BORROWING_REPAID_REVERSAL` + |
| Cancel | `SHORT_TERM_CANCELLED` + | `BORROWING_CANCELLED` − |
| Settle for less | you let it go | the lender let you off |

**Never netted:** a person's Total Outstanding (what they owe you) excludes borrowings; "You owe them" is shown
separately on the person page, the People list ("I owe" column), Home ("I owe (borrowed)") and the short-term list.
The DB rejects a ledger entry whose type doesn't match the loan's direction, and `direction` is immutable
(migration `20261006000000_borrowings`).

---

## 11. Commands

```
npm run typecheck && npm test    # types + unit tests (finance, auth, routing)
TEST_DATABASE_URL=… npm run test:integration   # DROPS that DB's public schema, migrates, runs ledger + auth E2E
npm run build && npm run security:scan         # production build, then prove no secrets reach the browser
E2E_BASE_URL=http://localhost:3000 npm run test:e2e   # HTTP flows against a running `next start` (same DATABASE_URL)
UI_BASE_URL=http://localhost:3000 UI_MOBILE=… UI_PASSWORD=… npm run test:ui   # real-browser mobile journey incl. short-term (creates one test person)
npm run db:migrate               # prisma migrate deploy
npm run db:seed                  # create the initial administrators from INITIAL_ADMIN_* (idempotent)
npm run db:seed:demo             # demo customers/contracts — development only
npm run db:verify                # re-verify every contract's books; exit 1 on any issue
```
