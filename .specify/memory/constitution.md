<!--
Sync Impact Report
- Version change: 1.0.0 → 1.0.1
- Principles: unchanged in substance; the document was rewritten in English to match
  the rest of the repository (README, code comments, commit messages).
  - I. Un único camino de despliegue → I. One Deployment Path
  - II. Los datos no se pierden → II. Contributions Are Not Lost
  - III. Los secretos viven en el servidor → III. Secrets Live On The Server
  - IV. Desarrollo igual que producción → IV. Development Matches Production
  - V. Pruebas contra el servicio real → V. Tests Drive The Real Service
  - VI. Privacidad de quien contribuye → VI. Contributor Privacy
- Sections renamed: Restricciones técnicas y de seguridad → Technical And Security
  Constraints; Flujo de trabajo y puertas de calidad → Workflow And Quality Gates
- Removed sections: none
- Deferred items: none
-->

# Granada 2031 — Mapamundi Constitution

A participatory platform where people around the world place their connection to Granada
on a map. It collects personal data and photographs from real people, and publishes only
what a human team has reviewed. These principles describe how it is built and operated.

## Core Principles

### I. One Deployment Path

There is a single deployment procedure: `scripts/deploy.sh`. CI invokes it and a person
on the server invokes it, with the same steps in the same order. A separate manual
procedure "for emergencies" MUST NOT exist: an emergency is precisely when the
less-practised path fails.

A deploy MUST refuse any commit that is not the tip of `origin/main`, and any working
tree with uncommitted changes. Production always corresponds to a commit anyone can look
up.

*Rationale*: when the manual and automated paths diverge, the one used under pressure is
the one nobody has tested. And a queued CI run can be dispatched long after it was
created — when an offline runner returns, say — silently reverting everything merged
since.

### II. Contributions Are Not Lost

Contributions are irreplaceable: nobody will write their memory a second time if it is
deleted. Therefore:

- Every deploy MUST back up before changing anything, and that backup MUST be verified
  as it is created. A backup that cannot be read back is not a backup.
- Schema changes go in numbered files under `migrations/`, apply exactly once and in
  order, and run **before** the new API serves traffic.
- Migrations are written additively: add a field, backfill it, and drop the old one only
  in a later migration once nothing reads it. The previous version of the code MUST keep
  working against the new schema.
- Restores are tested, not assumed. Restoring MUST begin by backing up current state, so
  that restoring the wrong snapshot is itself recoverable.

*Rationale*: writing migrations additively is what lets a code rollback skip the restore,
which is always the slowest and riskiest operation available.

### III. Secrets Live On The Server

Production credentials live on the server under `/etc/granada/`, owned by `root` and
readable only by what needs them. They are NEVER stored in the repository, and never
derive from a default baked into the code.

No service in the stack is published on a public interface. Containers listen on
`127.0.0.1` and the host's Nginx is the only entry point, because Docker publishes ports
past the firewall.

Any default that acts as a credential — admin password, session secret, database user —
MUST be unusable in production: either it is supplied explicitly, or the service does not
come up with a publicly known value.

*Rationale*: a repository placeholder serving as a live password is indistinguishable
from having no password at all.

### IV. Development Matches Production

Local development uses the same compose files as production, the same database, and the
same authentication. The difference is limited to an overlay that adjusts ports and
disables demo content.

A change that works only locally, or only in production, means parity has broken and MUST
be fixed before continuing.

*Rationale*: every difference between environments is a bug that surfaces after
deploying, when it already affects people.

### V. Tests Drive The Real Service

Tests start the server as a real process and drive it over HTTP, against throwaway
directories and databases. They cover both storage backends.

Tests MUST NOT touch production data, uploads or configuration. They MUST also be cheap
to run: they share a machine with the live site, so their resources are capped and
superseded runs are cancelled rather than queued.

A test that silently skips protects nothing: if a suite is gated on an environment
variable, some CI job MUST provide it.

*Rationale*: test doubles confirm what we believe about the system; only the running
service confirms what it does.

### VI. Contributor Privacy

People hand over their name, their email and a photograph in exchange for appearing on a
map. The public API MUST NOT expose personal data beyond what displaying the contribution
requires — email addresses in particular never reach the public.

No contribution is published without human review. The endpoints that approve, edit or
delete contributions are always authenticated.

*Rationale*: the trust of the people taking part is the project's raw material, and it is
lost only once.

## Technical And Security Constraints

- **Stack**: Bun (TypeScript) API, MongoDB as the primary store with SQLite as the local
  alternative, and Nginx as the gateway. The frontend loads no dependency from a CDN;
  they are vendored as static assets.
- **Isolation**: the production host runs other services. No change from this project may
  degrade them; ports, networks and volumes are declared explicitly and narrowly.
- **Backups**: nightly and before every deploy, with a bounded retention window that
  always keeps the most recent ones regardless of age.
- **Outages**: when the stack is unreachable, the site serves a maintenance page that
  preserves the error status code, so automated checks still see a failure.

## Workflow And Quality Gates

- Work is specified before it is built; `specs/` holds each feature's specification, plan
  and tasks.
- Tests run on every pull request. Only code and configuration trigger a deploy:
  documentation and specs rebuild nothing.
- Every deploy ends by checking that the API and the gateway respond. A deploy that
  cannot be verified counts as failed.
- Commit messages explain why something changed and what was broken before, not just
  which file was touched.

## Governance

This constitution supersedes other practices in the project. When a technical decision
conflicts with these principles, the decision changes or the constitution is amended — it
is not ignored.

**Amendments**: proposed by pull request, describing the principle affected, the reason
for the change, and its effect on existing code. An amendment that invalidates current
practice MUST include how to migrate away from it.

**Versioning**: MAJOR when a principle is removed or redefined incompatibly; MINOR when a
principle is added or guidance materially expanded; PATCH for clarifications and
corrections that do not change meaning.

**Compliance**: every code review verifies that changes respect these principles. Added
complexity is justified explicitly; absent a justification, the simpler option wins.
`README.md` documents the operational detail — deployment, migrations, backups — and is
the day-to-day reference.

**Version**: 1.0.1 | **Ratified**: 2026-08-10 | **Last Amended**: 2026-08-10
