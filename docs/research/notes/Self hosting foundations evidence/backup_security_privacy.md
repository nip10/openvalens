# Backup/Restore, Secure-by-Default Deployment, and Privacy Obligations for a Self-Hosted Health App (openhealth)

Scope: Postgres + Bun/Hono server + React web + Expo mobile, shipped as Docker Compose; may later store photos/exports as files. Research date: 2026-10-02. Legal points are flagged **[COUNSEL]** where a lawyer should confirm before relying on them. Claims drawn from my background knowledge rather than a source fetched in this session are explicitly labelled "unverified this session" and kept out of the Cited Findings lists.

## 1. Postgres backup methods and what comparable self-hosted apps do

### Takeaway
For a single-node, small-database self-hosted app, a scheduled logical dump (`pg_dump -Fc`, plus globals if roles matter) is the right default: it is internally consistent, restores into newer Postgres major versions, and is what Immich ships. PITR (base backup + WAL archiving, via pgBackRest/WAL-G/Barman) is an opt-in "advanced" tier. It restores only whole clusters, ties you to one Postgres major version, and the archive pipeline has to be tested before the first base backup. File attachments (photos/exports) need a separate backup that runs alongside the DB dump, because a DB dump does not contain them.

### Cited Findings
- PostgreSQL docs (v18.6 current at fetch): "Dumps created by pg_dump are internally consistent, meaning, the dump represents a snapshot of the database at the time pg_dump began running." — [PostgreSQL: SQL Dump](https://www.postgresql.org/docs/current/backup-dump.html)
- "pg_dump does not block other operations on the database while it is working" (except operations needing exclusive locks, e.g. most `ALTER TABLE`). Running a migration at the same moment as a dump can therefore conflict. — [PostgreSQL: SQL Dump](https://www.postgresql.org/docs/current/backup-dump.html)
- pg_dump dumps one database and **does not dump roles or tablespaces**. `pg_dumpall` adds cluster-wide globals, but "the snapshots of different databases are not synchronized." — [PostgreSQL: SQL Dump](https://www.postgresql.org/docs/current/backup-dump.html)
- "pg_dump's output can generally be re-loaded into newer versions of PostgreSQL, whereas file-level backups and continuous archiving are both extremely server-version-specific." — [PostgreSQL: SQL Dump](https://www.postgresql.org/docs/current/backup-dump.html)
- Restore options: `psql -X --single-transaction dbname < dumpfile` (all-or-nothing) or `pg_restore -d dbname` for custom/directory formats. `-Fc` allows selective restore, and `-j` with `-Fd` gives parallel dumps. — [PostgreSQL: SQL Dump](https://www.postgresql.org/docs/current/backup-dump.html)
- Continuous archiving/PITR lets you "restore the database to its state at any time since your base backup was taken". It needs `pg_basebackup` plus `archive_mode=on` with an `archive_command` that must "return zero exit status if and only if it succeeds." — [PostgreSQL: Continuous Archiving and PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)
- PITR limitations: "can only support restoration of an entire database cluster, not a subset". A busy system generates "many megabytes of WAL traffic". If archiving fails, `pg_wal/` keeps filling until the problem is fixed (risk of running out of disk). — [PostgreSQL: Continuous Archiving and PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)
- "you should set up and test your procedure for archiving WAL files *before* you take your first base backup." WAL replay does not restore config files (`postgresql.conf`, `pg_hba.conf`), so back them up separately. Incremental backups (`pg_basebackup --incremental` + `pg_combinebackup`) are now in core. — [PostgreSQL: Continuous Archiving and PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)
- **Immich**: makes automatic daily DB dumps at 2:00 AM by default, keeps the last 14, stores them as `.sql.gz` in `UPLOAD_LOCATION/backups`, and lets you configure this in Admin > Settings > Backup. — [Immich: Backup and Restore](https://docs.immich.app/administration/backup-and-restore/)
- Immich warns: "Database backups do **not** contain photos or videos — only metadata". Users need both the DB backup and `UPLOAD_LOCATION`. The docs endorse 3-2-1 and advise against backing up the raw Postgres data directory (`DB_DATA_LOCATION`). — [Immich: Backup and Restore](https://docs.immich.app/administration/backup-and-restore/)
- Immich offers restore from the web UI (Administration > Maintenance) and from the onboarding screen on fresh installs. It "automatically creates a restore point before operations and rolls back if restoration fails." — [Immich: Backup and Restore](https://docs.immich.app/administration/backup-and-restore/)
- **Nextcloud AIO**: ships an optional backup solution "based on BorgBackup" with encryption, deduplication, "backup integrity check and integrity-repair", and creation/restore/check from the AIO UI. It supports a remote borg repository. To restore, "you only need the archive and the password". — [nextcloud/all-in-one README](https://github.com/nextcloud/all-in-one)

### Inferences
- Recommended openhealth design:
  - A built-in scheduled `pg_dump -Fc` job, Immich-style. Use a sidecar container or a server cron, with configurable time and retention (e.g. 14).
  - Write dumps into the same data volume as the files dir, so that one directory is "the thing to back up".
  - Add a manifest that records app version, schema/migration version, Postgres version and checksums.
- Restore should be a first-class, documented command, and ideally a UI flow like Immich's. Use `--single-transaction` or a pre-restore snapshot so that a failed restore leaves the instance in its prior state.
- Do not include `pg_dumpall` globals unless openhealth relies on custom roles. Compose-managed DBs usually have a single owner role recreated from env, and a single-DB `pg_dump` with `--no-owner` restores more portably.
- Document PITR (pgBackRest/WAL-G) as optional. It does not fit a "simple self-host" default, mainly because it is version-locked and only restores whole clusters.
- When files (photos/exports) are added, their storage has to be copied together with the DB dump. Otherwise metadata and files drift apart, the same problem Immich warns about. A Nextcloud-style option is to wrap both in a borg/restic snapshot.

### Gaps
- I did not fetch the pgBackRest, WAL-G or Barman docs this session. Background knowledge (unverified this session): pgBackRest supports full/diff/incremental backups, encryption, S3/Azure/GCS repos and `verify`. WAL-G is a cloud-oriented archiver from Citus/Yandex lineage. Barman is from EnterpriseDB (formerly 2ndQuadrant). Fetch their docs if this tier will be documented.
- The Paperless-ngx administration docs returned HTTP 403, so its `document_exporter` features are not verified. Background knowledge (unverified this session): it exports documents plus a JSON manifest, has a passphrase-encryption option and a compare-checksums option, and `document_importer` expects an empty DB on the same version.

## 2. Encryption, offsite copies, key management, and restore testing

### Takeaway
Offsite backups should be client-side encrypted (restic and borg always encrypt; age works for single files). The main risk is key or passphrase loss: restic says outright that a lost password means irrecoverable data. Self-hosters need a documented key-escrow step, such as a printed recovery sheet or a password manager entry. Restore drills should be a product feature, not a hope. The best evidence for why comes from attackers: the Postgres ransom bot claimed "All your data is backed up" and kept only 20 rows per table.

### Cited Findings
- restic: "Losing your password means that your data is irrecoverably lost." Encryption applies to every repository (local, SFTP, REST server, S3-compatible, B2, Azure, GCS, rclone). — [restic: Preparing a new repository](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)
- Nextcloud AIO's borg backup needs "the archive and the password" to restore, and has integrity check/repair built into the UI. — [nextcloud/all-in-one README](https://github.com/nextcloud/all-in-one)
- Immich recommends the 3-2-1 strategy and requires both the DB and the media to be backed up. — [Immich: Backup and Restore](https://docs.immich.app/administration/backup-and-restore/)
- Postgres PITR docs say to test the archive procedure before relying on it. — [PostgreSQL: Continuous Archiving](https://www.postgresql.org/docs/current/continuous-archiving.html)
- Example of what an unverified "backup" claim is worth: the extortion bot's ransom note said "All your data is backed up", but Border0 found it only kept the first 20 rows per table. — [The Register, 2024-01-17](https://www.theregister.com/2024/01/17/extortion_bot_is_autopwning_postgresql/)

### Inferences
- Default offsite recommendation: restic (single Go binary, many backends) or borg (Nextcloud precedent) pointed at the dump directory plus the files dir. Use age for one-off encrypted exports handed to the user.
- First-run or setup flow should:
  - generate the backup passphrase;
  - show it once with a "store this offline" warning;
  - optionally require the admin to re-enter it to confirm.
- Never store the passphrase only inside the backed-up volume. If the host dies, the key goes with it.
- Ship a `restore-verify` command: restore the latest dump into a throwaway Postgres container, run migrations/sanity queries (row counts, schema version), and report a pass/fail. Surface the last successful verification date in the admin UI.

### Gaps
- I did not fetch a primary source for where the **3-2-1 rule** comes from. It is commonly attributed to photographer Peter Krogh (*The DAM Book*), unverified this session. Cite Immich's or a vendor's use of it rather than claiming its origin.
- I found no high-quality statistical study of restore failure rates (for example "X% of backups fail to restore"). Vendor surveys exist but were not checked. Avoid quoting a number.
- restic `check --read-data` and borg `check --verify-data` exist (background knowledge) but their docs were not fetched this session.

## 3. Secure defaults in Docker Compose

### Takeaway
Docker publishes ports on all interfaces by default and its NAT rules bypass ufw. So the shipped Compose file must not publish Postgres at all: keep it on an internal network only, and bind any debug port to 127.0.0.1. Generate secrets at install time instead of shipping default passwords, and put TLS in front via Caddy, which gets certificates automatically. Exposed Postgres instances are being hunted and wiped by bots, sometimes within hours.

### Cited Findings
- "By default, when a container's ports are mapped without any specific host address, the Docker daemon publishes ports to all host addresses (`0.0.0.0` and `[::]`)." — [Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)
- "Publishing container ports is insecure by default." Binding to `127.0.0.1`/`::1` restricts access to the host. On Docker versions before 28.0.0, hosts on the same L2 segment could reach ports published to localhost. — [Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)
- "When you publish a container's ports using Docker, traffic to and from that container gets diverted before it goes through the ufw firewall settings". The reason is that Docker routes traffic in the `nat` table, before the `INPUT`/`OUTPUT` chains that ufw uses. — [Docker: Packet filtering and firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
- Border0 Shodan scans found more than 800,000 exposed PostgreSQL servers. Poorly protected ones were breached "multiple times a day", and one developer reported compromise "immediately" after accidental exposure. The bot extorted about $3,000 from 6 victims in one week. — [The Register, 2024-01-17](https://www.theregister.com/2024/01/17/extortion_bot_is_autopwning_postgresql/)
- Shadowserver runs a dedicated "Accessible PostgreSQL Server" report, rated HIGH severity. Aqua documented PG_MEM malware that targets weak-credential Postgres. — [Shadowserver report](https://www.shadowserver.org/what-we-do/network-reporting/accessible-postgresql-server-report/); [Aqua: PG_MEM](https://www.aquasec.com/blog/pg_mem-a-malware-hidden-in-the-postgres-processes/) (search results only; not fully fetched)
- Caddy was "the first web server to use HTTPS automatically *and by default*". It obtains and renews certificates from Let's Encrypt/ZeroSSL and redirects HTTP to HTTPS. It needs DNS pointing at the host, ports 80/443 reachable (or the DNS challenge) and a persistent data dir. Use the staging ACME endpoint when testing, to avoid rate limits of up to a week. — [Caddy: Automatic HTTPS](https://caddyserver.com/docs/automatic-https)

### Inferences
- Concrete Compose defaults for openhealth:
  1. The `db` service has no `ports:`. Only an internal `backend` network is shared with `server`.
  2. Only Caddy publishes 80/443.
  3. Optional dev override binds `127.0.0.1:5432:5432`.
  4. `.env` is generated by an install script (`openssl rand`) for `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET` and the backup passphrase. The server refuses to start if a known placeholder value is detected.
  5. App containers run as non-root (`user:`), with `read_only: true` where feasible, `cap_drop: [ALL]` and `security_opt: no-new-privileges`.
  6. Image versions are pinned.
- Document the ufw pitfall in the install guide. The safe position is "don't publish what you don't need". For anything that must be published, point to the `DOCKER-USER` chain.
- Behind Caddy, configure Better Auth's IP header and trusted proxy correctly (see §4). Otherwise rate limiting keys on the proxy's IP.

### Gaps
- The Docker docs I fetched did not return the `DOCKER-USER` chain details. That chain is in Docker's iptables docs (background knowledge, page not fetched).
- I did not verify which official images run as non-root by default. The `postgres` image starts as root and drops to the `postgres` user (background knowledge, unverified). The Bun image's default user was also not verified.
- OWASP Docker Security Cheat Sheet was not fetched. It is a suitable citation for non-root, no-new-privileges and read-only rootfs.

## 4. Encryption at rest and auth hardening

### Takeaway
For self-hosting, disk/volume encryption (LUKS/FileVault/cloud-volume encryption) plus encrypted backups covers the realistic threats: stolen disks and leaked backup files. Column-level encryption helps little when the app server holds the key, and it hurts querying, so reserve it for a few high-sensitivity fields if at all. On auth, Better Auth gives the building blocks: sign-up lockdown, built-in rate limiting (with caveats), and 2FA/passkey plugins. The project should turn these on by default.

### Cited Findings
- Better Auth rate limiting is "automatically enabled in production". The default is 100 requests per 10 s window, and `/sign-in/email` is limited to 3 requests per 10 s. 2FA endpoints get similarly strict limits. — [Better Auth: Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit)
- Caveats: server-side `auth.api` calls bypass rate limiting. Default storage is **memory** (fine for one instance; options are `"database"`, secondary storage or custom). The IP comes from `x-forwarded-for` by default and can be configured (e.g. `cf-connecting-ip`, trusted proxies). — [Better Auth: Rate Limit](https://www.better-auth.com/docs/concepts/rate-limit)
- `emailAndPassword.disableSignUp: true` disables new sign-ups so that only existing users can sign in. Related options: `requireEmailVerification`, `minPasswordLength`. — [Better Auth: Options](https://better-auth.com/docs/reference/options); [Basic Usage](https://better-auth.com/docs/basic-usage)
- The twoFactor plugin supports OTP/TOTP. Users who signed up passwordless (OAuth/passkey/magic link) cannot enable 2FA unless `allowPasswordless: true`. — [Better Auth: 2FA plugin](https://better-auth.com/docs/plugins/2fa)
- The passkey plugin (`@better-auth/passkey`) requires `rpID` and `rpName`. — [npm: @better-auth/passkey](https://www.npmjs.com/package/@better-auth/passkey)

### Inferences
- Registration lockdown default:
  - The first user becomes the owner/admin through a one-time setup token printed in the server logs or setup CLI.
  - After that, `disableSignUp: true`. Additional household members are added by invite only.
- Rate limit storage: switch to `"database"` so limits survive restarts. Set the trusted proxy header to match Caddy (`X-Forwarded-For` from Caddy only).
- Make TOTP 2FA or passkeys strongly encouraged (nag) for the owner. Consider making them mandatory for any instance with more than one user.
- For the mobile app, passkey `rpID` must match the public domain. Self-hosters on IP-only or LAN hostnames can't use passkeys reliably, so keep password + TOTP as the fallback.
- Encryption at rest: document "enable full-disk encryption on the host" as a self-hoster responsibility, and keep backups encrypted (§2). If attachments are added, an app-level envelope key for files is an option, but key management falls back on the self-hoster.

### Gaps
- I found no primary source this session that weighs column-level against disk-level encryption specifically for Postgres (pgcrypto docs and the OWASP Cryptographic Storage Cheat Sheet would be the right citations). This section's reasoning is inference.
- The Better Auth docs did not confirm lockout-after-N-failures or "have I been pwned" plugin behavior. Check the plugin list.

## 5. Data-subject rights and the obligations of self-hosters vs the project

### Takeaway
- A person self-hosting for themselves and their household likely falls under GDPR's household exemption. The **project**, as an open-source software supplier that processes no data, is generally not a controller or processor for self-hosted instances.
- Recital 18 does pull in "controllers or processors which provide the means". That bites if the project runs a hosted service, a sync/relay or a telemetry endpoint **[COUNSEL]**.
- Once a self-hoster serves people outside the household (friends, clients, a practice), they plausibly become a controller processing Art. 9 health data, with one-month response duties for access, erasure and portability **[COUNSEL]**.
- HIPAA generally does not reach individual-chosen apps that are neither covered entities nor business associates.
- The FTC Health Breach Notification Rule (HBNR) targets *vendors* of personal health records. Whether a non-commercial open-source project is a "vendor" is unclear **[COUNSEL]**, but a commercial hosted offering would likely be in scope.

### Cited Findings
- Recital 18: GDPR "does not apply to the processing of personal data by a natural person in the course of a purely personal or household activity and thus with no connection to a professional or commercial activity". But it "applies to controllers or processors which provide the means for processing personal data for such personal or household activities." — [GDPR Recital 18 (gdpr-info.eu mirror)](https://gdpr-info.eu/recitals/no-18/)
- Art. 12(3): the controller must act on requests under Arts. 15–22 "without undue delay and in any event within one month of receipt of the request". Art. 12(5) makes this free of charge. — [GDPR Art. 12 (gdpr-info.eu mirror)](https://gdpr-info.eu/art-12-gdpr/)
- Art. 20(1): data must be provided "in a structured, commonly used and machine-readable format", where processing is based on consent or contract and carried out by automated means. 20(2) allows direct controller-to-controller transmission where technically feasible. 20(3) says portability is without prejudice to Art. 17. 20(4) says it must not adversely affect the rights and freedoms of others. — [GDPR Art. 20 (gdpr-info.eu mirror)](https://gdpr-info.eu/art-20-gdpr/)
- ICO on erasure and backups: for a valid erasure request "you will have to take steps to ensure erasure from backup systems as well as live systems". If immediate deletion isn't possible, the data must be put "beyond use", meaning the backup is "simply held on your systems until it is replaced in line with an established schedule" and not used for any other purpose. Respond within one month. — [ICO: Right to erasure](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/)
- HHS: an app chosen by the individual that does not create, receive, maintain or transmit ePHI on behalf of a covered entity is not a business associate. Once data reaches such an app "the information is no longer subject to the protections of the HIPAA Rules". The covered entity has no HIPAA liability for a later breach by that app. — [HHS FAQ 3013](https://www.hhs.gov/hipaa/for-professionals/faq/3013/does-hipaa-require-a-covered-entity-to-enter-into-a-business-associate-agreement.html); [HHS FAQ: covered entity liability](https://www.hhs.gov/hipaa/for-professionals/faq/does-a-hipaa-covered-entity-bear-liability.html) (via search-result summaries; the main HHS guidance page returned 403)
- FTC HBNR covers:
  - vendors of PHRs, i.e. records that "draw information from multiple sources and that is managed, shared, and controlled by or primarily for the individual";
  - PHR related entities;
  - third-party service providers.

  It does not apply to entities acting solely as HIPAA business associates. — [FTC: Complying with the HBNR](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0)
- 2024 amendments (July 2024) made clear that health apps and connected-device makers are covered, and that a breach "is not limited to cybersecurity intrusions": unauthorized disclosure without consent counts. Requirements:
  - notify within 60 calendar days of discovery;
  - for 500+ affected individuals, notify the FTC at the same time as consumers, and notify media if 500+ residents of one state are affected;
  - civil penalties up to $53,088 per violation.

  The FTC page does not address open-source or self-hosted software. — [FTC: Complying with the HBNR](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0)

### Inferences
- openhealth combines labs, wearables, manual entries and similar sources, so it squarely matches the FTC's "draws from multiple sources" PHR definition. Any **commercial** hosted openhealth, or a paid sync service, should assume HBNR applies **[COUNSEL]**.
- Responsibility split to document (proposed):
  - **Project:** ships privacy-protective defaults (no telemetry by default, or opt-in and PHI-free), working export and delete features, a backup/restore toolkit, a security policy and a vulnerability disclosure process.
  - **Self-hoster:** host security, disk encryption, backup key custody, TLS/DNS, legal basis and DSR handling if they serve others, and breach notification in their jurisdiction.
- Health data is Art. 9 special-category data, so a non-household operator also needs an Art. 9(2) condition, typically explicit consent **[COUNSEL]**. The Art. 9 text was not fetched this session.
- Product features that make self-hosters compliant "for free":
  - per-user export (Art. 15/20);
  - per-user hard delete that cascades across all tables and files (Art. 17);
  - a backup retention setting with a documented maximum age, so erased data ages out of backups "beyond use" per ICO;
  - an audit log of DSR actions.

### Gaps
- EUR-Lex fetches failed (the page returned empty to the fetch tool), so GDPR text is cited from the gdpr-info.eu mirror. The report writer may want to link EUR-Lex: https://eur-lex.europa.eu/eli/reg/2016/679/oj.
- Not verified this session (background knowledge only):
  - Art. 12(3)'s extension "by two further months where necessary";
  - Art. 2(2)(c) wording;
  - Art. 32(1)(a)/(d) (encryption; "regularly testing, assessing and evaluating");
  - CJEU case law narrowing the household exemption: *Lindqvist* C-101/01 (publishing on the internet is not household) and *Ryneš* C-212/13 (CCTV covering public space is not "purely" household).

  These are relevant to "when does a self-hoster serving others stop being exempt" **[COUNSEL]**.
- I did not fetch EDPB guidance on the household exemption or on whether software suppliers are controllers. The EDPB Guidelines 07/2020 on controller/processor concepts would be the primary source.
- FTC applicability to non-commercial open-source maintainers is unaddressed in FTC guidance. It needs counsel.
- Erasure from backups under EU GDPR proper (as opposed to the UK ICO) was not checked against EDPB guidance.

## 6. Export formats for portability (JSON/CSV, FHIR R4) and deletion including backups

### Takeaway
A versioned JSON export (full fidelity, round-trippable into openhealth) plus CSV per data type (human/spreadsheet friendly) meets the Art. 20 "structured, commonly used and machine-readable" bar. FHIR R4 Bundles are feasible as an optional interoperability export using existing TypeScript types (`@medplum/fhirtypes`), but mapping custom domains (supplements, workouts) to FHIR resources is lossy. For deletion, do hard deletes in the live DB and files, then let backups expire by retention while holding them "beyond use".

### Cited Findings
- GDPR Art. 20(1) format requirement: "structured, commonly used and machine-readable". — [GDPR Art. 20](https://gdpr-info.eu/art-20-gdpr/)
- `@medplum/fhirtypes` provides TypeScript definitions for all FHIR R4 types (Patient, Observation, DiagnosticReport, Bundle). Medplum also implements FHIR bulk data export. — [Medplum: Working with FHIR data](https://www.medplum.com/docs/fhir-datastore/working-with-fhir); [Medplum CLI](https://www.medplum.com/docs/cli)
- Alternative TypeScript FHIR type packages exist (e.g. `@ahryman40k/typescript-fhir-types`). — [GitHub: typescript-fhir-types](https://github.com/Ahryman40k/typescript-fhir-types)
- ICO: erasure extends to backups, but "beyond use" plus scheduled overwrite is acceptable. — [ICO: Right to erasure](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/)
- Paperless-ngx-style and Immich-style precedents: the app-level exporter or dump is the portable artifact, and raw data dirs are not. — [Immich: Backup and Restore](https://docs.immich.app/administration/backup-and-restore/)

### Inferences
- Export package proposal:
  - a ZIP containing `manifest.json` (export schema version, app version, generated-at, checksums), `data/*.json`, `csv/*.csv` and `files/`;
  - optional `fhir/bundle.json` (a `collection` Bundle containing Patient, Observation for labs/vitals/body composition, MedicationStatement, and Procedure/Observation for workouts);
  - optional age/passphrase encryption of the ZIP, because exports are PHI leaving the controlled environment.
- Map labs to Observation with LOINC codes only where the source provides them. Do not invent codes; preserve the original names and units. Flag FHIR export as "interoperability, not lossless backup".
- Erasure design:
  - The per-user delete cascades through DB rows and attachment files and also purges derived artifacts (cached reports, AI summaries, export ZIPs).
  - The admin UI shows "this data will remain in backups until <oldest backup expiry date>".
  - Provide a tool to rebuild backups excluding the user, for self-hosters who need faster removal.
  - Never restore an erased user from backup: keep an erasure tombstone list (IDs only) that is re-applied after any restore.

### Gaps
- I did not verify FHIR R4 resource choices against HL7 spec pages (hl7.org/fhir/R4). The mapping above is a design inference.
- I did not find an EDPB statement on backups and erasure equivalent to the ICO's. The "beyond use" concept is ICO/UK-GDPR guidance and may be treated differently by EU authorities **[COUNSEL]**.
- I found no evidence on how Health Connect/HealthKit-sourced data should be exported. Check platform terms; Apple/Google developer policies may constrain re-export.
