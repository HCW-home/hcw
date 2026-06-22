# FHIR R4 Integration

HCW@Home exposes a FHIR R4 server alongside its native REST API so that external clinical systems — typically **OpenMRS / OzoneHIS** — can drive appointments, encounters, prescriptions, and patient/practitioner profiles through standard FHIR interactions. Every FHIR-capable endpoint also keeps responding to the native JSON shape: on the native routes the FHIR flavour is activated only when the request asks for it (via `Accept: application/fhir+json` or `?format=fhir`).

A dedicated, always-FHIR namespace is also available under **`/api/fhir/`** — see [The `/api/fhir/` namespace](#the-apifhir-namespace) below. It is the recommended entry point for external integrations.

This page focuses on the **external integration story**: how a third-party system carries its own identifier across HCW's resources, and how that identifier is used to address those resources back without ever holding HCW's primary keys.

## Resources exposed as FHIR

| HCW model | FHIR resource | FHIR namespace (recommended) | Native route |
|-----------|---------------|------------------------------|--------------|
| `Appointment` | `Appointment` | `/api/fhir/Appointment` | `/api/appointments/` |
| `Consultation` (follow-up) | `Encounter` | `/api/fhir/Encounter` | `/api/consultations/` |
| `User` (patient) | `Patient` | `/api/fhir/Patient` | `/api/patients/` |
| `User` (practitioner) | `Practitioner` | `/api/fhir/Practitioner` | `/api/practitioners/` |
| `Prescription` | `MedicationRequest` | `/api/fhir/MedicationRequest` | `/api/prescriptions/` |

Each endpoint supports the full FHIR REST suite: `read`, `search-type`, `create`, `update`, `patch`, `delete`. `DELETE` is **always a soft delete** (status flipped to `cancelled` / `closed` rather than a row deletion).

> The native routes (`/api/appointments/` …) are dual-mode: native JSON by default, FHIR on demand. The `/api/fhir/…` routes are **always FHIR**. The examples in the rest of this page use the native `?format=fhir` form, but every one of them works identically against the `/api/fhir/…` route — just drop the `?format=fhir` / `Content-Type` opt-in.

## The `/api/fhir/` namespace

All FHIR-capable resources are also grouped under a single, canonically-named namespace:

```
/api/fhir/Appointment
/api/fhir/Appointment/<id>
/api/fhir/Encounter
/api/fhir/Patient
/api/fhir/Practitioner
/api/fhir/metadata          # CapabilityStatement
```

These routes behave exactly like their native counterparts, with two conveniences for integrators:

- **Always FHIR.** No `?format=fhir` and no `Accept: application/fhir+json` header is needed — the namespace implies it. A plain `GET /api/fhir/Appointment` returns a FHIR `Bundle`; an error returns an `OperationOutcome`.
- **Canonical naming.** The path segment is the FHIR resource type in PascalCase (`Appointment`, `Patient`, …, **singular, no trailing slash**), matching what FHIR clients expect.

Everything else is identical to the native routes: same authentication and permissions, same search parameters, same conditional `?identifier=…` update/delete, same soft-delete semantics. For example, a conditional cancel becomes:

```http
PUT /api/fhir/Appointment?identifier=https://ozonehis.example/ns/appointment-id|OZ-7
Authorization: Token <token>
Content-Type: application/fhir+json

{"resourceType": "Appointment", "status": "cancelled", "start": "2026-06-01T09:00:00Z"}
```

`Bundle` entry `fullUrl`s and resource references resolve into this namespace too (e.g. `https://tenant.local/api/fhir/Appointment/42`).

> **Authentication still applies.** `/api/fhir/…` is **not** anonymous; it enforces the same permissions as the native routes. Only `/api/fhir/metadata` (the CapabilityStatement) is public.

## The `external_id` field

Every model above carries a hidden `external_id` column. It stores the identifier used by the external system to refer to that resource. The column is invisible to the native JSON API — it never appears in nor accepts values from the standard DRF serializers — but it is read and written through the FHIR `identifier` array.

This lets the external system **own its identifier namespace**: it never has to store HCW's primary keys to address a resource later.

The `system` URL that distinguishes the external namespace from HCW's canonical one is configured **per tenant** through the Constance admin (one entry per resource type — see [External system](#external-system) below).

## Creating a resource with an external identifier

The external client posts a regular FHIR resource and lists its own identifier in the `identifier` array, tagged with the external `system` URL:

```http
POST /api/appointments/?format=fhir
Authorization: Token <token>
Content-Type: application/fhir+json

{
  "resourceType": "Appointment",
  "status": "booked",
  "start": "2026-06-01T09:00:00Z",
  "end":   "2026-06-01T09:30:00Z",
  "identifier": [
    {"system": "https://ozonehis.example/ns/appointment-id", "value": "OZ-7"}
  ],
  "participant": [
    {"actor": {"reference": "Patient/5"}, "status": "accepted"}
  ]
}
```

The 201 response echoes both identifiers — the canonical HCW one and the external one — and `OZ-7` is now persisted in the Appointment row.

If no identifier under the configured external system is provided, the field stays `NULL`. HCW does not synthesize one.

The same shape applies when creating an `Encounter` (Consultation), `Patient`, `Practitioner`, or `MedicationRequest` (Prescription).

## Reading a resource by its external identifier

Search by the `identifier` parameter, in the FHIR token form `system|value`:

```http
GET /api/appointments/?format=fhir&identifier=https://ozonehis.example/ns/appointment-id|OZ-7
```

The response is a FHIR `Bundle` (`searchset`) containing the matching resource.

The same parameter also accepts:

| Form | Behaviour |
|------|-----------|
| `system|value` with HCW's canonical system | Match by primary key |
| `system|value` with the configured external system | Match by `external_id` |
| `|value` (empty system) | Match by primary key only |
| `value` (bare, numeric) | Match either primary key or `external_id` |
| `value` (bare, non-numeric) | Match by `external_id` only |
| Any other `system` | No match |

> **Tip:** integrators are encouraged to **always pass the full `system|value`** form. The bare fallback exists only for backward compatibility with the legacy `?identifier=<pk>` calls.

## Updating a resource by its external identifier

FHIR supports **conditional updates** that target the collection URL with an `?identifier=…` predicate — no primary key in the URL. HCW@Home accepts this on every FHIR-exposed endpoint:

```http
PUT /api/appointments/?identifier=https://ozonehis.example/ns/appointment-id|OZ-7
Authorization: Token <token>
Content-Type: application/fhir+json

{
  "resourceType": "Appointment",
  "status": "cancelled",
  "start": "2026-06-01T09:00:00Z"
}
```

Response codes:

- **200** — exactly one match was found and updated.
- **404** — no resource matches the predicate.
- **412 Precondition Failed** — more than one resource matches (only possible if the unique constraint on `external_id` is bypassed in an upstream migration).

`PATCH` works the same way for partial updates.

## Deleting (voiding) a resource by its external identifier

```http
DELETE /api/appointments/?identifier=https://ozonehis.example/ns/appointment-id|OZ-7
Authorization: Token <token>
Accept: application/fhir+json
```

Returns `204 No Content`. The Appointment is **not** removed from the database — its `status` is flipped to `cancelled`. The same soft semantics apply on Encounter (`closed_at` set), Patient/Practitioner (`is_active=False`), and MedicationRequest (`status=cancelled`).

## Fetching the consultation note attached to an appointment

When an Appointment lives inside HCW, it links to a Consultation (the **clinical record** exposed as a FHIR `Encounter`). The integration can retrieve that Encounter directly from the external Appointment id, without ever knowing HCW's primary keys:

```http
GET /api/consultations/?format=fhir&appointment=https://ozonehis.example/ns/appointment-id|OZ-7
```

The Bundle contains the Encounter that the appointment `OZ-7` belongs to. The same parameter also accepts canonical references (`appointment=Appointment/42`) for symmetry.

## Configuration

The system URLs used for both the canonical HCW namespace and the external namespace live in Django settings.

### Canonical system

The canonical `Identifier.system` URL is **auto-derived from the current tenant's primary `Domain`**. For each FHIR request, HCW resolves:

```
<scheme>://<tenant-primary-domain><path>/ns/<resource>-id
```

For a tenant whose primary domain is `hopital-a.fr`, the Appointment system URL becomes `https://hopital-a.fr/ns/appointment-id` — every tenant gets its own isolated identifier namespace, no manual configuration required.

The `system` URL is FHIR's opaque resource-namespace marker — it does not have to point to a real HTTP endpoint, only to be globally unique and stable per tenant.

The scheme and trailing path can be tuned via env vars; an explicit override skips derivation entirely:

| Env var | Default | Purpose |
|---------|---------|---------|
| `FHIR_SYSTEM_SCHEME` | `https` | Scheme used in derived URLs. |
| `FHIR_SYSTEM_PATH` | *(empty)* | Optional path appended after the tenant domain (e.g. `/fhir`). Must start with `/` when set. |
| `FHIR_SYSTEM_BASE_URL` | *(unset)* | Force one canonical base URL for **all** tenants — bypasses derivation. |

Resolution order: per-tenant override → global `FHIR_SYSTEM_BASE_URL` → derived from the tenant Domain → hard-coded fallback (only hit outside a tenant context).

For a single-tenant deployment, just set `FHIR_SYSTEM_BASE_URL=https://hcw.santé-publique.fr` and forget about the rest. For multi-tenant deployments, leave it unset — derivation handles the per-tenant differentiation automatically.

#### Per-tenant explicit overrides

If a tenant's FHIR canonical URL must differ from its serving domain (e.g. behind a CDN or reverse-proxy with a different public name), populate the override dict:

```python
# core/settings.py
FHIR_SYSTEM_BASE_URL_BY_TENANT = {
    "hopital_a": "https://fhir.hopital-a.santé-publique.fr",
    "hopital_b": "https://fhir.hopital-b.santé-publique.fr",
}
```

Keys are tenant `schema_name` values.

#### Per-resource overrides

If you need a non-standard system URL for one resource type (e.g. an OID issued by a national authority), use `FHIR_IDENTIFIER_SYSTEMS`:

```python
FHIR_IDENTIFIER_SYSTEMS = {
    "Patient": "urn:oid:1.2.250.1.71.4.2.7",  # French RPPS / INSEE-NIR
}
```

Resources absent from this dict use the dynamically derived base URL.

### External system

The external partner's system URLs are configured **per tenant** through the **Constance admin** (Settings → Config in the Django admin). Each tenant has its own set of values.

> **Menu:** Administration > Config > FHIR external identifiers

| Constance key | Default | Purpose |
|--------------|---------|---------|
| `fhir_external_appointment_system` | `https://ozonehis.example/ns/appointment-id` | Partner namespace for `Appointment` |
| `fhir_external_encounter_system`   | `https://ozonehis.example/ns/encounter-id` | Partner namespace for `Encounter` |
| `fhir_external_patient_system`     | `https://ozonehis.example/ns/patient-id` | Partner namespace for `Patient` |
| `fhir_external_practitioner_system`| `https://ozonehis.example/ns/practitioner-id` | Partner namespace for `Practitioner` |
| `fhir_external_medicationrequest_system` | `https://ozonehis.example/ns/medicationrequest-id` | Partner namespace for `MedicationRequest` |

The shipped defaults are **OzoneHIS-style placeholders** — usable for early testing, but you should replace them with the actual URLs your integration partner uses in their FHIR `Identifier.system`. Example for a real OzoneHIS deployment:

```
fhir_external_appointment_system       = https://ozonehis.hopital-a.fr/ns/appointment-id
fhir_external_encounter_system         = https://ozonehis.hopital-a.fr/ns/encounter-id
fhir_external_patient_system           = https://ozonehis.hopital-a.fr/ns/patient-id
fhir_external_practitioner_system      = https://ozonehis.hopital-a.fr/ns/practitioner-id
fhir_external_medicationrequest_system = https://ozonehis.hopital-a.fr/ns/medicationrequest-id
```

Leave a field **blank** to disable external-identifier handling for that resource — incoming identifiers under any other system are then ignored. Anything posted under a system URL different from the canonical HCW one or the configured external one is silently ignored on write and yields no match on search.

### Visibility and uniqueness

- `external_id` is **never** exposed by the native (non-FHIR) DRF responses, and the native serializers **silently drop** the field if a client tries to write it.
- A partial unique index protects each model: two rows cannot share a non-null `external_id` within the same tenant. Tenants are isolated at the schema level (`django-tenants`), so different tenants can reuse the same external identifiers without conflict.

## Quick reference — curl

```bash
# 1. Create an appointment carrying an external id
curl -X POST https://tenant.local/api/appointments/?format=fhir \
  -H "Authorization: Token TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d '{
    "resourceType": "Appointment",
    "status": "booked",
    "start": "2026-06-01T09:00:00Z",
    "end":   "2026-06-01T09:30:00Z",
    "identifier": [
      {"system": "https://ozonehis.example/ns/appointment-id", "value": "OZ-7"}
    ],
    "participant": [{"actor": {"reference": "Patient/5"}, "status": "accepted"}]
  }'

# 2. Retrieve it by external id
curl 'https://tenant.local/api/appointments/?format=fhir&identifier=https://ozonehis.example/ns/appointment-id|OZ-7' \
  -H "Authorization: Token TOKEN"

# 3. Cancel it (conditional update)
curl -X PUT 'https://tenant.local/api/appointments/?identifier=https://ozonehis.example/ns/appointment-id|OZ-7' \
  -H "Authorization: Token TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d '{"resourceType": "Appointment", "status": "cancelled", "start": "2026-06-01T09:00:00Z"}'

# 4. Soft-delete it (conditional delete)
curl -X DELETE 'https://tenant.local/api/appointments/?identifier=https://ozonehis.example/ns/appointment-id|OZ-7' \
  -H "Authorization: Token TOKEN"

# 5. Fetch the linked Encounter (consultation note)
curl 'https://tenant.local/api/consultations/?format=fhir&appointment=https://ozonehis.example/ns/appointment-id|OZ-7' \
  -H "Authorization: Token TOKEN"

# Same operations against the always-FHIR namespace (no ?format=fhir needed):
#   POST   https://tenant.local/api/fhir/Appointment
#   GET    'https://tenant.local/api/fhir/Appointment?identifier=https://ozonehis.example/ns/appointment-id|OZ-7'
#   PUT    'https://tenant.local/api/fhir/Appointment?identifier=…|OZ-7'
#   DELETE 'https://tenant.local/api/fhir/Appointment?identifier=…|OZ-7'
#   GET     https://tenant.local/api/fhir/metadata     # CapabilityStatement
```
