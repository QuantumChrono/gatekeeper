# Agents and Skills

## Custom AI Coding Agent

This repository uses a standard AI coding agent for assistance, guided by the `CLAUDE.md` constitution and the in-repo `AGENTS.md` project rules. The agent is not part of the runtime application; it is used for development and auditing support.

## Custom Skill Script

A simple custom skill script has been added at `scripts/db-health-check.js`.

### Purpose

- Verifies Supabase connectivity and schema health.
- Checks that the required tables exist: `tickets` and `ticket_events`.
- Verifies that the Supabase REST API is reachable.
- Probes that two expected RPC endpoints exist: `apply_transition` and `record_pipeline_failure`.
- Confirms the demo seed contains at least one ticket.

### Usage

Run the script with Node:

```bash
node scripts/db-health-check.js
```

It reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` and exits with code 0 when healthy or 1 on failure.
