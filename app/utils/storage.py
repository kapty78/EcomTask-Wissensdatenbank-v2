"""
Render Disk Persistent Storage Module
======================================

Dieses Modul stellt persistente Speicherfunktionen für die Render.com-Umgebung bereit.
Alle Daten werden unter /data gespeichert, das auf einem Render Disk gemountet ist.

Für lokale Entwicklung gibt es einen Fallback auf ./data im Projektverzeichnis.

Verwendung:
    from app.utils.storage import append_log, save_json, load_json, get_db_path
    
    # Log schreiben
    append_log("Neue WhatsApp-Nachricht empfangen")
    
    # JSON speichern
    save_json({"key": "value"}, "cache.json")
    
    # JSON laden
    data = load_json("cache.json")
    
    # SQLite DB-Pfad abrufen
    db_path = get_db_path("app.db")
"""

import os
import json
import sqlite3
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional
import logging

# Logger für dieses Modul
logger = logging.getLogger(__name__)

# ==============================================================================
# KONFIGURATION: Render Disk Mount Path
# ==============================================================================

# Prüfen, ob wir auf Render laufen (durch SERVICE_NAME Environment Variable)
IS_RENDER = os.getenv("RENDER", "false").lower() == "true" or os.getenv("RENDER_SERVICE_NAME") is not None

# Render Disk mount path ist /data
# Für lokale Entwicklung nutzen wir ./data
if IS_RENDER:
    DATA_PATH = Path("/data")
    logger.info("🚀 Render-Umgebung erkannt - Nutze /data für persistenten Speicher")
else:
    DATA_PATH = Path("./data")
    logger.info("💻 Lokale Entwicklungsumgebung - Nutze ./data für persistenten Speicher")


# ==============================================================================
# INITIALISIERUNG
# ==============================================================================

def ensure_data_directory() -> None:
    """
    Stellt sicher, dass das DATA_PATH-Verzeichnis existiert.
    
    Wird automatisch beim Import aufgerufen und sollte auch
    beim Startup der Anwendung explizit aufgerufen werden.
    """
    try:
        DATA_PATH.mkdir(parents=True, exist_ok=True)
        logger.info(f"✅ Persistenter Speicher initialisiert: {DATA_PATH.absolute()}")
        
        # Erstelle Unterverzeichnisse für verschiedene Datentypen
        (DATA_PATH / "logs").mkdir(exist_ok=True)
        (DATA_PATH / "cache").mkdir(exist_ok=True)
        (DATA_PATH / "db").mkdir(exist_ok=True)
        
    except Exception as e:
        logger.error(f"❌ Fehler beim Initialisieren des persistenten Speichers: {e}")
        raise


# Automatische Initialisierung beim Import
ensure_data_directory()


# ==============================================================================
# LOG-FUNKTIONEN
# ==============================================================================

def append_log(message: str, log_name: str = "application.log") -> None:
    """
    Hängt eine Log-Nachricht an eine Log-Datei im /data/logs Verzeichnis an.
    
    Args:
        message: Die zu loggende Nachricht
        log_name: Name der Log-Datei (Standard: application.log)
        
    Beispiel:
        append_log("WhatsApp-Nachricht von +49123456789 empfangen")
        append_log("Fehler beim Senden", log_name="errors.log")
    """
    try:
        log_file = DATA_PATH / "logs" / log_name
        timestamp = datetime.now().isoformat()
        
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {message}\n")
            
    except Exception as e:
        logger.error(f"Fehler beim Schreiben in Log-Datei {log_name}: {e}")


def read_logs(log_name: str = "application.log", lines: int = 100) -> str:
    """
    Liest die letzten N Zeilen aus einer Log-Datei.
    
    Args:
        log_name: Name der Log-Datei
        lines: Anzahl der zu lesenden Zeilen (von hinten)
        
    Returns:
        String mit den letzten Log-Einträgen
    """
    try:
        log_file = DATA_PATH / "logs" / log_name
        
        if not log_file.exists():
            return f"Log-Datei {log_name} existiert nicht."
        
        with open(log_file, "r", encoding="utf-8") as f:
            all_lines = f.readlines()
            return "".join(all_lines[-lines:])
            
    except Exception as e:
        logger.error(f"Fehler beim Lesen der Log-Datei {log_name}: {e}")
        return f"Fehler: {str(e)}"


# ==============================================================================
# JSON-FUNKTIONEN
# ==============================================================================

def save_json(data: Dict[str, Any], filename: str, subdir: str = "cache") -> bool:
    """
    Speichert ein Dictionary als JSON-Datei im persistenten Speicher.
    
    Args:
        data: Dictionary zum Speichern
        filename: Name der Datei (z.B. "cache.json")
        subdir: Unterverzeichnis innerhalb von DATA_PATH (Standard: cache)
        
    Returns:
        True bei Erfolg, False bei Fehler
        
    Beispiel:
        save_json({"user_id": 123, "name": "Max"}, "user_cache.json")
    """
    try:
        target_dir = DATA_PATH / subdir
        target_dir.mkdir(exist_ok=True)
        
        file_path = target_dir / filename
        
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        logger.info(f"JSON-Datei gespeichert: {file_path}")
        return True
        
    except Exception as e:
        logger.error(f"Fehler beim Speichern der JSON-Datei {filename}: {e}")
        return False


