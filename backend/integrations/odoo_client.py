"""Thin, typed Odoo XML-RPC client.

Reuses the connection shape already proven in the zuhair-hub Odoo client
(ODOO_URL / ODOO_DB / ODOO_USERNAME / ODOO_API_KEY), but built on the
Python stdlib ``xmlrpc.client`` instead of a hand-rolled XML serializer, so
there is one less bespoke, brittle piece of code to maintain.

The client is intentionally tiny: authenticate + execute_kw + a few
convenience wrappers (search_read / create / write). Every call goes through
``execute`` so the auth lifetime and the XML-RPC envelope are in exactly one
place.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Optional

import xmlrpc.client


@dataclass(frozen=True)
class OdooConfig:
    # Non-optional by contract: config_from_env() refuses to build this with
    # any missing field, so every consumer can rely on non-null values
    # instead of guarding against None at every call site.
    url: str
    db: str
    username: str
    api_key: str


def config_from_env() -> OdooConfig:
    """Build a config from the environment.

    Raises a clear error (not a silent None) when a variable is missing so a
    misconfigured deploy fails fast instead of producing half-written records.
    """
    raw = {
        "ODOO_URL": os.getenv("ODOO_URL"),
        "ODOO_DB": os.getenv("ODOO_DB"),
        "ODOO_USERNAME": os.getenv("ODOO_USERNAME"),
        "ODOO_API_KEY": os.getenv("ODOO_API_KEY"),
    }
    missing = [name for name, value in raw.items() if not value]
    if missing:
        raise RuntimeError(f"Missing Odoo environment variables: {', '.join(missing)}")
    # Values are guaranteed non-empty here; the explicit assert narrows the
    # type for static checkers without a runtime cast.
    return OdooConfig(
        url=raw["ODOO_URL"],  # type: ignore[arg-type]
        db=raw["ODOO_DB"],  # type: ignore[arg-type]
        username=raw["ODOO_USERNAME"],  # type: ignore[arg-type]
        api_key=raw["ODOO_API_KEY"],  # type: ignore[arg-type]
    )


class OdooClient:
    """Minimal Odoo XML-RPC client.

    Not thread-safe by design: one instance per sync task is cheap and keeps
    the authenticated ``uid`` lifecycle obvious.
    """

    def __init__(self, config: OdooConfig) -> None:
        self._config = config
        self._uid: Optional[int] = None
        self._common = xmlrpc.client.ServerProxy(f"{config.url}/xmlrpc/2/common")
        self._models = xmlrpc.client.ServerProxy(f"{config.url}/xmlrpc/2/object")

    def authenticate(self) -> int:
        if self._uid is None:
            uid = self._common.authenticate(
                self._config.db, self._config.username, self._config.api_key, {}
            )
            if not uid:
                raise RuntimeError("Odoo authentication failed")
            self._uid = int(uid)
        return self._uid

    def execute(self, model: str, method: str, *args: Any, **kwargs: Any) -> Any:
        uid = self.authenticate()
        return self._models.execute_kw(
            self._config.db, uid, self._config.api_key, model, method, list(args), kwargs
        )

    def search_read(
        self,
        model: str,
        domain: list[list[Any]],
        fields: list[str] | None = None,
        limit: int = 80,
    ) -> list[dict]:
        return self.execute(model, "search_read", domain, {"fields": fields or [], "limit": limit})

    def create(self, model: str, values: dict) -> int:
        return int(self.execute(model, "create", values))

    def write(self, model: str, ids: list[int], values: dict) -> bool:
        return bool(self.execute(model, "write", ids, values))

    def search(self, model: str, domain: list[list[Any]]) -> list[int]:
        return [int(i) for i in self.execute(model, "search", domain)]
