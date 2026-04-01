"""Supabase Realtime Sync Service
---------------------------------

This module listens to Supabase realtime (Postgres changes) streams and
triggers targeted table synchronisation via ``SupabaseSyncService``.

The implementation keeps a lightweight background thread alive which maintains
an asynchronous websocket connection to Supabase's realtime endpoint.  Whenever
an INSERT/UPDATE/DELETE happens on one of the monitored tables we schedule a
``supabase_sync_service.sync_table`` run for that table.

The service is resilient against connection drops and degrades gracefully if
Supabase realtime is not configured in ``.env``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from contextlib import suppress
from typing import Dict, List, Optional

from realtime.connection import Socket

from ..core.config import settings
from .supabase_sync_service import supabase_sync_service


logger = logging.getLogger(__name__)


class SupabaseRealtimeService:
    """Background service that mirrors Supabase realtime events locally."""

    _RECONNECT_DELAY_SECONDS = 5

    def __init__(self) -> None:
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._socket: Optional[Socket] = None
        self._sync_lock = threading.Lock()
        self._monitored_tables: List[str] = [
            config.name for config in supabase_sync_service.table_configs
        ]

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Start the realtime listener in a dedicated thread."""

        if self._thread and self._thread.is_alive():
            logger.debug("Supabase realtime service already running")
            return

        if not settings.SUPABASE_URL or not (
            settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
        ):
            logger.info(
                "Supabase realtime disabled – SUPABASE_URL or API key missing"
            )
            return

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="SupabaseRealtime", daemon=True)
        self._thread.start()
        logger.info("Supabase realtime listener started")

    def stop(self) -> None:
        """Stop the realtime listener."""

        if not self._thread:
            return

        self._stop_event.set()
        if self._loop:
            try:
                self._loop.call_soon_threadsafe(lambda: None)
            except RuntimeError:
                pass

        self._thread.join(timeout=5)
        self._thread = None
        logger.info("Supabase realtime listener stopped")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _run(self) -> None:
        """Entry point for the background thread."""

        try:
            asyncio.run(self._async_main())
        except Exception as exc:  # pragma: no cover - safety net
            logger.exception("Supabase realtime worker crashed: %s", exc)

    async def _async_main(self) -> None:
        """Main async loop that (re-)establishes the websocket connection."""

        self._loop = asyncio.get_running_loop()
        api_key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
        supabase_url = settings.SUPABASE_URL.rstrip("/")
        realtime_url = supabase_url.replace("https://", "wss://").replace("http://", "ws://")
        if not realtime_url.endswith("/realtime/v1"):
            realtime_url = f"{realtime_url}/realtime/v1"
        websocket_url = f"{realtime_url}?apikey={api_key}&vsn=1.0.0"

        logger.info("Supabase realtime websocket URL: %s", websocket_url)

        while not self._stop_event.is_set():
            try:
                await self._connect_and_listen(websocket_url, api_key)
            except asyncio.CancelledError:  # pragma: no cover - controlled shutdown
                break
            except Exception as exc:
                if self._stop_event.is_set():
                    break
                logger.warning("Realtime connection error: %s – retrying in %ss", exc, self._RECONNECT_DELAY_SECONDS)
                await asyncio.sleep(self._RECONNECT_DELAY_SECONDS)

    async def _connect_and_listen(self, websocket_url: str, api_key: str) -> None:
        """Open websocket connection, subscribe to tables and wait for events."""

        socket = Socket(websocket_url, auto_reconnect=False)
        await socket._connect()
        self._socket = socket
        logger.info("Connected to Supabase realtime server")

        try:
            await asyncio.get_running_loop().run_in_executor(
                None, supabase_sync_service.sync_all
            )
            logger.info("Initial Supabase sync completed")
        except Exception as exc:
            logger.warning("Initial Supabase sync failed: %s", exc)

        # Subscribe to individual tables
        for table in self._monitored_tables:
            await self._subscribe_table(socket, table, api_key)

        listen_task = asyncio.create_task(socket._listen())
        keep_alive_task = asyncio.create_task(socket._keep_alive())
        stop_task = asyncio.create_task(self._wait_for_stop())

        done, pending = await asyncio.wait(
            {listen_task, keep_alive_task, stop_task},
            return_when=asyncio.FIRST_COMPLETED,
        )

        if stop_task in done:
            listen_task.cancel()
            keep_alive_task.cancel()
            with suppress(asyncio.CancelledError):
                await asyncio.gather(listen_task, keep_alive_task)
        else:
            stop_task.cancel()
            logger.warning("Realtime connection closed unexpectedly; reconnecting")

        if socket.ws_connection and not socket.ws_connection.closed:
            await socket.ws_connection.close()

        self._socket = None

    async def _wait_for_stop(self) -> None:
        while not self._stop_event.is_set():
            await asyncio.sleep(0.5)

    async def _subscribe_table(self, socket: Socket, table: str, api_key: str) -> None:
        topic = f"realtime:public:{table}"
        channel = socket.set_channel(topic)
        channel.on("postgres_changes", self._make_event_handler(table))

        join_payload: Dict[str, Any] = {
            "topic": topic,
            "event": "phx_join",
            "payload": {
                "config": {
                    "broadcast": {"self": False, "ack": False},
                    "postgres_changes": [
                        {"event": "*", "schema": "public", "table": table}
                    ],
                    "presence": {"key": ""},
                },
            },
            "ref": None,
        }

        await socket.ws_connection.send(json.dumps(join_payload))
        logger.info("Subscribed to Supabase realtime table '%s'", table)

    def _make_event_handler(self, table: str):
        def handler(payload: Dict[str, Any]) -> None:
            event_type = payload.get("type") or payload.get("event")
            logger.debug(
                "Realtime event on %s: %s", table, event_type
            )

            if not self._loop:
                return

            if not self._sync_lock.acquire(blocking=False):
                logger.debug("Sync already running; skipping event for %s", table)
                return

            async def run_sync() -> None:
                try:
                    result = supabase_sync_service.sync_table(table)
                    logger.info("Supabase realtime sync completed for %s: %s", table, result)
                except Exception as exc:  # pragma: no cover - safety net
                    logger.warning("Realtime sync failed for %s: %s", table, exc)
                finally:
                    self._sync_lock.release()

            try:
                asyncio.get_running_loop().create_task(run_sync())
            except RuntimeError as exc:  # pragma: no cover - should not happen
                self._sync_lock.release()
                logger.warning("Failed to schedule realtime sync task: %s", exc)

        return handler


# Singleton instance used throughout the application
supabase_realtime_service = SupabaseRealtimeService()
