"""
Supabase Configuration Module
Handles Supabase client setup and configuration
"""

import os
import logging
from typing import Optional, Dict, Any
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
try:
    from supabase import create_client, Client
except ImportError:
    create_client = None
    Client = None
from sqlalchemy import create_engine, Engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker, Session

logger = logging.getLogger(__name__)

class SupabaseConfig:
    """Supabase configuration and client management"""
    
    def __init__(self):
        self.url: str = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
        self.anon_key: str = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
        self.service_role_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        self.database_url: str = os.getenv("SUPABASE_DATABASE_URL", "")
        
        self._client: Optional[Client] = None
        self._engine: Optional[Engine] = None
        self._session_factory: Optional[sessionmaker] = None
        
        self._validate_config()
    
    def _validate_config(self) -> None:
        """Validate Supabase configuration"""
        if not self.url:
            logger.warning("NEXT_PUBLIC_SUPABASE_URL not set - Supabase disabled")
            return
        if not self.anon_key:
            logger.warning("NEXT_PUBLIC_SUPABASE_ANON_KEY not set - Supabase disabled")
            return
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY not set - Supabase disabled")
            return
        if not self.database_url:
            logger.warning("SUPABASE_DATABASE_URL not set - Supabase disabled")
            return
        
        logger.info("Supabase configuration validated successfully")
    
    def is_configured(self) -> bool:
        """Check if Supabase is properly configured"""
        return bool(self.url and self.anon_key and self.service_role_key and self.database_url)
    
    @property
    def client(self) -> Optional[Client]:
        """Get Supabase client (lazy initialization)"""
        if self._client is None:
            # Skip REST client due to proxy issues, use SQLAlchemy directly
            logger.warning("Skipping Supabase REST client initialization (using SQLAlchemy only)")
            return None
        return self._client
    
    def _apply_connection_parameters(self, url: str, hostaddr_v4: Optional[str]) -> str:
        """Ensure required query parameters are present on the connection URL"""
        parsed = urlparse(url)
        query_params = dict(parse_qsl(parsed.query, keep_blank_values=True))

        # Enforce sane defaults for Render/Supabase connectivity
        query_params["sslmode"] = query_params.get("sslmode", "require")
        query_params["connect_timeout"] = "10"
        query_params["keepalives"] = "1"
        query_params["keepalives_idle"] = "30"

        if hostaddr_v4 and "hostaddr" not in query_params:
            query_params["hostaddr"] = hostaddr_v4

        new_query = urlencode(query_params)
        return urlunparse(parsed._replace(query=new_query))

    def _ensure_port(self, url: str, port: int) -> str:
        """Return URL with the given port enforced in the netloc."""
        parsed = urlparse(url)
        netloc = parsed.netloc

        if "@" in netloc:
            credentials, hostport = netloc.rsplit("@", 1)
        else:
            credentials, hostport = "", netloc

        host, sep, existing_port = hostport.partition(":")
        if sep and existing_port.isdigit():
            hostport = f"{host}:{port}"
        elif sep:
            # Port segment exists but is not numeric, replace entirely
            hostport = f"{host}:{port}"
        else:
            hostport = f"{hostport}:{port}"

        new_netloc = f"{credentials}@{hostport}" if credentials else hostport
        return urlunparse(parsed._replace(netloc=new_netloc))

    @property
    def engine(self) -> Engine:
        """Get SQLAlchemy engine for direct database access (lazy initialization)"""
        if self._engine is None:
            import socket

            base_db_url = (self.database_url or "").strip()
            if not base_db_url:
                raise RuntimeError("SUPABASE_DATABASE_URL not configured")

            is_render = os.getenv("RENDER", "false").lower() == "true" or os.getenv("RENDER_SERVICE_NAME") is not None

            hostaddr_v4 = os.getenv("SUPABASE_HOSTADDR_V4")
            if hostaddr_v4:
                logger.info("Using hostaddr (IPv4) from SUPABASE_HOSTADDR_V4 for PostgreSQL connection")

            # Detect whether to try the Supabase transaction pooler first
            pooler_pref = os.getenv("SUPABASE_USE_TRANSACTION_POOLER", "").lower()
            prefer_pooler = False
            if pooler_pref in {"true", "1", "yes"}:
                prefer_pooler = True
                logger.info("🔧 Transaction pooler explicitly requested via SUPABASE_USE_TRANSACTION_POOLER")
            elif pooler_pref in {"false", "0", "no"}:
                prefer_pooler = False
            elif is_render:
                prefer_pooler = True

            candidate_urls = []
            if prefer_pooler:
                pooler_url = os.getenv("SUPABASE_POOLER_URL", "").strip()
                if pooler_url:
                    logger.info("✅ Using SUPABASE_POOLER_URL for Supabase connection")
                else:
                    if ":5432" in base_db_url:
                        pooler_url = base_db_url.replace(":5432", ":6543", 1)
                        logger.info("✅ Switched to Supabase Transaction Pooler (Port 6543)")
                    else:
                        logger.warning("⚠️ Could not infer transaction pooler URL (port 5432 not found) - skipping pooler attempt")
                        pooler_url = ""
                if pooler_url:
                    mode_label = "Transaction Pooler (IPv4)" if is_render else "Transaction Pooler"
                    candidate_urls.append((mode_label, pooler_url))

            direct_url = base_db_url
            if ":6543" in base_db_url:
                direct_url = self._ensure_port(base_db_url, 5432)
                logger.info("Adjusted direct Supabase connection URL to use port 5432")

            candidate_urls.append(("Direct Connection", direct_url))

            if is_render:
                logger.info("🔧 Detected Render deployment - applying IPv4-only connection strategy")
                try:
                    if not getattr(socket.getaddrinfo, "_timeglobe_ipv4_patch", False):
                        original_getaddrinfo = socket.getaddrinfo

                        def getaddrinfo_ipv4_only(host, port, family=0, type=0, proto=0, flags=0):
                            """Force IPv4 resolution to avoid IPv6 on Render"""
                            return original_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)

                        setattr(getaddrinfo_ipv4_only, "_timeglobe_ipv4_patch", True)
                        socket.getaddrinfo = getaddrinfo_ipv4_only  # type: ignore[assignment]
                        logger.info("✅ Patched socket.getaddrinfo for IPv4-only resolution")
                except Exception as e:
                    logger.warning(f"⚠️ Could not patch socket module: {e}")

            connect_args = {
                "connect_timeout": 10,
                "application_name": "TimeGlobeApp",
            }

            last_error: Optional[Exception] = None
            for index, (mode_label, raw_url) in enumerate(candidate_urls):
                engine_candidate: Optional[Engine] = None
                formatted_url = self._apply_connection_parameters(raw_url, hostaddr_v4)
                try:
                    engine_candidate = create_engine(
                        formatted_url,
                        pool_size=5,
                        max_overflow=10,
                        pool_pre_ping=True,
                        pool_recycle=3600,
                        echo=False,
                        connect_args=connect_args
                    )

                    with engine_candidate.connect() as connection:
                        connection.execute(text("SELECT 1"))

                    self._engine = engine_candidate
                    if index > 0:
                        logger.info(f"✅ Fallback successful - Supabase SQLAlchemy engine initialized ({mode_label})")
                    else:
                        logger.info(f"Supabase SQLAlchemy engine initialized ({mode_label})")
                    break
                except OperationalError as exc:
                    last_error = exc
                    logger.warning(f"Supabase connection via {mode_label} failed: {exc}")
                    try:
                        if engine_candidate is not None:
                            engine_candidate.dispose()
                    except Exception:
                        pass
                    if index < len(candidate_urls) - 1:
                        logger.info("Attempting next Supabase connection strategy...")
                except Exception as exc:
                    last_error = exc
                    logger.warning(f"Unexpected error while initializing Supabase engine via {mode_label}: {exc}")
                    try:
                        if engine_candidate is not None:
                            engine_candidate.dispose()
                    except Exception:
                        pass
                    if index < len(candidate_urls) - 1:
                        logger.info("Attempting next Supabase connection strategy...")

            if self._engine is None:
                raise last_error or RuntimeError("Unable to initialize Supabase engine with available connection strategies")

        return self._engine
    
    @property
    def session_factory(self) -> sessionmaker:
        """Get SQLAlchemy session factory (lazy initialization)"""
        if self._session_factory is None:
            self._session_factory = sessionmaker(bind=self.engine)
            logger.info("Supabase session factory initialized")
        return self._session_factory
    
    def get_session(self) -> Session:
        """Get a new database session"""
        return self.session_factory()
    
    def test_connection(self) -> bool:
        """Test Supabase connection"""
        try:
            # Test SQLAlchemy engine (REST client is disabled)
            with self.get_session() as session:
                session.execute(text("SELECT 1"))
            logger.info("Supabase SQLAlchemy connection test successful")

            return True
        except Exception as e:
            logger.error(f"Supabase connection test failed: {e}")
            return False
    
    def get_table_client(self, table_name: str):
        """Get Supabase table client (returns None, use SQLAlchemy directly)"""
        logger.warning(f"get_table_client called for {table_name} - using SQLAlchemy instead")
        return None
    
    def execute_query(self, query: str, params: Optional[Dict[str, Any]] = None) -> Any:
        """Execute raw SQL query"""
        with self.get_session() as session:
            if params:
                result = session.execute(text(query), params)
            else:
                result = session.execute(text(query))
            return result.fetchall()
    
    def close_connections(self) -> None:
        """Close all database connections"""
        if self._engine:
            self._engine.dispose()
            logger.info("Supabase engine connections closed")
        
        # Supabase client doesn't need explicit closing
        self._client = None
        self._engine = None
        self._session_factory = None

# Global Supabase configuration instance
supabase_config = SupabaseConfig()

def get_supabase_client() -> Client:
    """Get Supabase client instance"""
    return supabase_config.client

def get_supabase_session() -> Session:
    """Get Supabase database session"""
    return supabase_config.get_session()

def get_supabase_table(table_name: str):
    """Get Supabase table client"""
    return supabase_config.get_table_client(table_name)

def test_supabase_connection() -> bool:
    """Test Supabase connection"""
    return supabase_config.test_connection()
