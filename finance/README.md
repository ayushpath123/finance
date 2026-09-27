# ARTI FINANCE

Daily money-collection ledger: contracts, fixed daily schedules, payments, oldest-first allocation,
end-of-day reconciliation (Asia/Kolkata), append-only ledger and audit log.

Design and financial rules: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Setup

```bash
npm install
cp .env.example .env.local    # then fill in: rotated Neon DATABASE_URL, AUTH_SECRET, admin passwords, CRON_SECRET
npm run db:migrate            # schema + database invariants
npm run db:generate
npm run db:seed               # creates the administrators from INITIAL_ADMIN_* (safe to re-run)
npm run dev                   # → http://localhost:3000/login
```

Sign in with an administrator's 10-digit mobile number and password. Change the bootstrap password at
**Settings → Security** after the first login.

## Verification

```bash
npm run typecheck && npm test                              # unit tests
TEST_DATABASE_URL=<disposable db> npm run test:integration # real Postgres/Neon branch (schema is dropped!)
npm run build && npm run security:scan                     # no secrets in the client bundle
E2E_BASE_URL=http://localhost:3000 npm run test:e2e        # against a running server
npm run db:verify                                          # re-derive and check every contract's books
```

Production (Vercel): set `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET` (and `INITIAL_ADMIN_*` only for the
one-time `db:seed`) in the project's environment variables — never in the repository.
