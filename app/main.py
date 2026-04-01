from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from .routes import auth_route, subscription_route, webhook_routes, analytics_routes, download_routes, contract_routes, auftragsverarbeitung_routes, lastschriftmandat_routes, whatsapp_status_routes, whatsapp_onboarding_routes
from .core.config import settings
from .db.session import engine, Base
from .utils.message_queue import MessageQueue
# RENDER DISK INTEGRATION: Storage-Modul für persistente Speicherung
from .utils.storage import (
    ensure_data_directory, 
    append_log, 
    get_storage_info,
    save_json,
    DATA_PATH
)
# PERFORMANCE: Monitoring und Caching
from .utils.monitoring import monitoring_system, track_requests
from .utils.cache import cache
from .utils.error_handler import error_handler
from .services.supabase_realtime_service import supabase_realtime_service
import logging
import time
from typing import Dict, Any
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="TimeGlobe WhatsApp Assistant API - Appointment booking and management system",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# PERFORMANCE: Add request tracking middleware
@app.middleware("http")
async def track_requests_middleware(request: Request, call_next):
    """Track HTTP requests for monitoring."""
    start_time = time.time()
    response = await call_next(request)
    duration = time.time() - start_time
    
    monitoring_system.record_request(
        method=request.method,
        endpoint=request.url.path,
        status_code=response.status_code,
        duration=duration
    )
    
    return response

