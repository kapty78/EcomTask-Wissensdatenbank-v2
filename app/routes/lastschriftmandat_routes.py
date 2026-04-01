from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session
from typing import List
from ..models.lastschriftmandat import Lastschriftmandat
from ..models.business_model import Business
from ..schemas.lastschriftmandat import LastschriftmandatCreate, LastschriftmandatResponse
from ..core.dependencies import get_current_business, get_db
import uuid
import base64
from datetime import datetime
from ..utils.timezone_util import BERLIN_TZ
from ..logger import main_logger

router = APIRouter()

@router.post("/upload", response_model=LastschriftmandatResponse, status_code=status.HTTP_201_CREATED)
async def upload_lastschriftmandat(
    lastschriftmandat_data: LastschriftmandatCreate,
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Upload a Lastschriftmandat (direct debit mandate) PDF file for the logged-in business.
    The PDF will be stored directly in the database.
    """
    try:
        # Check if the business already has a Lastschriftmandat
        existing_lastschriftmandat = db.query(Lastschriftmandat).filter(
            Lastschriftmandat.business_id == current_business.id
        ).first()
        
        if existing_lastschriftmandat:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A Lastschriftmandat already exists for this business. Please update the existing one."
            )
        
        # Decode the base64 PDF file
        try:
            # Remove data URL prefix if present
            pdf_base64 = lastschriftmandat_data.pdf_file
            if ',' in pdf_base64:
                pdf_base64 = pdf_base64.split(',')[1]
                
            pdf_data = base64.b64decode(pdf_base64)
        except Exception as e:
            main_logger.error(f"Error decoding PDF file: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail="Invalid PDF file format"
            )
        
        # Sanitize the filename
        safe_filename = "".join(c if c.isalnum() or c in "._- " else "_" for c in lastschriftmandat_data.file_name)
        
        # Create a new Lastschriftmandat record
        new_lastschriftmandat = Lastschriftmandat(
            id=str(uuid.uuid4()),
            business_id=current_business.id,
            pdf_file=pdf_data,
            file_name=safe_filename,
            description=lastschriftmandat_data.description,
            created_at=datetime.now(BERLIN_TZ),
            updated_at=datetime.now(BERLIN_TZ)
        )
        
        db.add(new_lastschriftmandat)
        db.commit()
        db.refresh(new_lastschriftmandat)

        try:
            from ..core.database_manager import db_manager
            if db_manager.storage_mode.value in ["supabase", "dual"]:
                from ..repositories.supabase_repository import supabase_repository

                supabase_repository.sync_lastschriftmandat({
                    "id": new_lastschriftmandat.id,
                    "business_id": new_lastschriftmandat.business_id,
                    "pdf_file": new_lastschriftmandat.pdf_file,
                    "file_name": new_lastschriftmandat.file_name,
                    "description": new_lastschriftmandat.description,
                    "created_at": new_lastschriftmandat.created_at,
                    "updated_at": new_lastschriftmandat.updated_at,
                })
        except Exception as supabase_error:
            main_logger.warning(f"Failed to sync Lastschriftmandat to Supabase: {supabase_error}")
        
        return new_lastschriftmandat
    
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        main_logger.error(f"Error uploading Lastschriftmandat: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload Lastschriftmandat: {str(e)}"
        )

@router.get("/", response_model=LastschriftmandatResponse)
async def get_lastschriftmandat(
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Get information about the Lastschriftmandat for the logged-in business.
    This does not return the actual PDF file, only metadata.
    """
    lastschriftmandat = db.query(Lastschriftmandat).filter(
        Lastschriftmandat.business_id == current_business.id
    ).first()
    
    if not lastschriftmandat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Lastschriftmandat found for this business"
        )
    
    return lastschriftmandat

@router.get("/download")
async def download_lastschriftmandat(
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Download the Lastschriftmandat PDF file for the logged-in business.
    """
    lastschriftmandat = db.query(Lastschriftmandat).filter(
        Lastschriftmandat.business_id == current_business.id
    ).first()
    
    if not lastschriftmandat or not lastschriftmandat.pdf_file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Lastschriftmandat PDF found for this business"
        )
    
    return Response(
        content=lastschriftmandat.pdf_file,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename={lastschriftmandat.file_name}"
        }
    )

@router.put("/update", response_model=LastschriftmandatResponse)
async def update_lastschriftmandat(
    lastschriftmandat_data: LastschriftmandatCreate,
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Update the Lastschriftmandat for the logged-in business by uploading a new PDF file.
    """
    try:
        # Find existing Lastschriftmandat
        existing_lastschriftmandat = db.query(Lastschriftmandat).filter(
            Lastschriftmandat.business_id == current_business.id
        ).first()
        
        if not existing_lastschriftmandat:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No Lastschriftmandat found for this business"
            )
        
        # Decode the base64 PDF file
        try:
            # Remove data URL prefix if present
            pdf_base64 = lastschriftmandat_data.pdf_file
            if ',' in pdf_base64:
                pdf_base64 = pdf_base64.split(',')[1]
                
            pdf_data = base64.b64decode(pdf_base64)
        except Exception as e:
            main_logger.error(f"Error decoding PDF file: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail="Invalid PDF file format"
            )
        
        # Sanitize the filename
        safe_filename = "".join(c if c.isalnum() or c in "._- " else "_" for c in lastschriftmandat_data.file_name)
        
        # Update Lastschriftmandat
        existing_lastschriftmandat.pdf_file = pdf_data
        existing_lastschriftmandat.file_name = safe_filename
        existing_lastschriftmandat.description = lastschriftmandat_data.description
        existing_lastschriftmandat.updated_at = datetime.now(BERLIN_TZ)
        
        db.commit()
        db.refresh(existing_lastschriftmandat)

        try:
            from ..core.database_manager import db_manager
            if db_manager.storage_mode.value in ["supabase", "dual"]:
                from ..repositories.supabase_repository import supabase_repository

                supabase_repository.sync_lastschriftmandat({
                    "id": existing_lastschriftmandat.id,
                    "business_id": existing_lastschriftmandat.business_id,
                    "pdf_file": existing_lastschriftmandat.pdf_file,
                    "file_name": existing_lastschriftmandat.file_name,
                    "description": existing_lastschriftmandat.description,
                    "created_at": existing_lastschriftmandat.created_at,
                    "updated_at": existing_lastschriftmandat.updated_at,
                })
        except Exception as supabase_error:
            main_logger.warning(f"Failed to sync updated Lastschriftmandat to Supabase: {supabase_error}")
        
        return existing_lastschriftmandat
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        main_logger.error(f"Error updating Lastschriftmandat: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update Lastschriftmandat: {str(e)}"
        ) 
