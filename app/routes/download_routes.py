from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse
import os
from pathlib import Path
import json
import base64
from ..utils.pdf_util import add_mandatsreferenz_to_pdf

router = APIRouter()

# Counter file to persist the download count
COUNTER_FILE = Path("app/static/downloads/counter.json")

def get_next_counter():
    """Get the next counter value and increment it for future use"""
    try:
        import time
        return int(time.time())
    except Exception as e:
        # In case of any error, default to a timestamp-based value
        import time
        return int(time.time())

@router.get("/pdf", summary="Download PDF file with incrementing filename")
async def download_sample_pdf():
    """
    Endpoint to download a PDF file with an incrementing number in the filename.
    The mandate reference number is also added to the PDF form.
    
    Returns:
        JSONResponse: Contains the filename and base64-encoded file content
    """
    # Define the path to the PDF file
    pdf_path = Path("app/static/downloads/LS-Mandat.pdf")
    
    # Check if the file exists
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF file not found")
    
    # Get the next counter value
    counter = get_next_counter()
    
    # Format counter with leading zeros for display (5 digits)
    formatted_counter = f"{counter:05d}"
    
    # Create the formatted mandate reference string
    # Format it to be clearly visible and properly formatted for the form
    mandate_reference = formatted_counter
    
    # Create the filename with the counter
    filename = f"SEPA-Lastschriftmandat_{formatted_counter}.pdf"
    
    # Open and read the file content
    with open(pdf_path, 'rb') as file:
        content = file.read()
        
    # Add the mandate reference number to the PDF
    modified_content = add_mandatsreferenz_to_pdf(content, mandate_reference)
    
    # Encode as base64
    encoded_content = base64.b64encode(modified_content).decode('utf-8')
    
    # Create a JSON response with filename and content
    json_content = {
        "filename": filename,
        "file_content": encoded_content,
        "content_type": "application/pdf",
        "mandate_reference": mandate_reference
    }
    
    # Create a manual Response object with explicit JSON content type
    response = Response(
        content=json.dumps(json_content),
        media_type="application/json"
    )
    
    # Explicitly set headers to prevent any middleware from overriding them
    response.headers["Content-Type"] = "application/json"
    
    return response
