import io
import base64
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from PIL import Image as PILImage
import tempfile
import os
import uuid
from ..logger import main_logger

def decode_base64_image(base64_str):
    """Decodes a base64 string into a PIL Image."""
    try:
        # Remove data URL prefix if present
        if ',' in base64_str:
            base64_str = base64_str.split(',')[1]
            
        image_data = base64.b64decode(base64_str)
        image = PILImage.open(io.BytesIO(image_data))
        return image
    except Exception as e:
        main_logger.error(f"Error decoding base64 image: {str(e)}")
        raise ValueError("Invalid signature image format")

def generate_contract_pdf(contract_text, signature_base64, contract_type="LEGAL CONTRACT"):
    """
    Generates a PDF contract with the given text and signature image.
    
    Args:
        contract_text: The text content of the contract
        signature_base64: Base64 encoded signature image
        contract_type: Type of contract (default: "LEGAL CONTRACT")
                       can be "LEGAL CONTRACT" or "AUFTRAGSVERARBEITUNG"
    
    Returns:
        PDF as bytes
    """
    try:
        # Decode the signature image
        signature_img = decode_base64_image(signature_base64)
        
        # Create a temporary file for the signature
        with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp_sig_file:
            signature_path = temp_sig_file.name
            signature_img.save(signature_path)
        
        # Create a buffer for the PDF
        buffer = io.BytesIO()
        
        # Create PDF document
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=72, 
            leftMargin=72,
            topMargin=72, 
            bottomMargin=72
        )
        
        # Define styles
        styles = getSampleStyleSheet()
        title_style = styles["Heading1"]
        normal_style = styles["Normal"]
        
        # Add custom styles
        styles.add(
            ParagraphStyle(
                name='ContractHeading',
                parent=styles['Heading1'],
                fontName='Helvetica-Bold',
                fontSize=16,
                alignment=1,  # Center alignment
                spaceAfter=24
            )
        )
        
        styles.add(
            ParagraphStyle(
                name='ContractBody',
                parent=styles['Normal'],
                fontName='Helvetica',
                fontSize=12,
                spaceAfter=12
            )
        )
        
        # Create content elements
        elements = []
        
        # Add title
        elements.append(Paragraph(contract_type, styles["ContractHeading"]))
        elements.append(Spacer(1, 0.25 * inch))
        
        # Add date
        current_date = datetime.now().strftime("%B %d, %Y")
        elements.append(Paragraph(f"Date: {current_date}", normal_style))
        elements.append(Spacer(1, 0.25 * inch))
        
        # Split contract text by newlines and add each paragraph
        paragraphs = contract_text.split('\n')
        for para in paragraphs:
            if para.strip():  # Skip empty paragraphs
                elements.append(Paragraph(para, styles["ContractBody"]))
                elements.append(Spacer(1, 0.1 * inch))
        
        elements.append(Spacer(1, 0.5 * inch))
        
        # Add signature section
        elements.append(Paragraph("Signature:", normal_style))
        elements.append(Spacer(1, 0.1 * inch))
        
        # Add signature image
        signature = Image(signature_path)
        signature.drawHeight = 1 * inch
        signature.drawWidth = 3 * inch
        elements.append(signature)
        
        # Build the PDF
        doc.build(elements)
        
        # Clean up the temporary signature file
        os.unlink(signature_path)
        
        # Get the PDF data
        pdf_data = buffer.getvalue()
        buffer.close()
        
        return pdf_data
    
    except Exception as e:
        main_logger.error(f"Error generating contract PDF: {str(e)}")
        raise Exception(f"Failed to generate contract PDF: {str(e)}") 