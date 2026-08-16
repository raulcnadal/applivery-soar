# mTLS Agent Authentication — Roadmap

**Status:** proposed, not started. This is a planning document only — no code in this roadmap has been written yet. Written after a research pass over the existing auth model (see §1) and four scoping decisions confirmed with the user (see §0).

**Goal:** replace today's per-workspace shared secret (`X-Device-Report-Secret`) with per-device mutual TLS: every agent gets its own client certificate, generated and privately held on-device, issued by a SOAR-operated CA after a one-time bootstrap-token handshake, and renewed autonomously before expiry — with no bespoke script and no bootstrap token ever needed again after first enrollment.

---

## 0. Decisions already confirmed with the user

1. **CA custody** — SOAR generates and holds the CA by default (self-signed root, private key generated in-process, encrypted at rest). An admin can *also* upload an externally-generated CA (cert + private key) to replace it — this is the rotation/override path, not the primary one.
2. **Reverse proxy's role** — the reverse proxy in front of the backend (NPM today, but the design must not assume NPM specifically — see the note below) terminates the mTLS handshake and forwards the verified client identity to the backend via headers over the internal network. The backend trusts and validates those headers rather than re-terminating TLS itself.
3. **Rollout mode** — hard cutover, not permanent dual-auth. Once the backend requires the mTLS identity header on a route, the old shared secret stops being accepted on that route — no toggle to keep both alive indefinitely. (§7 below spells out the actual multi-step rollout runbook this implies operationally, since "hard cutover" in the code is still a staged rollout in practice — Phase A ships without breaking anything, Phase C is the deliberate cutover moment.)
4. **Agent scope this round** — Windows Agent first, end to end. macOS Agent (confirmed live in production, not a stub) gets the exact same client logic ported as an immediate fast-follow round once Windows is proven.

