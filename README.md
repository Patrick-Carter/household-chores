# Carter House Ledger

A password-protected household chore planner for Patrick, Nelly, and Nancy. Household members take ongoing ownership of recurring chores and choose their recurring schedule. Administrators manage people, rooms, chores, workload balance, assignments, and flags.

## Features

- Shared household password (`carterhub` by default) with a separate admin password (`adminhub` by default)
- Admin management for users, rooms, chore cadence, and estimated minutes
- Daily, weekly, monthly, and as-needed chore templates
- Persistent assignments that remain claimed until the assignee or an administrator releases them
- Daily time, weekly weekday/time, and monthly day-of-month/time schedules
- Personal commitments and a household-wide schedule
- Explicit completion and release actions
- Flags from another household member for overdue or poorly completed work, with a required comment
- Admin flag resolution with an option to reopen the chore
- Claimed-work percentages weighted by estimated monthly minutes and recurrence frequency
- Persistent SQLite storage and a responsive desktop/mobile interface

## Local development

Requires Node 22.

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies API traffic to the Express server on port 3000.

```bash
npm test
npm run typecheck
npm run build
npm start
```

The production server serves both the API and built React app at <http://localhost:3000>.

## Docker

```bash
cp .env.example .env
docker compose up --build -d
```

Open <http://localhost:3001>. The host port defaults to 3001 so this can run beside Gridiron Heads on port 3000. SQLite is persisted under `./data/chores.db`.

Passwords can be changed in `.env` without rebuilding the image:

```dotenv
HOUSEHOLD_PASSWORD=carterhub
ADMIN_PASSWORD=adminhub
HOUSEHOLD_TIMEZONE=America/Chicago
```

Existing browser sessions remain valid until they expire or are removed from the `auth_sessions` table. Changing a password affects new logins.

## Unraid

Two deployment paths are included:

1. Use Unraid Compose Manager with `docker-compose.yml` and map `./data` to an appdata location.
2. Copy `unraid-template.xml` to `/boot/config/plugins/dockerMan/templates-user/`, then add the `household-chores` user template.

The expected persistent mapping is:

```text
/mnt/user/appdata/household-chores/data -> /app/data
```

The container listens internally on port 3000 and the template maps host port 3001. A Cloudflare Tunnel can target `http://<unraid-ip>:3001`. If the app is hosted at another browser origin, add it to `ALLOWED_ORIGINS` as a comma-separated value.

The GitHub Actions workflow publishes `ghcr.io/<repository-owner>/household-chores:latest` after this project is pushed to a GitHub repository. The included Compose file and Unraid template currently use `ghcr.io/patrick-carter/household-chores:latest`.

## Scheduling rules

- A chore has one active assignee until that person or an administrator releases it.
- Daily chores have a recurring time and reset after each local calendar day.
- Weekly chores have a weekday and time and reset each Monday-through-Sunday week.
- Monthly chores have a day-of-month and time and reset each local calendar month. Dates beyond the end of a shorter month use that month's final day.
- As-needed chores have no fixed deadline, remain assigned, and can be marked complete repeatedly.
- Completing a chore records the current period but does not release its assignment.
- Another user may flag a completed chore or an active chore after its scheduled time.
- Workload percentages estimate monthly responsibility: daily minutes are multiplied by 30, weekly minutes by 4.33, and monthly/as-needed chores by 1.

Calendar periods use `HOUSEHOLD_TIMEZONE`; the default is `America/Chicago`.

## Initial data

The first startup creates Patrick, Nelly, and Nancy, plus the requested rooms and 26 chores. Initial time estimates range from 5 minutes for small clutter tasks to 45 minutes for shower cleaning and outdoor pest treatment. Every estimate can be replaced by disabling the seeded chore and creating an updated one from the admin console.

## Architecture

```text
shared/  Shared TypeScript API types
server/  Express API, authentication, recurrence rules, SQLite
client/  Vite + React responsive interface
```

Passwords are checked only by the server. Successful login creates a random 256-bit bearer session token with a configurable expiration. This is intentionally simple shared household access, not individual identity security: anyone who knows the household password can select any active household member.