def load_json(filename: str, subdir: str = "cache", default: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Lädt eine JSON-Datei aus dem persistenten Speicher.
    
    Args:
        filename: Name der Datei
        subdir: Unterverzeichnis innerhalb von DATA_PATH (Standard: cache)
        default: Rückgabewert, wenn Datei nicht existiert
        
    Returns:
        Dictionary mit den geladenen Daten oder default-Wert
        
    Beispiel:
        data = load_json("user_cache.json", default={})
    """
    try:
        file_path = DATA_PATH / subdir / filename
        
        if not file_path.exists():
            logger.warning(f"JSON-Datei nicht gefunden: {file_path}")
            return default if default is not None else {}
        
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        logger.info(f"JSON-Datei geladen: {file_path}")
        return data
        
    except Exception as e:
        logger.error(f"Fehler beim Laden der JSON-Datei {filename}: {e}")
        return default if default is not None else {}


# ==============================================================================
# SQLITE-FUNKTIONEN
# ==============================================================================

def get_db_path(db_filename: str = "timeglobewhatsappassistant.db") -> str:
    """
    Gibt den vollständigen Pfad zur SQLite-Datenbank im persistenten Speicher zurück.
    
    Args:
        db_filename: Name der Datenbankdatei
        
    Returns:
        Absoluter Pfad zur Datenbank
        
    Beispiel:
        db_path = get_db_path()
        # Für SQLAlchemy: f"sqlite:///{db_path}"
    """
    db_path = DATA_PATH / "db" / db_filename
    return str(db_path.absolute())


def get_db_connection(db_filename: str = "timeglobewhatsappassistant.db") -> sqlite3.Connection:
    """
    Erstellt eine SQLite-Verbindung zur Datenbank im persistenten Speicher.
    
    Args:
        db_filename: Name der Datenbankdatei
        
    Returns:
        sqlite3.Connection-Objekt
        
    Beispiel:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users")
        conn.close()
    """
    db_path = get_db_path(db_filename)
    
    try:
        conn = sqlite3.connect(db_path)
        logger.info(f"SQLite-Verbindung hergestellt: {db_path}")
        return conn
        
    except Exception as e:
        logger.error(f"Fehler beim Verbinden mit SQLite-Datenbank: {e}")
        raise


# ==============================================================================
# UTILITY-FUNKTIONEN
# ==============================================================================

def get_storage_info() -> Dict[str, Any]:
    """
    Gibt Informationen über den persistenten Speicher zurück.
    
    Returns:
        Dictionary mit Speicherinformationen
    """
    try:
        info = {
            "data_path": str(DATA_PATH.absolute()),
            "is_render": IS_RENDER,
            "exists": DATA_PATH.exists(),
            "is_writable": os.access(DATA_PATH, os.W_OK),
            "subdirectories": {
                "logs": (DATA_PATH / "logs").exists(),
                "cache": (DATA_PATH / "cache").exists(),
                "db": (DATA_PATH / "db").exists(),
            }
        }
        
        # Versuche, Speicherplatz-Informationen zu erhalten
        if DATA_PATH.exists():
            stat = os.statvfs(DATA_PATH)
            info["storage"] = {
                "total_gb": round(stat.f_blocks * stat.f_frsize / (1024**3), 2),
                "free_gb": round(stat.f_bavail * stat.f_frsize / (1024**3), 2),
                "used_gb": round((stat.f_blocks - stat.f_bavail) * stat.f_frsize / (1024**3), 2),
            }
        
        return info
        
    except Exception as e:
        logger.error(f"Fehler beim Abrufen der Speicherinformationen: {e}")
        return {"error": str(e)}


def clear_cache(max_age_days: int = 7) -> int:
    """
    Löscht alte Cache-Dateien, die älter als max_age_days sind.
    
    Args:
        max_age_days: Maximales Alter in Tagen
        
    Returns:
        Anzahl der gelöschten Dateien
    """
    try:
        cache_dir = DATA_PATH / "cache"
        if not cache_dir.exists():
            return 0
        
        deleted_count = 0
        current_time = datetime.now().timestamp()
        max_age_seconds = max_age_days * 24 * 60 * 60
        
        for file_path in cache_dir.iterdir():
            if file_path.is_file():
                file_age = current_time - file_path.stat().st_mtime
                if file_age > max_age_seconds:
                    file_path.unlink()
                    deleted_count += 1
                    logger.info(f"Alte Cache-Datei gelöscht: {file_path.name}")
        
        return deleted_count
        
    except Exception as e:
        logger.error(f"Fehler beim Bereinigen des Caches: {e}")
        return 0


# ==============================================================================
# EXPORT
# ==============================================================================

__all__ = [
    "DATA_PATH",
    "IS_RENDER",
    "ensure_data_directory",
    "append_log",
    "read_logs",
    "save_json",
    "load_json",
    "get_db_path",
    "get_db_connection",
    "get_storage_info",
    "clear_cache",
]

