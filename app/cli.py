import click
from .migrations.update_appointment_business_ids import update_appointment_business_ids
from .logger import main_logger

@click.group()
def cli():
    """TimeGlobe WhatsApp Assistant CLI"""
    pass

@cli.command()
def update_business_ids():
    """Update appointments with business IDs based on phone numbers."""
    try:
        main_logger.info("Starting appointment business ID update migration...")
        update_appointment_business_ids()
        main_logger.info("Appointment business ID update completed successfully.")
    except Exception as e:
        main_logger.error(f"Error during appointment business ID update: {str(e)}")
        raise

if __name__ == "__main__":
    cli() 