**Reverse-proxy portability note (added after review):** NPM is the proxy in use today, but nothing in the backend design should be NPM-specific — the user runs NPM now but wants the freedom to swap in any other reverse proxy that can terminate mTLS and forward verified identity via headers (Traefik, Caddy, HAProxy, a raw nginx config, Envoy, etc. all support this pattern). Concretely this means: the header names the backend reads must be configurable, not hardcoded; the docs below give the exact config for nginx-family proxies (NPM's underlying engine) as the primary example, with a note on the equivalent for the most common alternatives; and nothing in the backend or agent code encodes an NPM-specific assumption. Everywhere "NPM" appears below as a concrete example, read it as "your reverse proxy" — the mechanism, not the product, is what this design depends on.

---

## 1. What this replaces (current state, confirmed against the codebase)

- `verifyDeviceReportSecret` (`deviceData.service.ts`) — one secret **per workspace**, shared by every device in that workspace's fleet, checked via constant-time compare against `X-Device-Report-Secret`. Provisioned/rotated today via `deviceReportSecret.service.ts` + `GET/POST/DELETE /api/settings/device-report-secret`. Gates 6 routes in `deviceData.controller.ts` (`report`, `report-apps`, `custom-checks`, `evaluate-now`, `agent-status`, `event-watches`, `event-notify`).
- This is a real security gap this roadmap closes: **one leaked secret compromises every device in the workspace**, and there's no per-device revocation — you can only rotate the whole workspace's secret and re-push it everywhere.
- `secretCipher.ts` (AES-256-GCM, key derived from `DASHBOARD_SECRET`) is the existing at-rest encryption utility, already used for `AutomationCredential`'s tokens — reused here for the CA private key, consistent with everything else this app encrypts at rest.
- No existing PKI/certificate code anywhere in the backend (confirmed by grep) — this is a greenfield build on the backend side. No existing Windows Certificate Store / keystore interaction in the Windows Agent either (confirmed by grep) — the agent-side keystore is also greenfield.
- The edge reverse proxy (NPM today) is **not** version-controlled in this repo — `docker-compose.yml` runs the frontend's Nginx as a plain-HTTP reverse proxy to the backend over the internal Compose network; TLS termination (today: server-only; after this roadmap: mutual) happens entirely at the edge proxy, outside anything this repo can configure directly. This roadmap's backend code assumes the edge proxy forwards a verified-identity header, and treats "the backend's Docker network port is only reachable through the trusted proxy chain" as a hard precondition — see §5.4. The backend has no dependency on which proxy product does this; only the header contract matters, and that contract is configurable (§5).

---

## 2. Data model

Three new Prisma models. Device identity is anchored on **`serialNumber`**, not a new "Device ID" concept — every other agent-facing route in this codebase already keys devices by `serialNumber` (matches Applivery's own device inventory), so the certificate's Common Name is the device's serial number, full stop. No new identifier scheme.

```prisma
model CertificateAuthority {
  workspaceSlug String   @id
  certPem       String   @db.Text   // CA public certificate, PEM — safe to expose to admins/agents
  privateKeyPem String   @db.Text   // encrypted at rest via secretCipher (existing AES-256-GCM utility)
  keyAlgorithm  String   // "ECDSA-P256" — matches the leaf certificate algorithm (see §3)
  source        String   // "generated" | "uploaded"
  serialCounter Int      @default(1)   // next leaf-cert serial to issue, monotonically increasing
  leafValidityDays Int   @default(90)  // configurable leaf-cert lifecycle; enforced minimum 47
                                        // days at the service layer (see §3) — future-proofing
                                        // against shorter industry-standard lifetimes
  notBefore     DateTime
  notAfter      DateTime
  uploadedBy    String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model DeviceBootstrapToken {
  id            String    @id @default(uuid())
  workspaceSlug String
  serialNumber  String    // which device this token is bound to — a token minted for one
                          // serial can never be used to enroll a different one, see §4.1
  tokenHash     String    // SHA-256 of the actual token; the plaintext token is shown to
                          // the admin exactly once at creation and never stored
  expiresAt     DateTime  // short-lived — default 7 days, admin-configurable per token
  usedAt        DateTime? // null until consumed; one-shot, see §4.1
  createdBy     String?
  createdAt     DateTime  @default(now())

  @@unique([workspaceSlug, tokenHash])
  @@index([workspaceSlug, serialNumber])
}

model DeviceCertificate {
  id            String    @id @default(uuid())
  workspaceSlug String
  serialNumber  String
  serialHex     String    // the certificate's own X.509 serial number (hex) — distinct from
                          // DeviceCertificate.id, this is what a CRL/revocation check keys on
  certPem       String    @db.Text  // issued certificate, public only — the private key never
                                    // leaves the device, SOAR never sees or stores it
  notBefore     DateTime
  notAfter      DateTime
  supersededAt  DateTime? // set when a renewal issues a newer cert for the same serialNumber
  revokedAt     DateTime?
  revokedReason String?
  issuedAt      DateTime  @default(now())

  @@unique([workspaceSlug, serialHex])
  @@index([workspaceSlug, serialNumber])
}
```

Migration will be hand-authored SQL, same established workaround as every other schema change this session (no `binaries.prisma.sh` network route in the dev sandbox).

---

## 3. Certificate mechanics

- **Key algorithm: ECDSA P-256** (per the user's own spec) for both the CA and every leaf certificate — smaller keys/certs than RSA-2048 at an equivalent security level, native support in Go's `crypto/ecdsa` + `crypto/x509` (stdlib, **zero new Go dependency** — unlike the ETW work, this needs nothing beyond what Go already ships).
- **CA**: self-signed, `CN=Applivery SOAR CA (<workspaceSlug>)`, generated with a long validity (e.g. 10 years) since rotating it is a fleet-wide event. Generation happens in the Node backend using `node:crypto`'s `generateKeyPairSync("ec", { namedCurve: "P-256" })` plus a small X.509-building layer — Node's built-in `crypto` can generate the keypair natively but does **not** build X.509 structures on its own; this needs either `node-forge` (pure JS, no native deps, well-established, MIT-licensed) or `@peculiar/x509` (built on WebCrypto, more modern/typed). Recommendation: `@peculiar/x509` — actively maintained, TypeScript-native, uses the platform's real WebCrypto (Node 20+ has `crypto.webcrypto` built in) rather than its own crypto implementation, which is a meaningfully better security posture for something signing every device's identity in the fleet. Flagged as a decision point, not assumed — see §8.
- **Leaf certs**: `CN=<serialNumber>`, short validity, **default 90 days, admin-configurable via `CertificateAuthority.leafValidityDays`**, renewed at the 30-day-remaining mark per the user's own spec. The service layer enforces a **hard floor of 47 days** on this setting — the admin API rejects any value below it — as future-proofing against the industry's ongoing push toward shorter TLS certificate lifetimes (the CA/Browser Forum has been trending public TLS certs toward ~47 days over the next few years; picking the same floor here keeps this system consistent with where the ecosystem is heading even though these are private, not publicly-trusted, certificates). Renewal timing (today: "30 days remaining") should scale proportionally for short configured lifetimes rather than stay a fixed 30 days — e.g. renew at 1/3 of `leafValidityDays` remaining, so a 47-day cert renews around the 16-day mark instead of waiting past its own lifetime.
- **CSR validation on issuance is strict**: the backend **always issues with `CN` set to the bootstrap token's own bound `serialNumber`**, never trusting whatever CN the agent's CSR claims. A token minted for device A can never be used to mint a cert claiming to be device B, even if the CSR body says otherwise — this is the actual security boundary of the whole system, not a nice-to-have.

---

## 4. New endpoints

### 4.1 Agent-facing (device-caller, no dashboard token — same class as today's `/api/device-data/*`)

- **`POST /api/device-mtls/register`** — body `{csrPem, serialNumber}`, header `X-Bootstrap-Token: <token>` (matching this repo's existing `X-` header convention, not a bearer scheme). No client cert on this call — can't be, the device doesn't have one yet. Validates: token exists for this workspace, `tokenHash` matches, unexpired, unused, and its bound `serialNumber` matches the request body. Consumes the token (`usedAt = now`, checked-and-set in one transaction so a replayed request can never double-issue). Signs the CSR (CN forced to the token's `serialNumber`, ignoring the CSR's own claimed CN if different), records a `DeviceCertificate` row, returns `{certPem, caCertPem}`. The agent needs `caCertPem` too, so it can verify SOAR's own server certificate going forward if it isn't already trust-anchored via the CA cert the user is separately deploying through Applivery UEM.
- **`POST /api/device-mtls/renew`** — body `{csrPem, serialNumber}`. This call **must arrive already mTLS-authenticated** — gated by the same `verifyMtlsIdentity` middleware (§5) protecting the report routes, using the device's *current, still-valid* certificate. Validates the identity header's CN matches `serialNumber` in the body, issues a fresh cert (new serial, new key — the agent generates a new keypair per the user's own spec, this isn't a cert-only renewal), marks the old `DeviceCertificate` row `supersededAt`, returns the new cert. No bootstrap token ever needed again — this is the self-sustaining loop from the user's spec.

### 4.2 Admin-facing (Settings, dashboard token + RBAC — new `canManageMtlsCA` risky-action flag under the existing `settings` area, mirroring `canExportOrImportConfig`'s pattern given how consequential replacing the fleet's trust root is)

- `GET /api/mtls/ca` — status only (exists? generated vs. uploaded, fingerprint, expiry) — **never** returns the private key, not even to an admin.
- `POST /api/mtls/ca/generate` — generates a new self-signed CA. Refuses to silently overwrite an existing one (must pass an explicit `confirmReplace: true` once a CA already exists, since replacing it invalidates every currently-issued leaf cert's chain of trust).
- `POST /api/mtls/ca/upload` — body `{certPem, privateKeyPem}` — validates the pair actually matches (signs and verifies a throwaway challenge) before accepting, same `confirmReplace` guard as generate.
- `POST /api/mtls/bootstrap-tokens` — body `{serialNumber, expiresInDays?}` — mints one token, returns the **plaintext token exactly once** in the response (never retrievable again, matching how e.g. API keys are typically surfaced). Supports a `POST /api/mtls/bootstrap-tokens/bulk` variant (array of serials) for enrolling a fleet at once.
- `GET /api/mtls/bootstrap-tokens` — list, `tokenHash`/plaintext never included, just status (pending/used/expired).
- `DELETE /api/mtls/bootstrap-tokens/:id` — revoke an unused token.
- `GET /api/mtls/certificates` — list issued certs with status (active/expiring-soon/expired/revoked) — this is the fleet-migration dashboard the admin uses to know when it's safe to flip the cutover in §7.
- `POST /api/mtls/certificates/:id/revoke` — body `{reason}` — for a decommissioned or suspected-compromised device. Checked by `verifyMtlsIdentity` on every request (§5) — a revoked cert stops authenticating immediately, no waiting for expiry.

---

## 5. `verifyMtlsIdentity` middleware

Confirmed decisions folded in: the header contract is a **configuration surface, not a hardcoded constant** — this is what makes the design portable across reverse proxies — and the internal-proxy-secret defense-in-depth layer (originally proposed as optional) is now **in scope for this round**, not deferred.

1. Reads two headers from env-configured names (`MTLS_HEADER_CERT_VERIFIED` / `MTLS_HEADER_CERT_CN`, defaulting to `X-Client-Cert-Verified` / `X-Client-Cert-CN` — the user's confirmed choice, matching what NPM's underlying nginx engine calls `$ssl_client_verify` / `$ssl_client_s_dn_cn`). Because these are env vars rather than literals in code, swapping to a different reverse proxy that names its forwarded headers differently — or renaming them for any other reason — is a config change, not a code change.
2. Reads a third header, also env-configured (`MTLS_HEADER_PROXY_SECRET`, default `X-Internal-Proxy-Secret`), and rejects (401) unless it exactly matches a new `MTLS_INTERNAL_PROXY_SECRET` env var. This closes the gap where an attacker reaching the backend's port directly could simply set `X-Client-Cert-Verified: SUCCESS` themselves — the header alone is never sufficient, the shared secret must also be present, and only the reverse proxy is configured to know it. This check runs *before* the CN lookup, so a request missing/wrong on the secret never even reaches step 3.
3. Rejects (401) if the verified header isn't exactly `SUCCESS`, or the CN header is missing/empty.
4. Looks up `DeviceCertificate` by `(workspaceSlug, serialNumber=CN)` where `revokedAt IS NULL` and `notAfter > now()` — rejects if none matches (covers revocation and "the proxy verified the chain but the specific cert was revoked after issuance, which the proxy's own CRL checking may not catch depending on how it's configured").
5. Attaches the verified `serialNumber` to the request for downstream handlers.

### 5.4 Hard precondition: the backend's port must not be reachable except through the trusted reverse proxy

The entire trust model in §5 depends on the backend only ever seeing these headers when they genuinely came from the reverse proxy's own TLS termination — if an attacker could reach the backend's Docker/host port directly, they could otherwise impersonate any device. Two layers, both now in scope:

1. **Network-level**: confirm (this is an infra check for the user, not something this repo enforces) that the backend's container port is only bound to the Docker-internal network, never published to the host directly — only the reverse proxy should be able to reach it.
2. **Defense in depth, confirmed in scope for this round**: the reverse proxy also forwards a static shared secret only it knows (`X-Internal-Proxy-Secret` by default, configurable per above), and `verifyMtlsIdentity` rejects any request missing or mismatching it (step 2 above) — so even a network-level misconfiguration doesn't silently downgrade to "trust anyone who sets a header." This is one new env var (`MTLS_INTERNAL_PROXY_SECRET`, a long random value generated once at Phase A setup) plus the one header check.

### 5.5 Reverse-proxy config reference

**Revised after a real production outage.** The original version of this section (still in git history) told the user to add `ssl_verify_client`/`ssl_client_certificate` plus a `location /api/device-` block to their *existing* dashboard proxy host. Doing exactly that took the dashboard offline — browsers could no longer reach it at all. Root cause, confirmed against nginx's own bug tracker and Nginx Proxy Manager's own issue tracker, not guessed:

- `ssl_verify_client` / `ssl_client_certificate` are **TLS-handshake directives**. Nginx has never supported scoping them to a `location` block — they only take effect at `http`/`server` scope. Two feature requests asking for per-location client-cert verification have sat open on nginx's tracker since 2013/2015: [trac #400](https://trac.nginx.org/nginx/ticket/400), [trac #498](https://trac.nginx.org/nginx/ticket/498).
- The client-certificate negotiation happens **during the TLS handshake**, before nginx has parsed the HTTP request line — so there is no path-based information available yet to scope by. A `location /api/device-` block only ever controlled where the *header-forwarding to the backend* happened; it never controlled the "ask the client for a certificate" step, which nginx applies to every single connection reaching that server block, dashboard included.
- Nginx Proxy Manager has a known issue tracking exactly this failure mode: enabling `ssl_verify_client` on a proxy host's Advanced tab is reported to take the whole proxy host offline with SSL handshake failures ([jc21/nginx-proxy-manager#175](https://github.com/jc21/nginx-proxy-manager/issues/175)).

**The only correct fix: a separate subdomain/vhost dedicated to agent traffic**, so the dashboard domain never carries any client-cert directive. Two proxy hosts, not one:

| Proxy host | Domain | Client-cert directives |
|---|---|---|
| Existing (unchanged) | `soar.example.com` | None, ever |
| New | `agents.soar.example.com` (your own choice) | `ssl_verify_client`, `ssl_client_certificate` |

Both point at the same backend/forward target — this isn't a new deployment, just a second NPM Proxy Host (or equivalent) for the same service, with its own hostname. Since browsers never visit the agents subdomain, the client-cert negotiation happening on every connection there is by design, not a problem.

```nginx
# A NEW, SEPARATE Nginx Proxy Manager proxy host — Domain: agents.soar.example.com
# Do NOT add any of this to the existing dashboard proxy host.
#
# Details tab: Forward Hostname/Port — same target as the existing SOAR proxy host.
#
# Advanced tab:
ssl_verify_client optional;   # "optional" not "on" — registration has no cert yet, and
                               # reporting is only cert-gated once Enforcement is on; the
                               # backend decides per request whether one is actually required.
ssl_client_certificate /path/to/soar-ca.pem;   # download from Settings > mTLS Agent
                                                # Authentication > Certificate Authority >
                                                # Download CA certificate (also GET /api/mtls/ca)

location /api/ {
    proxy_pass http://<same forward target as the existing SOAR proxy host>;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Client-Cert-Verified $ssl_client_verify;
    proxy_set_header X-Client-Cert-CN       $ssl_client_s_dn;
    proxy_set_header X-Internal-Proxy-Secret "<the MTLS_INTERNAL_PROXY_SECRET value>";
}
```

`location /api/` (not `/`) is deliberate: NPM auto-generates its own `location /` from the Details tab, and nginx rejects a duplicate `location /` in the same server block at config-reload time. `/api/` is a proven-safe, non-colliding prefix — it's the exact pattern `frontend/nginx.conf` already uses in this repo, coexisting with its own `location /` for the SPA, so it's not a new, untested claim.

**This means every agent's `BaseURL` changes.** The Windows Agent's `BaseURL` config value is used exclusively for device-data and device-mtls calls (report, report-apps, custom-checks, evaluate-now, agent-status, event-watches, event-notify, register, renew) — confirmed by grep, nothing else in the client touches it — so pointing it at the new agents subdomain instead of the dashboard's own origin is a clean, no-code-change swap. The **Agent subdomain** field on this panel (persisted via `GET/PUT /api/mtls/agent-subdomain`, `agentSubdomain.service.ts`, `WorkspaceState.agentSubdomain`) is the single source of truth — Settings > Device Data Webhook's Managed Configuration bundle reads it back **read-only** to build its Agent Base URL, so there is exactly one place an admin ever types this value, and every downloaded config always matches it.

**`RegisterURL` — splitting registration off `BaseURL` (found necessary during real rollout, not designed in advance).** A pilot deployment hit exactly the failure mode this predicts: the agents subdomain's reverse-proxy TLS/cert setup had a transient issue, and because the original single-`BaseURL` design routed *everything* — including one-time registration — through that subdomain, a brand-new device couldn't enroll at all despite `/register` never touching client-cert machinery in the first place (`verifyMtlsIdentity` is never applied to it, §4.1/§10). The fix: `Config.RegisterURL` (Windows Agent), an optional override consulted ONLY by `registerMtlsIdentity` — falls back to `BaseURL` when unset (the original, still fully supported, single-URL behavior). `/renew` deliberately keeps using `BaseURL` unconditionally, never `RegisterURL`, since renewal genuinely does require the client-cert-verifying vhost (`verifyMtlsIdentity` gates it unconditionally too). Settings > Device Data Webhook's Managed Configuration bundle sets `RegisterURL` to this dashboard's own origin automatically, but ONLY once an agent subdomain is actually configured (i.e., only when there's a real split to make) — decoupling first-time enrollment from whichever subset of the deployment (the dedicated mTLS vhost) happens to be the least battle-tested part of the whole rollout.

**`ssl_client_certificate` path pitfall on NPM (a stacked, two-cause incident).** After the dedicated-subdomain fix above and the `RegisterURL` split, a pilot device still hit `tls: unrecognized name` against the agents subdomain — reproduced independently with `curl -vI` from an unrelated machine, so it wasn't Windows- or network-specific. The first cause: the proxy host's Advanced config referenced `ssl_client_certificate /app/soar-ca.pem;`. `/app` is NPM's own application code directory inside its container, not a volume — the official `docker-compose.yml` only persists `./data:/data` and `./letsencrypt:/etc/letsencrypt` (confirmed against NPM's own quick-setup docs). A file placed at `/app/...` can be unreadable to nginx, or simply gone after the container is recreated, even though the proxy host shows "enabled"/green — that flag only reflects Let's Encrypt issuance, not whether every Advanced-tab directive resolved successfully. Moving the file into `/data` (confirmed readable by the `npm` user nginx actually runs as) fixed the file-access half of the problem. Worth noting for context: NPM does not yet ship first-class client-certificate support in any released version — [issue #768](https://github.com/NginxProxyManager/nginx-proxy-manager/issues/768) (opened 2020) requesting exactly that is still open, with two draft PRs (#2956, #5563) unmerged — so hand-editing `ssl_verify_client`/`ssl_client_certificate` via the Advanced tab remains the only available method on NPM today.

**Second, distinct cause found underneath the first: `$ssl_client_s_dn_cn` is not a real nginx variable.** Open-source nginx exposes `$ssl_client_s_dn` — the full RFC 2253 subject DN string, e.g. `CN=<serial>` — but has no built-in "just the CN" variable (confirmed against nginx's own `ngx_http_ssl_module` variable list). This repo's proxy-config reference had referenced the nonexistent `$ssl_client_s_dn_cn` since the very first draft of this section. On NPM specifically, referencing an unresolvable nginx variable in the Advanced tab doesn't surface an error anywhere visible — not in the UI, not in the container's own log (which only ever prints `Reloading Nginx` with no failure detail) — the config file for that proxy host simply isn't rewritten, while the UI still reports "saved." This produced a confusing, hard-to-separate compound symptom: the TLS-layer `unrecognized name` failure (cause #1, the `/app` path) and a completely silent config-save failure (cause #2, the fake variable) were both present at different points, and removing either the SSL directives or the CN header line in isolation could appear to "fix" things depending on which stale config was left in place at the time. The fix: keep the header name (`X-Client-Cert-CN`, matching `MTLS_HEADER_CERT_CN`'s default — renaming the header itself just makes the backend stop seeing it at all, a third false lead this incident produced) but change its value to the real `$ssl_client_s_dn`, and parse the bare CN back out on the backend side. `mtlsIdentity.middleware.ts`'s `extractCommonName()` does this with a small regex (`/(?:^|,)\s*CN=([^,]+)/i`) before the `findActiveCertificate` lookup, which expects a bare CN (the device's plain serial number) — so this works whether a given reverse-proxy config forwards a bare CN (older deployments, or a non-nginx proxy that already extracts it) or the full DN string.

**Location-block scoping, made explicit:** three categories, three different needs. (1) **Agent registration** (`POST /api/device-mtls/register`) never requires a client cert — the bootstrap token is the credential, and `verifyMtlsIdentity` is never applied to this route (see §4.1/§10) — but it's still inside the `/api/` block above, which is harmless since the route never reads the forwarded cert headers anyway. Renewal (`POST /api/device-mtls/renew`) is the opposite: it's *always* gated by `verifyMtlsIdentity`, cert required unconditionally, same location block. (2) **Device reporting** (`POST/GET /api/device-data/*` — report, report-apps, custom-checks, evaluate-now, agent-status, event-watches, event-notify) is cert-gated only once Enforcement is switched on for that workspace; before that it accepts the legacy `X-Device-Report-Secret` instead. Both prefixes live under `/api/` on the agents subdomain, so one location block covers both. (3) **Frontend and all other dashboard/admin routes** (`/`, `/api/mtls/*` admin, everything else) live entirely on the *other* domain — the one with zero client-cert directives — so there's nothing to scope away from at all.

For a non-nginx-family proxy, the same three values are needed on the dedicated agents vhost: (1) trust the SOAR-issued CA cert for client verification, (2) forward the verification result and the client cert's CN as headers, (3) inject the shared secret. Traefik does this via `passTLSClientCert` middleware (has direct equivalents to `$ssl_client_verify`/CN extraction); Caddy via `tls.client_auth` plus `header_up` directives; HAProxy via `ssl_c_verify`/`ssl_c_s_dn` fetches converted to headers in the backend section. None of these require backend code changes — only the header *names* need to line up with `MTLS_HEADER_CERT_VERIFIED`/`MTLS_HEADER_CERT_CN` env vars, which default to the nginx/NPM names but can be repointed. The separate-vhost requirement is not nginx-specific — it follows from TLS itself (SNI-based client-cert policy is per-listener/per-vhost in every mainstream proxy), so it applies the same way regardless of proxy choice.

---

## 6. Windows Agent client (this round)

New file, e.g. `mtls_windows.go`, plus a new `Config.BootstrapToken` field read from `HKLM\SOFTWARE\Policies\Applivery\SOAR` (same Managed Configuration delivery mechanism `ReportSecret` already uses today, per the user's own spec — Applivery UEM pushes this alongside the existing config).

- **Local keystore (v1, disclosed simplification)**: not the Windows Certificate Store (CNG) — that's a meaningfully bigger integration with no existing groundwork in this repo (confirmed zero `CertOpenStore`/keystore code exists). v1 stores `device-cert.pem` and `device-key.pem` under `%ProgramData%\Applivery\SOAR\mtls\`, with the private key file's ACL locked to `SYSTEM`/`Administrators` only (the agent already runs as LocalSystem, same as every other privileged operation it does today). Genuine CNG/Certificate Store integration is flagged as a §8 hardening item, not assumed here — worth being explicit that this is a gap versus a from-scratch "OS keystore," not silently substituted without saying so.
- **Registration**: on startup, if no local cert exists (or it's expired/revoked — a 401 from a report call is also a trigger to re-check), generate an ECDSA P-256 keypair (`crypto/ecdsa`, `crypto/x509` — Go stdlib, no new dependency), build a CSR with `x509.CreateCertificateRequest`, POST to `/api/device-mtls/register` with the bootstrap token, save the returned cert + CA cert.
- **Renewal**: a daily check (own lightweight ticker, or folded into the existing report cycle's daily-ish cadence) — when `notAfter` is within 30 days, generate a fresh keypair + CSR, POST to `/api/device-mtls/renew` using an mTLS-configured `http.Client` (`tls.Config{Certificates: []tls.Certificate{current}}` — native `net/http` support, no library needed), atomically swap the cert/key files on success.
- **Outbound calls once registered**: every existing `sendWebhook` call (report, report-apps, custom-checks, event-notify, event-watches, agent-status, evaluate-now) switches to the mTLS-configured client instead of sending `X-Device-Report-Secret` — consistent with the hard-cutover decision, no dual-auth code path to maintain on the agent side either.

---

## 7. Rollout runbook (what "hard cutover" actually looks like operationally)

Even with no dual-auth code path, deploying this safely is still a sequence, not a flag flip:

1. **Ship Phase A (backend)** — CA/bootstrap-token/certificate models, admin routes, `/register` + `/renew`, `verifyMtlsIdentity` middleware built and mounted but **not yet required** on `report`/`report-apps`/etc. — those routes keep accepting `X-Device-Report-Secret` exactly as today. Deploying this breaks nothing.
2. **Ship Phase B (Windows Agent)** — new agent build with registration/renewal logic. Devices don't yet have bootstrap tokens, so they keep running on the old build/old auth until upgraded.
3. **Admin generates a CA** (`POST /api/mtls/ca/generate`) and bulk-mints bootstrap tokens for the fleet, delivered via Applivery UEM's existing Managed Configuration push (same mechanism as `ReportSecret` today) alongside the new agent build.
4. **Fleet upgrades** — as each device gets the new agent build + its bootstrap token, it self-registers on first run. Admin watches `GET /api/mtls/certificates` fill up.
5. **Cutover moment** — once the admin confirms (via that same dashboard) that every active device has a valid certificate, they: (a) reconfigure the reverse proxy (per §5.5's config reference for whichever product is in front — NPM today) to require and verify client certs against the uploaded/generated CA cert on the agent-facing routes, and (b) the backend build for this phase requires `verifyMtlsIdentity` (instead of `verifyDeviceReportSecret`) on those routes. Any device still on the old build or without a valid cert goes dark at this point — an explicit, accepted consequence of the "hard cutover" decision, not a surprise.
6. **Phase D (macOS fast-follow)** ports the identical client logic to the macOS Agent so the whole fleet reaches parity quickly rather than leaving macOS on the retired auth model for an extended window.

---

## 8. Decisions — resolved

All four open items are now confirmed:

1. **X.509 library** — `@peculiar/x509`, confirmed. First new backend dependency for this feature.
2. **Leaf cert validity window** — default 90 days, renewed at 1/3-remaining. Admin-configurable via `CertificateAuthority.leafValidityDays`, with a **hard floor of 47 days** enforced server-side (§3) — future-proofing against shorter industry-standard TLS lifetimes.
3. **Reverse-proxy header names** — `X-Client-Cert-Verified` / `X-Client-Cert-CN`, confirmed as the *default* values, but implemented as env-configured (`MTLS_HEADER_CERT_VERIFIED`/`MTLS_HEADER_CERT_CN`) rather than hardcoded, so the design isn't coupled to NPM specifically (§5, §5.5) and swapping reverse proxies is a config change.
4. **Internal proxy secret** — in scope for this round, not deferred. New `MTLS_INTERNAL_PROXY_SECRET` env var + `X-Internal-Proxy-Secret` header (configurable name), checked before the CN lookup (§5.4).

No open decisions remain — ready for Phase A once you give the go-ahead.

---

## 9. Self-service enrollment (Phase E addendum, added post-launch)

**Why this exists:** Phase A/D shipped `DeviceBootstrapToken` — a one-time, per-device secret cryptographically bound to exactly one serial number at mint time, the strongest identity guarantee this design offers. In practice, though, minting the token was only half the problem: there was (and is) no way to deliver a *unique* value to *one specific device* through Applivery's own Managed Configuration. Its interpolation tags (`{{device.serialNumber}}` etc. — confirmed against docs.applivery.com's Dynamic Variables page) only expose Applivery's own built-in device/user fields, never a secret this backend mints. Without a separate per-device provisioning step (imaging, an installer script, an Autopilot-style JSON payload), an admin has no practical way to get 500 different bootstrap tokens onto 500 different devices. Phase D's fleet-picker UI (§below) solved "where do I find the serial numbers" but not "how do I deliver the token" — this addendum solves the second half.

**The trade:** a single, workspace-wide `EnrollmentSecret` — same value on every device, deployed once via one static Managed Configuration push (identical delivery mechanism to the legacy `ReportSecret`). Because this secret is shared rather than per-device, possessing it alone is **not** sufficient to get a certificate — the backend additionally requires the claimed serial number to be a device Applivery UEM *currently* reports as enrolled in this workspace (`getDevicesFull` via the workspace's Automation Credential). This is a genuinely weaker guarantee than `DeviceBootstrapToken`'s: a serial number is not a secret (printed on the device, often tracked in asset spreadsheets). Two things bound the exposure:

- **`mtlsSelfServiceMode` defaults to `"disabled"`** — this entire path is opt-in per workspace, exactly like the Phase C enforcement flag.
- **A serial number that already has an ACTIVE certificate can never be silently re-claimed.** `assertNotAlreadyActive` (`mtlsEnrollment.service.ts`) is checked before every issuance path, at both request time and (again, since time has passed) admin-approval time. The worst a leaked `EnrollmentSecret` can do is let someone claim a *not-yet-enrolled* device before its real owner does — it can never steal an already-enrolled device's identity.

Two modes, an admin-chosen default confirmed as **"approval required"** (not silent):

- **`"approval"`** (recommended default) — a request lands in `DeviceEnrollmentRequest` (status `pending`) and waits for an admin to click Approve/Reject in Settings > mTLS. Nothing is issued without a human in the loop.
- **`"silent"`** — issued immediately once the secret and the live-Applivery check both pass. True zero-touch, at the cost of the weaker per-device guarantee above being the *only* gate.

### Data model additions

```prisma
model EnrollmentSecret {
  workspaceSlug String   @id
  secret        String   // encrypted at rest (secretCipher) — same treatment as DeviceReportSecret/CA private key
  rotatedBy     String?
  updatedAt     DateTime @updatedAt
}

model DeviceEnrollmentRequest {
  id              String    @id @default(uuid())
  workspaceSlug   String
  serialNumber    String    // CN is always forced to this at issuance, never trusted from the CSR — same invariant as DeviceBootstrapToken
  platform        String?
  displayName     String?   // best-effort label from Applivery, for the approval queue's readability
  csrPem          String    @db.Text
  status          String    @default("pending") // "pending" | "approved" | "rejected"
  requestedAt     DateTime  @default(now())
  decidedBy       String?
  decidedAt       DateTime?
  rejectionReason String?

  @@unique([workspaceSlug, serialNumber, status]) // one PENDING row per device at a time; a fresh decision frees the key for re-enrollment
}
```

`WorkspaceState.mtlsSelfServiceMode` (`String @default("disabled")`) holds the mode, guarded the same way as Phase C's `mtlsEnforcementEnabled`: `setSelfServiceMode` refuses to enable either non-disabled mode without a CA *and* an `EnrollmentSecret` already configured.

### API surface

Agent-facing (no dashboard token, `X-Enrollment-Secret` header):

- `POST /api/device-mtls/enroll` — `{csrPem, serialNumber, platform?}`. Returns `200 {certPem, caCertPem, notAfter}` (silent mode) or `202 {requestId}` (approval mode, queued). 404 if the workspace's mode is `"disabled"`.
- `GET /api/device-mtls/enroll/status?serialNumber=...` — the agent's poll after a 202. Re-validates the secret on every single poll. Returns `{status: "issued", certPem, caCertPem, notAfter}` | `{status: "pending"}` | `{status: "rejected", reason}`.

Admin-facing (dashboard token + `settings:read`/`settings:manage` + `canManageMtlsCA` on mutations, same RBAC shape as the rest of `mtls.controller.ts`):

- `GET/POST/DELETE /api/mtls/enrollment-secret` — status / rotate / clear (mirrors `deviceReportSecret.service.ts`'s pattern exactly). Clearing force-resets the mode back to `"disabled"`.
- `GET/PUT /api/mtls/self-service-mode`.
- `GET /api/mtls/enrollment-requests` (optional `?status=` filter), `POST /api/mtls/enrollment-requests/:id/approve`, `POST /api/mtls/enrollment-requests/:id/reject` (`{reason}`).

### Windows Agent client

`Config.EnrollmentSecret` (new registry value, same `HKLM\SOFTWARE\Policies\Applivery\SOAR` key as everything else) is only consulted when `BootstrapToken` is empty — a device with both always prefers the per-device token. `ensureSelfServiceEnrollment` (`mtls_windows.go`) POSTs once, then on subsequent report cycles polls `/enroll/status` using the SAME keypair/CSR from the original request (so an admin's Approve click signs exactly what the agent asked for) until issued or rejected; a rejection clears local pending state so the next cycle submits a fresh request, matching the backend's "a new request after a decision is a fresh row" design.

### Admin UI

Settings > mTLS > **Self-Service Enrollment**: secret status/rotate/remove, a Managed Configuration snippet generator (same "download/copy a ready-to-deploy .ps1" pattern as Device Data Webhook and Bootstrap Tokens), a three-way mode selector with an explicit confirm dialog on switching to `"silent"` that repeats the trade-off in plain language, and (visible in approval mode) a pending-requests queue with Approve/Reject actions.

**⚠️ Superseded by §10 below.** Everything in this §9 — `DeviceBootstrapToken` (§2, §4), `EnrollmentSecret` + `mtlsSelfServiceMode` + the approval queue (`DeviceEnrollmentRequest`) — was removed and replaced by a single **Global Bootstrap Token** mechanism, always-immediate issuance, no approval step. Kept here only as the historical record of how the design evolved.

---

## 10. Global Bootstrap Token (supersedes §2's `DeviceBootstrapToken`, §4's bootstrap-token endpoints, and §9 in full)

**Why this changed again:** after Phase E shipped, real deployment against a single pilot Windows device surfaced two problems. First, a live bug: `Config.IsConfigured()` (Windows Agent) required `ReportSecret` to be set unconditionally, so a device configured for mTLS-only auth (bootstrap token set, report secret intentionally blank) silently never attempted registration at all — fixed by accepting either `ReportSecret` or `BootstrapToken`. Second, and more fundamentally, the user re-scoped the whole enrollment model: **one single enrollment method**, not three (`DeviceBootstrapToken` per-device tokens, `EnrollmentSecret` self-service with an approval queue, and the original shared-secret webhook auth). Since SOAR already knows every managed device's serial number in advance via Applivery UEM, the per-device token's "prove you're device X" guarantee is redundant — the live Applivery fleet check already proves that. And the approval queue added an operational step with no security benefit once that live check exists, so it was dropped too ("Drop it — always silent", confirmed with the user).

**The model:** one value, `GlobalBootstrapToken.secret` (workspace-wide, non-expiring, not per-device — structurally the old `EnrollmentSecret` table renamed, not recreated, so an already-configured value survives the migration). A device proves it's allowed to register with **two factors**, both required:

1. **Possession of the shared token** — timing-safe compare against `X-Bootstrap-Token`, the SAME header the original Phase A design already used (`verifyGlobalBootstrapToken` in `deviceMtls.service.ts`).
2. **A live check that its claimed serial number is currently a known, enrolled device** in the workspace's Applivery UEM fleet (`assertKnownApplivertyDevice` — reuses the Automation Credential + `getDevicesFull` pattern §9 introduced for the same purpose).

Always issues a certificate **immediately** on success — no `DeviceEnrollmentRequest` queue, no approval mode, no silent/approval toggle. One hard backstop carried over unchanged from §9: `assertNotAlreadyActive` — a serial number with an already-active certificate can never be silently re-registered through this path; only an admin revoking it first (existing `POST /api/mtls/certificates/:id/revoke`) reopens the door. This is the same anti-hijack guarantee §9 had, just simpler to reason about now that it's the *only* path in rather than one of three.

**Endpoint reuse, not a new endpoint:** the existing `POST /api/device-mtls/register` (§4.1) and `POST /api/device-mtls/renew` are kept completely unchanged as HTTP contracts. Only the backend's internal validation logic inside `registerDevice` changed — from "look up a per-device row in `DeviceBootstrapToken`" to "compare against the single shared `GlobalBootstrapToken.secret`, then run the live Applivery check." The Windows Agent's client code needed **zero changes** for the registration/renewal flow itself: `Config.BootstrapToken`, the `X-Bootstrap-Token` header, and `registerMtlsIdentity()` all work exactly as originally built in §6 — a device with the shared token configured registers exactly the way §6 already described. The old `/api/device-mtls/enroll` + `/enroll/status` polling pair from §9 is deleted; there's nothing to poll since issuance is always synchronous now.

**Schema:** `EnrollmentSecret` → renamed to `GlobalBootstrapToken` (`ALTER TABLE ... RENAME TO`, same columns). `DeviceBootstrapToken` and `DeviceEnrollmentRequest` tables dropped outright (real destructive migration — confirmed "Drop them — clean schema" with the user, since only one pilot device existed and nothing of value would be lost). `WorkspaceState.mtlsSelfServiceMode` column dropped — there's no mode to select anymore.

**Admin-facing API:** `GET/POST/DELETE /api/mtls/bootstrap-token` (renamed from §9's `/api/mtls/enrollment-secret`, same status/rotate/clear shape). §9's `/self-service-mode` and `/enrollment-requests` routes are gone. New `GET /api/mtls/proxy-config` — returns the configured reverse-proxy header names (`MTLS_HEADER_CERT_VERIFIED`/`MTLS_HEADER_CERT_CN`/`MTLS_HEADER_PROXY_SECRET`) and a `proxySecretConfigured` boolean (never the secret's actual value) — surfaces §5.5's nginx/NPM config reference directly in the admin UI instead of leaving it as a docs-only reference.

**Admin UI:** Settings > mTLS Agent Authentication now has: Certificate Authority (unchanged), **Global Bootstrap Token** (status/generate/rotate/remove — no per-device minting UI, no mode selector, no approval queue), **Reverse Proxy Configuration** (new — the §5.5 snippet with live header names + proxy-secret-configured status), Certificates (unchanged), Enforcement (unchanged mechanics, now explicitly flags that the macOS Agent has no mTLS support and enabling enforcement cuts off every macOS device on the workspace, not just unregistered Windows ones). The token itself is no longer surfaced as a standalone "generate a snippet" flow here — it's folded automatically into Settings > Device Data Webhook's single combined Managed Configuration download instead, so there is exactly one place an admin downloads a deployable config from.
