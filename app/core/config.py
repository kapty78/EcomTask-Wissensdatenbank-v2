from pydantic_settings import BaseSettings
from .env import load_env
import logging
import re
import os
from pathlib import Path

# Set up logging
logger = logging.getLogger(__name__)

# Load environment variables at module level
env = load_env()

# ==============================================================================
# RENDER DISK INTEGRATION: Datenbank-Pfad für persistenten Speicher
# ==============================================================================

def get_persistent_db_url() -> str:
    """
    Gibt die DATABASE_URL für persistenten Speicher zurück.
    
    - Auf Render: /data/db/timeglobewhatsappassistant.db
    - Lokal: ./data/db/timeglobewhatsappassistant.db
    
    Falls DATABASE_URL bereits in der Umgebung gesetzt ist (z.B. PostgreSQL),
    wird diese verwendet.
    """
    # Wenn DATABASE_URL in Umgebungsvariablen gesetzt ist und nicht SQLite ist,
    # verwende diese (z.B. für PostgreSQL auf Render)
    if "DATABASE_URL" in env and not env["DATABASE_URL"].startswith("sqlite"):
        logger.info(f"🔗 Verwende DATABASE_URL aus Umgebungsvariablen: {env['DATABASE_URL'].split('@')[0]}...")
        return env["DATABASE_URL"]
    
    # Andernfalls: SQLite im persistenten Speicher
    is_render = os.getenv("RENDER", "false").lower() == "true" or os.getenv("RENDER_SERVICE_NAME") is not None
    
    # Always use local data directory for development
    db_dir = Path("./data/db")
    
    # Stelle sicher, dass das DB-Verzeichnis existiert
    db_dir.mkdir(parents=True, exist_ok=True)
    
    db_path = db_dir / "timeglobewhatsappassistant.db"
    db_url = f"sqlite:///./data/db/timeglobewhatsappassistant.db"
    
    logger.info(f"💾 SQLite-Datenbank wird gespeichert in: {db_path.absolute()}")
    
    return db_url

# ==============================================================================


def clean_api_key(api_key: str) -> str:
    """
    Comprehensive API key cleaning function to handle all edge cases.
    
    Handles:
    - Leading/trailing whitespace (spaces, tabs, newlines)
    - All types of quotes (single, double, backticks, unicode quotes)
    - Escaped quotes (\", \')
    - Multiple nested quotes
    - Unicode whitespace characters
    - Zero-width characters
    - BOM (Byte Order Mark)
    - Line breaks within the key
    - Control characters
    
    Args:
        api_key: Raw API key string from environment
        
    Returns:
        Cleaned API key string
    """
    if not api_key:
        return api_key
    
    # Step 1: Remove BOM (Byte Order Mark) if present
    if api_key.startswith('\ufeff'):
        api_key = api_key[1:]
    
    # Step 2: Remove all types of line breaks and carriage returns
    api_key = api_key.replace('\r\n', '').replace('\n', '').replace('\r', '')
    
    # Step 3: Strip all leading/trailing whitespace (including unicode whitespace)
    api_key = api_key.strip()
    
    # Step 4: Remove zero-width characters
    zero_width_chars = ['\u200b', '\u200c', '\u200d', '\ufeff', '\u2060']
    for char in zero_width_chars:
        api_key = api_key.replace(char, '')
    
    # Step 5: Remove quotes (all types) from beginning and end
    quote_chars = ['"', "'", '`', '"', '"', ''', ''']
    
    prev_length = 0
    while len(api_key) != prev_length:  # Keep stripping until no change
        prev_length = len(api_key)
        api_key = api_key.strip()
        
        # Strip each type of quote (matching pairs)
        for quote in quote_chars:
            if api_key.startswith(quote) and api_key.endswith(quote) and len(api_key) > 1:
                api_key = api_key[1:-1]
        
        # Handle escaped quotes at the boundaries
        if api_key.startswith('\\"') or api_key.startswith("\\'"):
            api_key = api_key[2:]
        if api_key.endswith('\\"') or api_key.endswith("\\'"):
            api_key = api_key[:-2]
        
        # Handle mixed quotes (different quote types at start and end)
        for quote in quote_chars:
            if api_key.startswith(quote) and len(api_key) > 1:
                api_key = api_key[1:]
            if api_key.endswith(quote) and len(api_key) > 1:
                api_key = api_key[:-1]
    
    # Step 6: Final trim of any remaining whitespace
    api_key = api_key.strip()
    
    # Step 7: Remove any internal line breaks
    api_key = re.sub(r'[\r\n\t]+', '', api_key)
    
    # Step 8: Collapse multiple spaces
    api_key = re.sub(r' +', ' ', api_key)
    
    # Step 9: Final safety trim
    api_key = api_key.strip()
    
    return api_key

