# RoadLink Agent Rules

## Product architecture

RoadLink uses ONE ACCOUNT.

There are NOT separate customer/carrier account types and there must be no Customer <-> Driver account-role switching in the active UX.

A normal RoadLink account may:
- create transport requests
- use SOS
- use service features

Provider capability is an extension of the same account and is represented by `carrier_profiles`.

`owner` and `provider` describe transaction context, NOT account identity.

Do not reintroduce role-selection UX based on `profiles.role`.
`profiles.role` is legacy compatibility data, not the product identity model.

## Core transport concepts

POPTÁVKA:
User needs a vehicle transported.

CENOVÁ NABÍDKA:
Provider response to one specific Poptávka.
It is NOT a standalone marketplace listing.

VOLNÁ KAPACITA:
Provider is already planning a route and has spare vehicle capacity.
This is a core RoadLink differentiator.

## Main navigation

- Přehled
- Přeprava
- +
- SOS
- Profil

## Development workflow

SPEC -> IMPLEMENT -> VERIFY -> ACCEPT

IMPLEMENT:
Make only the requested change.
Typecheck PASS means implementation validation only, not runtime acceptance.

VERIFY:
Prefer independent verification when useful.
Verification tasks must not modify code unless explicitly authorized.
Do not repeat a full E2E when a narrow targeted verification is sufficient.

ACCEPT:
Requires the requested evidence.
Do not mark a feature verified solely because the worker says it works.

## Resource-efficient agent mode

This is IMPORTANT.

Hermes/model usage is limited.

For every task:
- use the minimum number of tool/model calls necessary
- do not perform broad audits unless explicitly requested
- do not rediscover facts already provided in this file or task prompt
- inspect only files/code relevant to the ticket
- do not repeat already-passed E2E scenarios without a specific regression reason
- prefer targeted verification over full regression
- do not generate long plans/reports unless requested
- do not refactor unrelated code
- stop when the Definition of Done is satisfied
- return short structured results
- ask for human intervention only when genuinely required

One ticket = one logical task.

## Android automation hygiene

Before typing into an existing text field:
- inspect whether it already contains text
- never accidentally append new credentials/text
- prefer select-all-and-replace
- verify critical entered values before submitting

For date/time tests:
- use a safely future time, preferably at least +1 hour
- expected rejection of a past time is NOT a RoadLink bug

## Location data integrity

Human-readable address and coordinates are separate data.

Never persist device GPS or DEFAULT_REGION as coordinates belonging to a manually entered address.

Unknown coordinates (NULL) are better than false coordinates.

DEFAULT_REGION may be used only as a map viewport fallback.

Current manually entered pickup requests may legitimately have NULL coordinates until geocoding/address selection is implemented.

## Database/change safety

Do not invent database columns.

Do not change Supabase schema, migrations, RLS or RPC as part of another ticket unless explicitly requested.

Do not combine security cleanup with unrelated feature work.

Known security debt exists around duplicate permissive RLS policies and broad `tow_requests` provider UPDATE permissions. Treat it as a separate ticket.