# Mount static files
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Include routers
app.include_router(auth_route.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(subscription_route.router, prefix="/api/subscription", tags=["Subscription"])
app.include_router(webhook_routes.router, prefix="/api/whatsapp", tags=["Webhooks"])
app.include_router(analytics_routes.router, prefix="/api/analytics", tags=["Analytics"])
app.include_router(download_routes.router, prefix="/api/download", tags=["Downloads"])
app.include_router(contract_routes.router, prefix="/api/contract", tags=["Contracts"])
app.include_router(auftragsverarbeitung_routes.router, prefix="/api/auftragsverarbeitung", tags=["Auftragsverarbeitung"])
app.include_router(lastschriftmandat_routes.router, prefix="/api/lastschriftmandat", tags=["Lastschriftmandat"])
app.include_router(whatsapp_status_routes.router, prefix="/api/whatsapp", tags=["WhatsApp Status"])
app.include_router(whatsapp_onboarding_routes.router, prefix="/api/whatsapp", tags=["WhatsApp Onboarding"])

# Initialize message queue
message_queue = MessageQueue.get_instance()

# ==============================================================================
# RENDER DISK INTEGRATION: Initialisiere Datenbank beim Startup
# ==============================================================================

def init_database():
    """
    Initialisiert die Datenbank und erstellt alle Tabellen.
    
    Diese Funktion wird beim Startup aufgerufen, um sicherzustellen,
    dass alle benötigten Tabellen existieren.
    """
    try:
        logger.info("🔧 Initialisiere Datenbank...")
        
        # Importiere alle Models explizit
        from .models.all_models import (
            Business,
            WABAStatus,
            BusinessSubscription,
            SubscriptionPlan,
            BookingDetail,
            BookModel,
            CustomerModel,
            ConversationHistory,
            MainContract,
            AuftragsverarbeitungContract,
            Lastschriftmandat,
            ResetToken,
        )
        
        # Erstelle alle Tabellen
        Base.metadata.create_all(bind=engine)
        
        # Führe Datenbank-Migration aus (für Produktions-Fix)
        logger.info("🔧 Starte Datenbank-Migration...")
        try:
            import sqlite3
            import os
            
            # Bestimme den Datenbankpfad basierend auf DATABASE_URL
            db_path = None
            
            # Extrahiere den Pfad aus DATABASE_URL
            if settings.DATABASE_URL.startswith("sqlite:///"):
                db_path = settings.DATABASE_URL.replace("sqlite:///", "")
                logger.info(f"📊 Datenbank-Pfad aus DATABASE_URL: {db_path}")
            
            # Fallback: Suche manuell nach Datenbank-Datei
            if not db_path or not os.path.exists(db_path):
                logger.warning(f"⚠️  Datenbank nicht gefunden unter {db_path}, suche in Standard-Pfaden...")
                db_paths = [
                    "/data/db/timeglobewhatsappassistant.db",
                    "data/db/timeglobewhatsappassistant.db",
                    "/opt/render/project/src/data/db/timeglobewhatsappassistant.db",
                    "timeglobewhatsappassistant.db",
                    "/opt/render/project/src/timeglobewhatsappassistant.db"
                ]
                
                logger.info(f"🔍 Suche Datenbank in: {db_paths}")
                
                for path in db_paths:
                    if os.path.exists(path):
                        db_path = path
                        logger.info(f"✅ Datenbank gefunden: {path}")
                        break
            
            if db_path:
                logger.info(f"🔧 Führe Datenbank-Migration aus für: {db_path}")
                
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                
                # Prüfe aktuelles Schema
                cursor.execute('PRAGMA table_info(businesses)')
                columns = cursor.fetchall()
                
                logger.info("📋 Aktuelles Schema:")
                for col in columns:
                    logger.info(f"  {col[1]}: {col[2]} (length: {col[3]})")
                
                needs_fix = False
                for col in columns:
                    if col[1] == 'waba_status' and col[2] == 'VARCHAR(9)':
                        needs_fix = True
                        logger.info(f"❌ waba_status ist VARCHAR(9) - Migration nötig")
                        break
                
                if needs_fix:
                    logger.info("🔧 Repariere waba_status Spalte...")
                    
                    # Erstelle neue Tabelle mit korrektem Schema
                    cursor.execute('''
                        CREATE TABLE businesses_new (
                            id VARCHAR NOT NULL, 
                            business_name VARCHAR NOT NULL, 
                            email VARCHAR NOT NULL, 
                            password VARCHAR NOT NULL, 
                            phone_number VARCHAR, 
                            is_active BOOLEAN, 
                            created_at DATETIME, 
                            tax_id VARCHAR, 
                            street_address VARCHAR, 
                            postal_code VARCHAR, 
                            city VARCHAR, 
                            country VARCHAR, 
                            contact_person VARCHAR, 
                            client_id VARCHAR, 
                            channel_id VARCHAR, 
                            api_key VARCHAR, 
                            api_endpoint VARCHAR, 
                            app_id VARCHAR, 
                            waba_status VARCHAR, 
                            whatsapp_profile JSON, 
                            whatsapp_number VARCHAR, 
                            timeglobe_auth_key VARCHAR, 
                            customer_cd VARCHAR, 
                            PRIMARY KEY (id)
                        )
                    ''')
                    logger.info("✅ Neue Tabelle erstellt")
                    
                    # Kopiere Daten
                    cursor.execute('INSERT INTO businesses_new SELECT * FROM businesses')
                    logger.info("✅ Daten kopiert")
                    
                    # Lösche alte Tabelle
                    cursor.execute('DROP TABLE businesses')
                    logger.info("✅ Alte Tabelle gelöscht")
                    
                    # Benenne neue Tabelle um
                    cursor.execute('ALTER TABLE businesses_new RENAME TO businesses')
                    logger.info("✅ Tabelle umbenannt")
                    
                    # Erstelle Indizes neu
                    cursor.execute('CREATE INDEX ix_businesses_is_active ON businesses (is_active)')
                    cursor.execute('CREATE UNIQUE INDEX ix_businesses_email ON businesses (email)')
                    cursor.execute('CREATE INDEX ix_businesses_whatsapp_number ON businesses (whatsapp_number)')
                    logger.info("✅ Indizes erstellt")
                    
                    conn.commit()
                    logger.info("✅ Datenbank-Migration erfolgreich ausgeführt")
                    
                    # Verifiziere das neue Schema
                    cursor.execute('PRAGMA table_info(businesses)')
                    columns = cursor.fetchall()
                    logger.info("📋 Neues Schema:")
                    for col in columns:
                        if col[1] == 'waba_status':
                            logger.info(f"  {col[1]}: {col[2]} (length: {col[3]})")
                else:
                    logger.info("✅ Datenbank-Schema ist bereits korrekt")
                
                # Umfassende Tabellen-Migration
                logger.info("🔧 Starte umfassende Tabellen-Migration...")
                
                # Definiere alle zu reparierenden Tabellen
                tables_to_fix = [
                    {
                        'name': 'main_contracts',
                        'create_sql': '''
                            CREATE TABLE main_contracts (
                                id VARCHAR NOT NULL,
                                business_id VARCHAR NOT NULL,
                                contract_text TEXT NOT NULL,
                                signature_image TEXT,
                                signature_image_path VARCHAR,
                                pdf_file BLOB,
                                file_name VARCHAR NOT NULL,
                                created_at DATETIME,
                                updated_at DATETIME,
                                PRIMARY KEY (id),
                                FOREIGN KEY(business_id) REFERENCES businesses (id)
                            )
                        ''',
                        'index_sql': 'CREATE INDEX IF NOT EXISTS ix_main_contracts_business_id ON main_contracts (business_id)',
                        'check_columns': ['pdf_file', 'signature_image']
                    },
                    {
                        'name': 'auftragsverarbeitung_contracts',
                        'create_sql': '''
                            CREATE TABLE auftragsverarbeitung_contracts (
                                id VARCHAR NOT NULL,
                                business_id VARCHAR NOT NULL,
                                contract_text TEXT NOT NULL,
                                signature_image TEXT,
                                pdf_file BLOB,
                                file_name VARCHAR NOT NULL,
                                created_at DATETIME,
                                updated_at DATETIME,
                                PRIMARY KEY (id),
                                FOREIGN KEY(business_id) REFERENCES businesses (id)
                            )
                        ''',
                        'index_sql': 'CREATE INDEX IF NOT EXISTS ix_auftragsverarbeitung_contracts_business_id ON auftragsverarbeitung_contracts (business_id)',
                        'check_columns': ['pdf_file', 'signature_image']
                    },
                    {
                        'name': 'lastschriftmandats',
                        'create_sql': '''
                            CREATE TABLE lastschriftmandats (
                                id VARCHAR NOT NULL,
                                business_id VARCHAR NOT NULL,
                                pdf_file BLOB NOT NULL,
                                file_name VARCHAR NOT NULL,
                                description TEXT,
                                created_at DATETIME,
                                updated_at DATETIME,
                                PRIMARY KEY (id),
                                FOREIGN KEY(business_id) REFERENCES businesses (id)
                            )
                        ''',
                        'index_sql': 'CREATE INDEX IF NOT EXISTS ix_lastschriftmandats_business_id ON lastschriftmandats (business_id)',
                        'check_columns': ['pdf_file']
                    }
                ]
                
                # Migriere jede Tabelle
                for table_info in tables_to_fix:
                    table_name = table_info['name']
                    logger.info(f"🔧 Prüfe Tabelle: {table_name}")
                    
                    # Prüfe ob Tabelle existiert
                    cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}'")
                    table_exists = cursor.fetchone()
                    
                    if not table_exists:
                        logger.info(f"ℹ️  Tabelle {table_name} existiert noch nicht (wird beim ersten Start erstellt)")
                        continue
                    
                    # Prüfe Schema
                    cursor.execute(f'PRAGMA table_info({table_name})')
                    columns = cursor.fetchall()
                    column_names = [col[1] for col in columns]
                    
                    # Prüfe ob wichtige Spalten fehlen
                    missing_columns = []
                    for check_col in table_info['check_columns']:
                        if check_col not in column_names:
                            missing_columns.append(check_col)
                    
                    if missing_columns:
                        logger.info(f"❌ Fehlende Spalten in {table_name}: {', '.join(missing_columns)}")
                        logger.info(f"🔧 Repariere {table_name}...")
                        
                        try:
                            # Lösche alte Tabelle und erstelle neu
                            cursor.execute(f'DROP TABLE IF EXISTS {table_name}')
                            cursor.execute(table_info['create_sql'])
                            cursor.execute(table_info['index_sql'])
                            conn.commit()
                            logger.info(f"✅ {table_name} erfolgreich repariert")
                        except Exception as e:
                            logger.error(f"❌ Fehler beim Reparieren von {table_name}: {e}")
                            conn.rollback()
                    else:
                        logger.info(f"✅ {table_name} Schema ist korrekt")
                
                logger.info("✅ Tabellen-Migration abgeschlossen")
                conn.close()
            else:
                logger.error("❌ Datenbank-Datei nicht gefunden!")
                logger.error("Verfügbare Dateien:")
                for path in ["/opt/render/project/src", "data", "data/db"]:
                    if os.path.exists(path):
                        files = os.listdir(path)
                        logger.error(f"  {path}: {files}")
                
        except Exception as e:
            logger.error(f"❌ Datenbank-Migration fehlgeschlagen: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
        
        logger.info("✅ Datenbank erfolgreich initialisiert")
        append_log("✅ Datenbank-Tabellen erstellt/überprüft", "application.log")
        
    except Exception as e:
        logger.error(f"❌ Fehler beim Initialisieren der Datenbank: {e}")
        append_log(f"❌ Datenbank-Initialisierungs-Fehler: {e}", "errors.log")
        raise

# Initialisiere Datenbank beim Import
init_database()

@app.on_event("startup")
async def startup_event():
    """
    Initialize services on startup.
    
    RENDER DISK INTEGRATION:
    - Initialisiert persistenten Speicher unter /data
    - Loggt Startup-Informationen für Monitoring
    - Speichert Startup-Metadaten als JSON
    """
    try:
        # ==============================================================================
        # RENDER DISK INTEGRATION: Persistenten Speicher initialisieren
        # ==============================================================================
        
        # Stelle sicher, dass alle Verzeichnisse existieren
        ensure_data_directory()
        
        # Log Startup
        startup_msg = f"🚀 TimeGlobe WhatsApp Assistant gestartet - {datetime.now().isoformat()}"
        logger.info(startup_msg)
        append_log(startup_msg, "application.log")
        
        # Hole und logge Speicherinformationen
        storage_info = get_storage_info()
        logger.info(f"📊 Persistenter Speicher: {storage_info.get('data_path')}")
        logger.info(f"💾 Speicherplatz: {storage_info.get('storage', {})}")
        
        # Speichere Startup-Metadaten als JSON
        startup_metadata = {
            "timestamp": datetime.now().isoformat(),
            "environment": settings.ENVIRONMENT,
            "database_url": settings.DATABASE_URL.split("@")[0] if "@" in settings.DATABASE_URL else "sqlite",
            "storage_info": storage_info,
            "version": settings.VERSION,
        }
        save_json(startup_metadata, f"startup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json", subdir="cache")
        
        # ==============================================================================
        
        # Start message queue workers
        await message_queue.start_workers()
        logger.info("Message queue workers started")
        append_log("✅ Message queue workers gestartet", "application.log")

        supabase_realtime_service.start()
        append_log("✅ Supabase realtime listener gestartet", "application.log")
        
    except Exception as e:
        error_msg = f"❌ Fehler beim Startup: {str(e)}"
        logger.error(error_msg)
        append_log(error_msg, "errors.log")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """
    Cleanup on shutdown.
    
    RENDER DISK INTEGRATION:
    - Loggt Shutdown-Informationen für Monitoring
    """
    try:
        # Stop message queue workers
        await message_queue.stop_workers()
        logger.info("Message queue workers stopped")

        supabase_realtime_service.stop()
        
        # RENDER DISK INTEGRATION: Log Shutdown
        shutdown_msg = f"🛑 TimeGlobe WhatsApp Assistant gestoppt - {datetime.now().isoformat()}"
        logger.info(shutdown_msg)
        append_log(shutdown_msg, "application.log")
        
    except Exception as e:
        error_msg = f"❌ Fehler beim Shutdown: {str(e)}"
        logger.error(error_msg)
        append_log(error_msg, "errors.log")

@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "Welcome to TimeGlobe WhatsApp Assistant API"}

