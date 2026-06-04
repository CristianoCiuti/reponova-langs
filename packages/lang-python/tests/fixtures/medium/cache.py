"""LRU cache with TTL and pluggable backend.

This is a "medium" fixture exercising:
  * abstract base classes / inheritance
  * generics via TypeVar
  * dataclass + property decorators
  * type hints (Optional, Callable, Dict, list)
  * async methods
  * ``__all__`` re-export list
  * intra-package relative imports
"""

from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from functools import wraps
from typing import Any, Callable, Generic, Optional, TypeVar

from . import _internal
from .._shared import logger as shared_logger

K = TypeVar("K")
V = TypeVar("V")

__all__ = ["Cache", "InMemoryCache", "AsyncCacheFacade", "cached", "Stats"]

CACHE_DEFAULT_TTL = 60.0
LOG_LINE_TEMPLATE = "[cache] hit={hits} miss={misses}"


@dataclass
class Stats:
    """Hit / miss counters for diagnostics."""

    hits: int = 0
    misses: int = 0
    evictions: int = 0
    started_at: float = field(default_factory=time.monotonic)

    @property
    def hit_ratio(self) -> float:
        total = self.hits + self.misses
        return self.hits / total if total else 0.0


class Cache(ABC, Generic[K, V]):
    """Abstract cache interface."""

    @abstractmethod
    def get(self, key: K) -> Optional[V]:
        """Return the cached value or ``None`` if absent / expired."""

    @abstractmethod
    def set(self, key: K, value: V, ttl: Optional[float] = None) -> None:
        """Insert ``value`` under ``key`` with optional TTL override."""

    @abstractmethod
    def invalidate(self, key: K) -> bool:
        """Remove ``key`` from the cache. Returns True if present."""


class InMemoryCache(Cache[K, V]):
    """Simple in-memory cache with TTL eviction on read."""

    def __init__(self, default_ttl: float = CACHE_DEFAULT_TTL) -> None:
        self._store: dict[K, tuple[V, float]] = {}
        self._default_ttl = default_ttl
        self.stats = Stats()

    def get(self, key: K) -> Optional[V]:
        entry = self._store.get(key)
        if entry is None:
            self.stats.misses += 1
            return None
        value, expires_at = entry
        if time.monotonic() > expires_at:
            self._store.pop(key, None)
            self.stats.evictions += 1
            self.stats.misses += 1
            return None
        self.stats.hits += 1
        return value

    def set(self, key: K, value: V, ttl: Optional[float] = None) -> None:
        effective = self._default_ttl if ttl is None else ttl
        self._store[key] = (value, time.monotonic() + effective)

    def invalidate(self, key: K) -> bool:
        return self._store.pop(key, None) is not None


def cached(cache: Cache[Any, Any], *, ttl: Optional[float] = None) -> Callable[..., Any]:
    """Decorator: memoize the wrapped function on ``cache``."""

    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            key = (fn.__qualname__, args, tuple(sorted(kwargs.items())))
            hit = cache.get(key)
            if hit is not None:
                return hit
            value = fn(*args, **kwargs)
            cache.set(key, value, ttl=ttl)
            return value

        return wrapper

    return decorator


class AsyncCacheFacade(Generic[K, V]):
    """Wraps a synchronous Cache and exposes ``async`` helpers."""

    def __init__(self, inner: Cache[K, V]) -> None:
        self._inner = inner

    async def get_or_load(self, key: K, loader: Callable[[K], V]) -> V:
        existing = self._inner.get(key)
        if existing is not None:
            return existing
        value = await asyncio.get_running_loop().run_in_executor(None, loader, key)
        self._inner.set(key, value)
        return value

    async def warm(self, keys: list[K], loader: Callable[[K], V]) -> int:
        loaded = 0
        for k in keys:
            await self.get_or_load(k, loader)
            loaded += 1
        return loaded


def make_default_cache() -> InMemoryCache[str, str]:
    """Factory returning a string-keyed string-valued cache."""
    return InMemoryCache(default_ttl=_internal.DEFAULT_TIMEOUT_SEC)


def describe(stats: Stats) -> str:
    """Render an end-of-run summary line."""
    shared_logger.info(LOG_LINE_TEMPLATE.format(hits=stats.hits, misses=stats.misses))
    return LOG_LINE_TEMPLATE.format(hits=stats.hits, misses=stats.misses)


_logger = logging.getLogger(__name__)