class Settings(BaseSettings):
    app_name: str = "TimeGlobeWhatsappAssistant"
    ENVIRONMENT: str = env.get("ENVIRONMENT", "development")
    # RENDER DISK INTEGRATION: Verwende persistenten Speicher für Datenbank
    DATABASE_URL: str = get_persistent_db_url()

    # WhatsApp Business API Settings
    WHATSAPP_APP_ID: str = env.get("WHATSAPP_APP_ID", "")
    WHATSAPP_APP_SECRET: str = env.get("WHATSAPP_APP_SECRET", "")
    WHATSAPP_SYSTEM_TOKEN: str = env.get("WHATSAPP_SYSTEM_TOKEN", "")
    WHATSAPP_OAUTH_REDIRECT_URI: str = env.get("WHATSAPP_OAUTH_REDIRECT_URI", "")
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: str = env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "")
    WHATSAPP_API_VERSION: str = env.get("WHATSAPP_API_VERSION", "v18.0")

    # Email Settings
    SMTP_SERVER: str = env.get("SMTP_SERVER", "smtp-mail.outlook.com")
    SMTP_PORT: int = int(env.get("SMTP_PORT", "587"))
    SMTP_USERNAME: str = env.get("SMTP_USERNAME", "")
    SMTP_PASSWORD: str = env.get("SMTP_PASSWORD", "")
    SMTP_USE_TLS: bool = env.get("SMTP_USE_TLS", "true").lower() == "true"
    EMAIL_FROM: str = env.get("EMAIL_FROM", "")
    EMAIL_FROM_NAME: str = env.get("EMAIL_FROM_NAME", "TimeGlobe")

    # TimeGlobe Settings
    TIMEGLOBE_BASE_URL: str = env.get("TIMEGLOBE_BASE_URL", "https://timeglobe.app/api")
    TIMEGLOBE_LOGIN_USERNAME: str = env.get("TIMEGLOBE_LOGIN_USERNAME", "")
    TIMEGLOBE_LOGIN_PASSWORD: str = env.get("TIMEGLOBE_LOGIN_PASSWORD", "")
    
    # Load and clean TimeGlobe API key (SECURITY: Don't log sensitive data)
    _timeglobe_raw_key = env.get("TIMEGLOBE_API_KEY", "")
    logger.info(f"🔑 TIMEGLOBE_API_KEY loaded: {'Yes' if _timeglobe_raw_key else 'No'}")
    TIMEGLOBE_API_KEY: str = clean_api_key(_timeglobe_raw_key)
    logger.info(f"🔑 TIMEGLOBE_API_KEY cleaned: {'Yes' if TIMEGLOBE_API_KEY else 'No'}")

    # OpenAI Settings (SECURITY: Don't log sensitive data)
    _openai_raw_key = env.get("OPENAI_API_KEY", "")
    logger.info(f"🔑 OPENAI_API_KEY loaded: {'Yes' if _openai_raw_key else 'No'}")
    OPENAI_API_KEY: str = clean_api_key(_openai_raw_key)
    logger.info(f"🔑 OPENAI_API_KEY cleaned: {'Yes' if OPENAI_API_KEY else 'No'}")

    # JWT Settings (SECURITY: Use strong default secret)
    JWT_SECRET_KEY: str = env.get("JWT_SECRET_KEY", "CHANGE_THIS_IN_PRODUCTION_USE_STRONG_SECRET_KEY")
    JWT_EXPIRES_IN_MINUTES: int = 60 * 24 * 7  # 7 days
    ACCESS_TOKEN_EXPIRE_TIME: int = int(env.get("ACCESS_TOKEN_EXPIRE_TIME", "30"))

    # App metadata
    PROJECT_NAME: str = env.get("PROJECT_NAME", "TimeGlobe APPOINTMENT AI")
    VERSION: str = env.get("VERSION", "1.0.0")
    ALLOWED_ORIGINS: str = env.get("ALLOWED_ORIGINS", "https://timeglobe.ecomtask.de,https://timeglobe-server.ecomtask.de")
    
    # API Configuration
    API_BASE_URL: str = env.get("API_BASE_URL", "")
    
    # Frontend URLs
    FRONTEND_RESET_PASSWORD_URL: str = env.get("FRONTEND_RESET_PASSWORD_URL", "https://timeglobe.ecomtask.de/reset-password")

    # Facebook Business Manager Partner ID (EcomTask)
    FACEBOOK_PARTNER_ID: str = env.get("FACEBOOK_PARTNER_ID", "878298803995527")

    # Supabase Settings
    SUPABASE_URL: str = env.get("NEXT_PUBLIC_SUPABASE_URL", "")
    SUPABASE_ANON_KEY: str = env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY: str = env.get("SUPABASE_SERVICE_ROLE_KEY", "")

    # This is the important part - allows extra fields
    model_config = {
        "extra": "ignore"  # Allows extra fields from env file that aren't defined in the class
    }

# Create settings instance
settings = Settings()

# Log important settings to verify they're loaded correctly (without exposing sensitive values)
logger.info(f"WHATSAPP_APP_ID: {settings.WHATSAPP_APP_ID}")
logger.info(f"WHATSAPP_APP_SECRET loaded: {bool(settings.WHATSAPP_APP_SECRET)}")
logger.info(f"WHATSAPP_SYSTEM_TOKEN loaded: {bool(settings.WHATSAPP_SYSTEM_TOKEN)}")
logger.info(f"WHATSAPP_WEBHOOK_VERIFY_TOKEN loaded: {bool(settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN)}")
logger.info(f"TIMEGLOBE_BASE_URL: {settings.TIMEGLOBE_BASE_URL}")
logger.info(f"TIMEGLOBE_API_KEY loaded: {bool(settings.TIMEGLOBE_API_KEY)}")
logger.info(f"OPENAI_API_KEY loaded: {bool(settings.OPENAI_API_KEY)}")
logger.info(f"Environment: {settings.ENVIRONMENT}")
