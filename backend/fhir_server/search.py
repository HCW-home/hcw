"""FHIR search-parameter translation for DRF ViewSets.

Each mapper declares a `search_params` dict mapping FHIR search parameter names
to `SearchParam` descriptors. The `FhirSearchFilterBackend` converts the
request's query string into Django ORM filters accordingly.

Supported features:
- TokenParam: `?status=booked`, `?status=booked,pending` (OR), `?status:not=...`
- StringParam: default = prefix match, modifiers `:exact`, `:contains`
- DateParam: prefixes `eq/ne/gt/ge/lt/le/sa/eb` (RFC / FHIR)
- RefParam: accepts `Patient/123` or bare `123`
- ReservedParam suffixes `_sort`, `_count`, `_lastUpdated`
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time

from django.conf import settings
from django.db.models import Q
from django.utils.dateparse import parse_date, parse_datetime

from .references import parse_reference

RESERVED_PARAMS = {
    "_count", "_sort", "_include", "_revinclude", "_lastUpdated",
    "_format", "format", "_total", "page", "page_size",
}

_DATE_PREFIX_RE = re.compile(r"^(eq|ne|gt|ge|lt|le|sa|eb)(?=\d|\-)")


@dataclass
class SearchParam:
    """Base descriptor for a single FHIR search parameter."""
    field: str = ""
    extra: Q | None = None
    documentation: str = ""
    type: str = "string"

    def to_q(self, raw_value: str, modifier: str | None) -> Q:
        raise NotImplementedError


@dataclass
class TokenParam(SearchParam):
    type: str = "token"
    mapping: dict | None = None  # FHIR code -> Django value

    def to_q(self, raw_value: str, modifier: str | None) -> Q:
        values = [v.strip() for v in raw_value.split(",") if v.strip()]
        translated = []
        for val in values:
            if self.mapping and val in self.mapping:
                translated.append(self.mapping[val])
            else:
                translated.append(val)
        if not translated:
            return Q()
        if modifier == "not":
            q = ~Q(**{f"{self.field}__in": translated})
        else:
            q = Q(**{f"{self.field}__in": translated})
        return q & (self.extra or Q())


@dataclass
class IdentifierParam(SearchParam):
    """FHIR Identifier token search supporting `system|value` syntax.

    Routes lookups based on which system the caller specifies:
    - `<canonical-system>|value` → match `canonical_field` (HCW pk)
    - `<external-system>|value`  → match `external_field` (e.g. external_id)
    - `|value` (empty system)    → canonical only
    - bare `value` (no pipe):
        * numeric → match canonical OR external (backward-compat)
        * non-numeric → match external only
    The system URLs are resolved lazily from settings via `resource_type`,
    so per-tenant overrides via `FHIR_SYSTEM_BASE_URL_BY_TENANT` remain honoured.
    """

    type: str = "token"
    canonical_field: str = "pk"
    external_field: str | None = None
    resource_type: str = ""

    def to_q(self, raw_value: str, modifier: str | None) -> Q:
        from .references import (
            get_external_identifier_system,
            get_identifier_system,
            split_token,
        )

        canonical_sys = (
            get_identifier_system(self.resource_type) if self.resource_type else None
        )
        external_sys = (
            get_external_identifier_system(self.resource_type)
            if self.resource_type and self.external_field
            else None
        )

        q = Q()
        empty = True
        for chunk in raw_value.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            system, value = split_token(chunk)
            piece = self._chunk_q(system, value, canonical_sys, external_sys)
            q |= piece
            empty = False
        if empty:
            return Q()
        if modifier == "not":
            q = ~q
        return q & (self.extra or Q())

    def _chunk_q(self, system, value, canonical_sys, external_sys) -> Q:
        if system == canonical_sys and canonical_sys is not None:
            return self._canonical_q(value)
        if (
            external_sys is not None
            and self.external_field
            and system == external_sys
        ):
            return Q(**{f"{self.external_field}__iexact": value})
        if system == "":
            return self._canonical_q(value)
        if system is None:
            if self.external_field and not value.isdigit():
                return Q(**{f"{self.external_field}__iexact": value})
            if self.external_field and value.isdigit():
                return self._canonical_q(value) | Q(
                    **{f"{self.external_field}__iexact": value}
                )
            return self._canonical_q(value)
        # Unknown system → no match.
        return Q(pk__in=[])

    def _canonical_q(self, value) -> Q:
        try:
            int(value)
        except (TypeError, ValueError):
            return Q(pk__in=[])
        return Q(**{self.canonical_field: value})


@dataclass
class StringParam(SearchParam):
    type: str = "string"
    fields: list[str] | None = None  # if set, overrides `field`

    def to_q(self, raw_value: str, modifier: str | None) -> Q:
        fields = self.fields or [self.field]
        lookup = "istartswith"
        if modifier == "exact":
            lookup = "iexact"
        elif modifier == "contains":
            lookup = "icontains"
        values = [v.strip() for v in raw_value.split(",") if v.strip()]
        q = Q()
        for val in values:
            per_value = Q()
            for field in fields:
                per_value |= Q(**{f"{field}__{lookup}": val})
            q |= per_value
        return q & (self.extra or Q())


@dataclass
class DateParam(SearchParam):
    type: str = "date"

    def to_q(self, raw_value: str, modifier: str | None) -> Q:
        q = Q()
        for chunk in raw_value.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            prefix_match = _DATE_PREFIX_RE.match(chunk)
            prefix = "eq"
            value_str = chunk
            if prefix_match:
                prefix = prefix_match.group(1)
                value_str = chunk[len(prefix):]
            parsed = parse_datetime(value_str) or parse_date(value_str)
            if parsed is None:
                continue
            if isinstance(parsed, date) and not isinstance(parsed, datetime):
                parsed = datetime.combine(parsed, time.min)
            lookup_map = {
                "eq": "exact", "ne": None,
                "gt": "gt", "sa": "gt",
                "ge": "gte",
                "lt": "lt", "eb": "lt",
                "le": "lte",
            }
            lookup = lookup_map.get(prefix)
            if lookup is None:
                q &= ~Q(**{f"{self.field}__exact": parsed})
            else:
                q &= Q(**{f"{self.field}__{lookup}": parsed})
        return q & (self.extra or Q())


@dataclass
class RefParam(SearchParam):
    type: str = "reference"
    resource_type: str | None = None
    # Chaining metadata: when `chainable`, `chained_params` derives the
    # `<key>.identifier` and `<key>.name` descriptors from this reference.
    chainable: bool = False
    target_resource_type: str | None = None  # FHIR type of the REFERENCED resource
    name_fields: list[str] | None = None  # target name field(s), relative to `field`

    def to_q(self, raw_value: str, modifier: str | None) -> Q:
        q = Q()
        for chunk in raw_value.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            _, ident = parse_reference(chunk) if "/" in chunk else (None, chunk)
            ident = ident or chunk
            try:
                int_id = int(ident)
            except (TypeError, ValueError):
                continue
            q |= Q(**{f"{self.field}": int_id})
        return q & (self.extra or Q())


@dataclass
class CallableParam(SearchParam):
    """Delegate Q construction to a user-provided callable.

    Use when a FHIR search parameter can't be expressed as a simple field
    lookup (e.g. status derived from nullability of another column).

    The callable receives (raw_value, modifier) and must return a Q object.
    """

    type: str = "token"
    build: object = None  # callable(raw_value, modifier) -> Q

    def to_q(self, raw_value: str, modifier: str | None) -> Q:
        if self.build is None:
            return Q()
        return self.build(raw_value, modifier) & (self.extra or Q())


def chained_params(ref_key: str, ref: RefParam) -> dict[str, "SearchParam"]:
    """Derive the chained `<key>.identifier` / `<key>.name` descriptors.

    FHIR clients search across a reference with dot notation, e.g.
    `?appointment.identifier=system|value` or `?patient.name=Smith`. We generate
    those descriptors from the plain `RefParam` so plain and chained search
    always target the same relation with the same `extra` constraint.

    Returns {} when the reference is not `chainable`.
    """
    if not ref.chainable:
        return {}
    path = ref.field
    out: dict[str, SearchParam] = {
        f"{ref_key}.identifier": IdentifierParam(
            canonical_field=f"{path}__pk",
            external_field=f"{path}__external_id",
            resource_type=ref.target_resource_type,
            extra=ref.extra,
        ),
    }
    if ref.name_fields:
        name_paths = [f"{path}__{f}" for f in ref.name_fields]
        out[f"{ref_key}.name"] = StringParam(
            # `field` is set (not just `fields`) so the distinct heuristic in
            # `apply_fhir_search` detects the `__` join. See that loop.
            field=name_paths[0],
            fields=name_paths,
            extra=ref.extra,
        )
    return out


def with_chained(params: dict) -> dict:
    """Return `params` augmented with chained descriptors for every chainable ref."""
    out = dict(params)
    for key, param in list(params.items()):
        if isinstance(param, RefParam) and param.chainable:
            out.update(chained_params(key, param))
    return out


def _parse_param_key(key: str) -> tuple[str, str | None]:
    # Split the modifier off the end. A chained name (e.g. `patient.name`) never
    # contains `:`, so splitting on the first `:` correctly yields
    # `("patient.name", "contains")` for `patient.name:contains`. The dotted
    # key is then looked up verbatim in `search_params`.
    if ":" in key:
        name, modifier = key.split(":", 1)
        return name, modifier
    return key, None


def apply_fhir_search(queryset, query_params, mapper) -> tuple:
    """Apply declared FHIR search parameters and return (queryset, control_params).

    control_params captures `_count`, `_sort`, `_include`, `_revinclude`.
    Unknown parameters are silently ignored (default) or raise in strict mode.
    """
    strict = getattr(settings, "FHIR_STRICT_SEARCH", False)
    spec: dict = getattr(mapper, "search_params", {}) or {}
    control: dict = {"_count": None, "_sort": [], "_include": [], "_revinclude": []}

    filter_q = Q()
    needs_distinct = False
    for raw_key, raw_values in query_params.lists():
        if raw_key in ("format", "_format", "page", "page_size"):
            continue
        if raw_key == "_count":
            try:
                control["_count"] = min(
                    int(raw_values[0]),
                    getattr(settings, "FHIR_MAX_COUNT", 100),
                )
            except (TypeError, ValueError):
                pass
            continue
        if raw_key == "_sort":
            control["_sort"] = [s for v in raw_values for s in v.split(",") if s]
            continue
        if raw_key == "_include":
            control["_include"].extend(raw_values)
            continue
        if raw_key == "_revinclude":
            control["_revinclude"].extend(raw_values)
            continue

        name, modifier = _parse_param_key(raw_key)
        if name == "_lastUpdated" and "_lastUpdated" in spec:
            for value in raw_values:
                filter_q &= spec["_lastUpdated"].to_q(value, modifier)
            continue

        if name not in spec:
            if strict and not name.startswith("_"):
                from .exceptions import FhirOperationError
                raise FhirOperationError(
                    f"Unsupported search parameter: {name}",
                    code="not-supported",
                )
            continue

        for value in raw_values:
            filter_q &= spec[name].to_q(value, modifier)
        param = spec[name]
        # When the param crosses a reverse relation we may produce duplicate
        # rows after the join — apply distinct() once at the end.
        for attr in ("field", "canonical_field", "external_field"):
            field_value = getattr(param, attr, None)
            if isinstance(field_value, str) and "__" in field_value:
                needs_distinct = True
                break
        else:
            # StringParam keeps its joins in `fields` (a list), not `field`.
            field_list = getattr(param, "fields", None)
            if isinstance(field_list, (list, tuple)) and any(
                isinstance(f, str) and "__" in f for f in field_list
            ):
                needs_distinct = True

    if filter_q:
        queryset = queryset.filter(filter_q)
    if needs_distinct:
        queryset = queryset.distinct()

    if control["_sort"]:
        ordering = []
        for token in control["_sort"]:
            desc = token.startswith("-")
            name = token.lstrip("-")
            if name in spec and spec[name].field:
                ordering.append(f"-{spec[name].field}" if desc else spec[name].field)
        if ordering:
            queryset = queryset.order_by(*ordering)

    return queryset, control
