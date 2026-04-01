import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from ..core.config import settings
import logging

# Set up logging
logger = logging.getLogger(__name__)


def send_email(recipient_email, subject, body, sender_name=None, html_body=None):
    """
    Sends an email to the recipient using the configured SMTP settings.

    Args:
        recipient_email (str): The recipient's email address.
        subject (str): The subject of the email.
        body (str): The email body content (plain text).
        sender_name (str, optional): The sender's display name. Defaults to configured name.
        html_body (str, optional): The email body content as HTML.

    Returns:
        bool: True if email was sent successfully, False otherwise.
    """
    try:
        # Use sender name from parameter or default from settings
        from_name = sender_name or settings.EMAIL_FROM_NAME
        from_address = f"{from_name} <{settings.EMAIL_FROM}>"
        
        # Prepare email message
        msg = MIMEMultipart('alternative')
        msg["From"] = from_address
        msg["To"] = recipient_email
        msg["Subject"] = subject
        
        # Attach plain text version
        msg.attach(MIMEText(body, "plain", "utf-8"))
        
        # Attach HTML version if provided
        if html_body:
            msg.attach(MIMEText(html_body, "html", "utf-8"))

        # Connect to the SMTP server
        logger.info(f"Connecting to SMTP server: {settings.SMTP_SERVER}:{settings.SMTP_PORT}")
        
        with smtplib.SMTP(settings.SMTP_SERVER, settings.SMTP_PORT) as server:
            if settings.SMTP_USE_TLS:
                logger.info("Enabling TLS encryption")
                server.starttls()  # Enable TLS encryption
            
            logger.info(f"Logging in with username: {settings.SMTP_USERNAME}")
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            
            server.sendmail(settings.EMAIL_FROM, recipient_email, msg.as_string())

        logger.info(f"Email sent successfully to {recipient_email}")
        return True

    except smtplib.SMTPAuthenticationError as auth_err:
        logger.error(f"SMTP Authentication failed: {auth_err}")
        logger.error(f"Check SMTP credentials for {settings.SMTP_USERNAME}")
        return False
    except smtplib.SMTPRecipientsRefused as recip_err:
        logger.error(f"SMTP Recipients refused: {recip_err}")
        return False
    except smtplib.SMTPServerDisconnected as disc_err:
        logger.error(f"SMTP Server disconnected: {disc_err}")
        return False
    except smtplib.SMTPException as smtp_err:
        logger.error(f"SMTP error occurred: {smtp_err}")
        return False
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return False


def send_otp_email(recipient_email, otp, business_name=None):
    """
    Sends an OTP verification email.

    Args:
        recipient_email (str): The recipient's email address.
        otp (str): The OTP code.
        business_name (str, optional): The business name for personalization.

    Returns:
        bool: True if email was sent successfully, False otherwise.
    """
    subject = "Ihr Verifizierungscode - TimeGlobe"
    
    if business_name:
        greeting = f"Sehr geehrte Damen und Herren von {business_name},"
    else:
        greeting = "Guten Tag,"
    
    # Plain text version (fallback)
    body = f"""{greeting}

Ihr Verifizierungscode lautet: {otp}

Dieser Code ist nur 5 Minuten lang gültig. Bitte teilen Sie diesen Code niemandem mit.

Falls Sie diesen Code nicht angefordert haben, ignorieren Sie diese E-Mail bitte.

Mit freundlichen Grüßen
Ihr TimeGlobe Team

---
Dies ist eine automatisch generierte E-Mail. Bitte antworten Sie nicht auf diese Nachricht.
"""
    
    # HTML version with modern design
    html_body = f"""
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TimeGlobe Verifizierungscode</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f7fa; min-height: 100vh;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table role="presentation" style="max-width: 600px; width: 100%; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden;">
                    <!-- Header -->
                    <tr>
                        <td style="background-color: #2563eb; padding: 40px 30px; text-align: center;">
                            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">
                                TimeGlobe Termin AI
                            </h1>
                            <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">
                                Ihr Verifizierungscode
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 50px 40px;">
                            <p style="margin: 0 0 25px 0; color: #333; font-size: 16px; line-height: 1.6;">
                                {greeting}
                            </p>
                            
                            <p style="margin: 0 0 30px 0; color: #555; font-size: 15px; line-height: 1.6;">
                                Ihr Einmal-Passwort (OTP) zur Verifizierung lautet:
                            </p>
                            
                            <!-- OTP Code Box -->
                            <div style="background-color: #2563eb; border-radius: 12px; padding: 30px; text-align: center; margin: 0 0 30px 0;">
                                <div style="font-size: 42px; font-weight: 700; color: white; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                                    {otp}
                                </div>
                            </div>
                            
                            <!-- Info Box -->
                            <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; border-radius: 8px; padding: 20px; margin: 0 0 25px 0;">
                                <p style="margin: 0 0 10px 0; color: #333; font-size: 14px; font-weight: 600;">
                                    Wichtige Hinweise:
                                </p>
                                <ul style="margin: 0; padding-left: 20px; color: #555; font-size: 14px; line-height: 1.8;">
                                    <li>Dieser Code ist nur <strong>5 Minuten</strong> lang gültig</li>
                                    <li>Teilen Sie diesen Code niemals mit anderen Personen</li>
                                    <li>Falls Sie diesen Code nicht angefordert haben, können Sie diese E-Mail ignorieren</li>
                                </ul>
                            </div>
                            
                            <p style="margin: 30px 0 0 0; color: #555; font-size: 15px; line-height: 1.6;">
                                Mit freundlichen Grüßen<br>
                                <strong style="color: #2563eb;">Ihr TimeGlobe Team</strong>
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 30px 40px; border-top: 1px solid #e5e7eb;">
                            <p style="margin: 0; color: #999; font-size: 12px; line-height: 1.6; text-align: center;">
                                Dies ist eine automatisch generierte E-Mail.<br>
                                Bitte antworten Sie nicht auf diese Nachricht.
                            </p>
                            <p style="margin: 15px 0 0 0; color: #999; font-size: 12px; text-align: center;">
                                © 2025 TimeGlobe. Alle Rechte vorbehalten.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
"""
    
    logger.info(f"Sending OTP email to {recipient_email} with OTP: {otp}")
    return send_email(recipient_email, subject, body, html_body=html_body)


def send_password_reset_email(recipient_email, reset_link, business_name=None):
    """
    Sends a password reset email.

    Args:
        recipient_email (str): The recipient's email address.
        reset_link (str): The password reset link.
        business_name (str, optional): The business name for personalization.

    Returns:
        bool: True if email was sent successfully, False otherwise.
    """
    subject = "Reset Your Password - TimeGlobe"
    
    if business_name:
        greeting = f"Dear {business_name},"
    else:
        greeting = "Dear User,"
    
    body = f"""{greeting}

You have requested to reset your password for your TimeGlobe account.

Click the link below to reset your password:
{reset_link}

This link is valid for a limited time. If you did not request this password reset, please ignore this email.

For security reasons, this link will expire after 24 hours.

Best regards,
TimeGlobe Team

---
This is an automated email. Please do not reply to this message.
"""
    
    return send_email(recipient_email, subject, body)
