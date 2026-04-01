import io
import fitz  # PyMuPDF
import logging

def add_mandatsreferenz_to_pdf(pdf_bytes, mandatsreferenz):
    """
    Adds the mandate reference number to the PDF in the Mandatsreferenz box.
    
    Args:
        pdf_bytes: The PDF file as bytes
        mandatsreferenz: The mandate reference number to add
        
    Returns:
        Modified PDF as bytes
    """
    try:
        # Load PDF from bytes
        pdf_stream = io.BytesIO(pdf_bytes)
        doc = fitz.open(stream=pdf_stream, filetype="pdf")
        
        # Get the first page
        page = doc[0]
        
        # Get page dimensions
        page_rect = page.rect
        
        # Define the position for the Mandatsreferenz box based on the screenshot
        # The box appears to be in the top-right portion of the form
        # Use percentages of page dimensions for better adaptability
        x = 400  # X-coordinate (from left) - adjusted based on form layout
        y = 180  # Y-coordinate (from top) - the location of the Mandatsreferenz field
        width = 330  # Width of the text field
        height = 30  # Height of the text field
        
        # Insert the text
        rect = fitz.Rect(x, y, x + width, y + height)
        
        # Create and apply text
        text_color = (0, 0, 0)  # Black color
        page.insert_textbox(
            rect, 
            mandatsreferenz, 
            fontsize=11, 
            align=fitz.TEXT_ALIGN_LEFT,
            color=text_color
        )
        
        # Save the modified PDF to a new bytes stream
        output_stream = io.BytesIO()
        doc.save(output_stream)
        doc.close()
        
        # Return the modified PDF as bytes
        return output_stream.getvalue()
        
    except Exception as e:
        logging.error(f"Error adding mandate reference to PDF: {str(e)}")
        # Return the original PDF if there was an error
        return pdf_bytes 