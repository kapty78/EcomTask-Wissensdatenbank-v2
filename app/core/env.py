import os
import logging
from typing import Dict, Any

# Configure logging
logger = logging.getLogger(__name__)

def load_env() -> Dict[str, str]:
    """
    Load environment variables from .env file.
    Returns a dictionary of environment variables.
    """
    env_vars = {}
    
    try:
        # Try to load from .env file
        with open('.env', 'r') as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if line and not line.startswith('#'):
                    if '=' in line:
                        key, value = line.split('=', 1)
                        env_vars[key.strip()] = value.strip()
                    else:
                        logger.warning(f"Invalid line {line_num} in .env file: {line}")
                    
        logger.info("Environment variables loaded from .env file")
        
    except FileNotFoundError:
        logger.warning(".env file not found, using system environment variables")
        
    except Exception as e:
        logger.error(f"Error loading .env file: {str(e)}")
        
    # Set environment variables from .env file (if not already set by system)
    for key, value in env_vars.items():
        if key not in os.environ:
            os.environ[key] = value
    
    # Override with system environment variables (system takes precedence)
    for key, value in os.environ.items():
        env_vars[key] = value
        
    # Log important settings
    important_settings = {
        'WHATSAPP_APP_ID': env_vars.get('WHATSAPP_APP_ID', ''),
        'WHATSAPP_APP_SECRET': env_vars.get('WHATSAPP_APP_SECRET', ''),
        'WHATSAPP_WEBHOOK_VERIFY_TOKEN': env_vars.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN', ''),
        'TIMEGLOBE_API_KEY': env_vars.get('TIMEGLOBE_API_KEY', ''),
        'OPENAI_API_KEY': env_vars.get('OPENAI_API_KEY', ''),
    }
    
    for key, value in important_settings.items():
        if value:
            masked_value = value[:10] + '...' + value[-10:] if len(value) > 20 else value[:5] + '...'
            logger.info(f"✅ {key} loaded (length={len(value)}): {masked_value}")
        else:
            logger.error(f"❌ {key} NOT FOUND in environment variables!")
            
    return env_vars