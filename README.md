# TimeGlobe WhatsApp Assistant Backend

A comprehensive backend application for the TimeGlobe WhatsApp Assistant, built with FastAPI and integrated with WhatsApp Business API for automated appointment booking and customer service.

## 🚀 Features

- **WhatsApp Business API Integration**: Complete embedded signup and messaging flow
- **TimeGlobe Appointment System**: Seamless integration for booking management
- **AI-Powered Chat Assistant**: Intelligent conversation handling with OpenAI
- **Business Onboarding**: Automated WhatsApp Business Account setup
- **Phone Registration**: Complete phone number registration on WhatsApp Cloud API
- **Subscription Management**: Business subscription and billing handling
- **Analytics & Reporting**: Comprehensive business analytics dashboard
- **Webhook Management**: Automated webhook configuration and handling
- **🆕 Render Disk Integration**: Vollständige persistente Speicherung mit Render Disks

## 📁 Project Structure

```
TimeGlobeWhatsappAssistant/
├── app/                          # Main application code
│   ├── core/                     # Core configuration and dependencies
│   ├── models/                   # Database models
│   ├── routes/                   # API route handlers
│   ├── services/                 # Business logic services
│   ├── repositories/             # Data access layer
│   ├── schemas/                  # Pydantic schemas
│   ├── utils/                    # Utility functions
│   ├── db/                       # Database setup and migrations
│   └── static/                   # Static files and templates
├── docs/                         # Documentation files
├── tests/                        # Test files
├── scripts/                      # Utility scripts
└── requirements.txt              # Python dependencies
```

## 🛠️ Setup

### Prerequisites

- Python 3.8+
- WhatsApp Business API access
- TimeGlobe account
- OpenAI API key

### Installation

1. **Clone the repository**:
```bash
git clone <repository-url>
cd TimeGlobeWhatsappAssistant
```

2. **Create virtual environment**:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. **Install dependencies**:
```bash
pip install -r requirements.txt
```

4. **Configure environment variables**:
Create a `.env` file with the following variables:
```env
# WhatsApp Business API
WHATSAPP_APP_ID=your_app_id
WHATSAPP_APP_SECRET=your_app_secret
WHATSAPP_SYSTEM_TOKEN=your_system_token
WHATSAPP_OAUTH_REDIRECT_URI=your_redirect_uri

# TimeGlobe API
TIMEGLOBE_BASE_URL=https://online.time-globe-crs.de/
TIMEGLOBE_LOGIN_USERNAME=your_username
TIMEGLOBE_LOGIN_PASSWORD=your_password
TIMEGLOBE_API_KEY=your_api_key

# OpenAI
OPENAI_API_KEY=your_openai_key

# Database
DATABASE_URL=sqlite:///./timeglobewhatsappassistant.db

# Application
API_BASE_URL=https://your-domain.com
JWT_SECRET_KEY=your_jwt_secret
```

5. **Initialize database**:
```bash
python scripts/db_setup.py
```

6. **Run the application**:
```bash
uvicorn app.main:app --reload
```

## 📚 API Documentation

Once running, visit:
- **Interactive Docs**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

## 🔗 WhatsApp Business API Integration

### Embedded Signup Flow

1. **Start Embedded Signup**: Use WhatsApp's embedded signup component
2. **OAuth Callback**: Receive authorization code at `/api/whatsapp/oauth/callback`
3. **Token Exchange**: Automatically exchange code for access token
4. **Phone Registration**: Complete phone number registration flow
5. **Webhook Setup**: Automatically configure webhooks

### Key Endpoints

- `POST /api/whatsapp/complete-onboarding-public` - Complete onboarding with auth code
- `POST /api/whatsapp/complete-phone-registration` - Register phone numbers
- `GET /api/whatsapp/status-public` - Check onboarding status
- `POST /api/whatsapp/configure-webhook` - Setup webhooks

## 🧪 Testing

### Run Tests

```bash
# Run all tests
python -m pytest tests/

# Test token exchange flow
python tests/test_token_exchange_complete.py YOUR_AUTH_CODE your-business@email.com

# Test phone registration
python tests/test_phone_registration_flow.py YOUR_WABA_ID your-business@email.com
```

### Manual Testing

Use the test HTML files in `app/static/` for manual testing:
- `whatsapp_onboarding_test.html` - Test embedded signup
- `download-test.html` - Test file downloads

## 📖 Documentation

### Render Disk Integration (NEU)

- 📘 **`RENDER_INTEGRATION_SUMMARY.md`** - Vollständige Zusammenfassung aller Änderungen
- 📗 **`RENDER_DISK_SETUP.md`** - Schritt-für-Schritt Einrichtungsanleitung
- 💻 **`examples/storage_usage_examples.py`** - Code-Beispiele und Demos

### Weitere Dokumentation

Check the `docs/` directory for detailed guides:
- `WHATSAPP_TOKEN_EXCHANGE_GUIDE.md` - Complete token exchange guide
- `EMBEDDED_SIGNUP_FIXES.md` - Embedded signup troubleshooting
- `WHATSAPP_BUSINESS_API_MIGRATION_GUIDE.md` - Migration guide

## 🗃️ Database

The application uses SQLite by default with the following main models:
- `Business` - Business account information
- `Customer` - Customer data
- `Conversation` - Chat conversations
- `BookedAppointment` - Appointment bookings
- `Subscription` - Business subscriptions

## 🔧 Scripts

Utility scripts in `scripts/` directory:
- `db_setup.py` - Initialize database
- `run_migration.py` - Run database migrations

## 🚀 Deployment

### Render.com (Empfohlen)

Diese Anwendung ist für Render.com optimiert mit vollständiger persistenter Speicherunterstützung:

1. **Render Disk einrichten**:
   - Erstelle einen Disk mit Mount Path `/data`
   - Größe: mindestens 10 GB
   - Siehe detaillierte Anleitung in `RENDER_DISK_SETUP.md`

2. **Umgebungsvariablen setzen**:
   - Alle erforderlichen Variablen aus `.env.example`
   - `RENDER=true` (optional, wird automatisch erkannt)

3. **Service deployen**:
   - Die Anwendung erkennt automatisch Render
   - Erstellt automatisch alle benötigten Verzeichnisse
   - Logs, Cache und Datenbank werden persistent gespeichert

4. **Verifizieren**:
   - Health Check: `https://your-app.onrender.com/health`
   - Sollte Storage-Informationen anzeigen

📚 **Vollständige Anleitung**: Siehe `RENDER_DISK_SETUP.md` und `RENDER_INTEGRATION_SUMMARY.md`

### Alternative Deployment-Methoden

1. Set up production environment variables
2. Configure your domain and SSL certificates
3. Set up webhook endpoints
4. Deploy using your preferred method (Docker, cloud platforms, etc.)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and questions:
- Check the documentation in `docs/`
- Review test files for examples
- Open an issue on GitHub 