@app.get("/health")
async def health_check():
    """
    Advanced health check endpoint with comprehensive monitoring.
    
    RENDER DISK INTEGRATION:
    Gibt auch Informationen über den persistenten Speicher zurück.
    """
    try:
        # Get all health check results
        health_results = monitoring_system.run_all_health_checks()
        
        # Determine overall status
        overall_status = "healthy"
        for result in health_results.values():
            if result.status == "unhealthy":
                overall_status = "unhealthy"
                break
            elif result.status == "degraded" and overall_status == "healthy":
                overall_status = "degraded"
        
        # Get system metrics
        system_metrics = monitoring_system.get_system_metrics()
        
        # Get storage info
        storage_info = get_storage_info()
        
        # Get cache stats
        cache_stats = cache.get_stats()
        
        # Get error handler stats
        error_stats = error_handler.get_error_stats()
        
        return {
            "status": overall_status,
            "timestamp": datetime.now().isoformat(),
            "uptime_seconds": monitoring_system.get_all_metrics()["uptime_seconds"],
            "health_checks": {
                name: {
                    "status": result.status,
                    "message": result.message,
                    "response_time": result.response_time,
                    "details": result.details
                }
                for name, result in health_results.items()
            },
            "system": system_metrics,
            "storage": {
                "path": str(DATA_PATH),
                "writable": storage_info.get("is_writable", False),
                "storage_gb": storage_info.get("storage", {}),
            },
            "cache": cache_stats,
            "errors": error_stats
        }
    except Exception as e:
        logger.error(f"Health check error: {str(e)}")
        return {
            "status": "unhealthy",
            "timestamp": datetime.now().isoformat(),
            "error": str(e)
        }

@app.get("/metrics")
async def get_metrics():
    """
    Get comprehensive application metrics.
    """
    try:
        return monitoring_system.get_all_metrics()
    except Exception as e:
        logger.error(f"Metrics error: {str(e)}")
        return {
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }

@app.get("/cache/stats")
async def get_cache_stats():
    """
    Get cache statistics.
    """
    try:
        return cache.get_stats()
    except Exception as e:
        logger.error(f"Cache stats error: {str(e)}")
        return {
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler."""
    logger.error(f"Unhandled exception: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )
