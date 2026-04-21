"""FhirViewSetMixin: turns a DRF ViewSet into a FHIR-capable endpoint.

Usage:

    class AppointmentViewSet(FhirViewSetMixin, ModelViewSet):
        fhir_class = AppointmentFhirMapper
        ...

Keeps the native JSON flow intact. Activates FHIR only when the request
selects `application/fhir+json` (via `Accept` header or `?format=fhir`).
"""
from __future__ import annotations

from rest_framework import status
from rest_framework.response import Response

from .bundle import build_searchset_bundle
from .exceptions import FhirOperationError, is_fhir_request
from .negotiation import FhirContentNegotiation
from .parsers import FhirJsonParser
from .renderers import FhirJsonRenderer
from .search import apply_fhir_search


class FhirViewSetMixin:
    """Adds FHIR rendering/parsing and CRUD routing to a DRF ViewSet.

    Expects the ViewSet to define `fhir_class` (a FhirResourceMapper subclass).
    """

    fhir_class = None
    content_negotiation_class = FhirContentNegotiation

    # -- content negotiation ------------------------------------------------

    def get_renderers(self):
        renderers = list(super().get_renderers())
        if FhirJsonRenderer not in (type(r) for r in renderers):
            renderers.append(FhirJsonRenderer())
        return renderers

    def get_parsers(self):
        parsers = list(super().get_parsers())
        if FhirJsonParser not in (type(p) for p in parsers):
            parsers.append(FhirJsonParser())
        return parsers

    def _fhir_mapper(self):
        if self.fhir_class is None:
            raise FhirOperationError(
                "This endpoint does not declare a fhir_class.",
                code="not-supported",
                status_code=status.HTTP_501_NOT_IMPLEMENTED,
            )
        return self.fhir_class() if isinstance(self.fhir_class, type) else self.fhir_class

    # -- list ---------------------------------------------------------------

    def list(self, request, *args, **kwargs):
        if not is_fhir_request(request):
            return super().list(request, *args, **kwargs)

        mapper = self._fhir_mapper()
        # Skip DjangoFilterBackend: FHIR request uses declarative FHIR search
        # params (which may collide in name with the native filterset).
        queryset = self.get_queryset()
        queryset, control = apply_fhir_search(queryset, request.query_params, mapper)

        paginator = self.paginator
        if paginator is not None and control.get("_count"):
            paginator.page_size = control["_count"]

        page = self.paginate_queryset(queryset)
        instances = list(page) if page is not None else list(queryset)
        include_entries = self._collect_fhir_includes(mapper, instances, control)

        bundle = build_searchset_bundle(
            request=request,
            mapper=mapper,
            instances=instances,
            paginator=paginator,
            queryset=queryset,
            include_entries=include_entries,
        )
        return Response(bundle)

    def _collect_fhir_includes(self, mapper, instances, control):
        include_entries = []
        include_targets = getattr(mapper, "include_targets", {}) or {}
        for include in control.get("_include", []):
            # Format "ResourceType:search-param" -> "search-param"
            key = include.split(":", 1)[1] if ":" in include else include
            target = include_targets.get(key)
            if target is None:
                continue
            related_mapper, resolver = target
            related_mapper = related_mapper() if isinstance(related_mapper, type) else related_mapper
            seen = set()
            for instance in instances:
                for related in resolver(instance) or []:
                    if related is None or related.pk in seen:
                        continue
                    seen.add(related.pk)
                    include_entries.append((related_mapper, related))
        return include_entries

    # -- retrieve -----------------------------------------------------------

    def retrieve(self, request, *args, **kwargs):
        if not is_fhir_request(request):
            return super().retrieve(request, *args, **kwargs)

        instance = self.get_object()
        mapper = self._fhir_mapper()
        return self._fhir_response(mapper, instance, status.HTTP_200_OK)

    # -- create / update ----------------------------------------------------

    def create(self, request, *args, **kwargs):
        if not is_fhir_request(request) and not self._request_has_fhir_payload(request):
            return super().create(request, *args, **kwargs)

        mapper = self._fhir_mapper()
        context = {"request": request, "view": self}
        instance = mapper.from_fhir(request.data, instance=None, context=context)
        self.perform_fhir_create(mapper, instance, request.data, context)
        return self._fhir_response(mapper, instance, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        if not is_fhir_request(request) and not self._request_has_fhir_payload(request):
            return super().update(request, *args, **kwargs)

        mapper = self._fhir_mapper()
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        context = {"request": request, "view": self, "partial": partial}
        updated = mapper.from_fhir(request.data, instance=instance, context=context)
        self.perform_fhir_update(mapper, updated, request.data, context)
        return self._fhir_response(mapper, updated, status.HTTP_200_OK)

    def perform_fhir_create(self, mapper, instance, payload, context):
        """Hook: persist the instance built by `mapper.from_fhir`.

        Subclasses override when m2m relations must be reconciled after save.
        """
        instance.save()
        post_save = getattr(mapper, "post_save", None)
        if callable(post_save):
            post_save(instance, payload=payload, context=context, created=True)

    def perform_fhir_update(self, mapper, instance, payload, context):
        instance.save()
        post_save = getattr(mapper, "post_save", None)
        if callable(post_save):
            post_save(instance, payload=payload, context=context, created=False)

    # -- destroy ------------------------------------------------------------

    def destroy(self, request, *args, **kwargs):
        """Prefer the mapper's `soft_delete` hook when available.

        Keeps FHIR and native DELETE consistent: a mapper declaring a soft
        delete strategy always wins, regardless of whether the client sent a
        FHIR-flavoured request. Falls back to DRF's hard delete otherwise.
        """
        mapper = self._fhir_mapper() if self.fhir_class else None
        soft_delete = getattr(mapper, "soft_delete", None) if mapper else None
        if callable(soft_delete):
            instance = self.get_object()
            soft_delete(instance, context={"request": request, "view": self})
            return Response(status=status.HTTP_204_NO_CONTENT)
        return super().destroy(request, *args, **kwargs)

    # -- response helpers ---------------------------------------------------

    def _fhir_response(self, mapper, instance, status_code):
        context = {"request": self.request}
        body = mapper.to_fhir(instance, context=context)
        response = Response(body, status=status_code)
        response["ETag"] = mapper.etag_for(instance)
        last_modified = mapper.last_modified_for(instance)
        if last_modified is not None:
            response["Last-Modified"] = (
                last_modified.strftime("%a, %d %b %Y %H:%M:%S GMT")
                if hasattr(last_modified, "strftime")
                else str(last_modified)
            )
        if status_code == status.HTTP_201_CREATED and getattr(instance, "pk", None):
            response["Location"] = f"{mapper.resource_type}/{instance.pk}"
        return response

    def _request_has_fhir_payload(self, request) -> bool:
        content_type = getattr(request, "content_type", "") or ""
        return content_type.startswith("application/fhir+json")

    # -- introspection ------------------------------------------------------

    @classmethod
    def fhir_interactions(cls) -> list[str]:
        """Return the FHIR interactions supported by this ViewSet.

        Used by CapabilityStatement. Override to restrict.
        """
        method_names = [m.lower() for m in getattr(cls, "http_method_names", [])]
        mapping = {
            "get": ["read", "search-type"],
            "post": ["create"],
            "put": ["update"],
            "patch": ["patch"],
            "delete": ["delete"],
        }
        interactions: list[str] = []
        for method in method_names:
            for interaction in mapping.get(method, []):
                if interaction not in interactions:
                    interactions.append(interaction)
        return interactions
