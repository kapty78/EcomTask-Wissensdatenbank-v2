from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session
from typing import List
from ..models.main_contract import MainContract
from ..models.business_model import Business
from ..schemas.contract import ContractCreate, ContractResponse
from ..utils.contract_util import generate_contract_pdf
from ..core.dependencies import get_current_business, get_db
import uuid
from datetime import datetime
from ..utils.timezone_util import BERLIN_TZ
from ..logger import main_logger

router = APIRouter()

@router.post("/create", response_model=ContractResponse, status_code=status.HTTP_201_CREATED)
async def create_main_contract(
    contract_data: ContractCreate,
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Create a main contract for the logged-in business.
    The contract will be stored as a PDF file in the database.
    """
    try:
        # Check if the business already has a contract
        existing_contract = db.query(MainContract).filter(
            MainContract.business_id == current_business.id
        ).first()
        
        if existing_contract:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A main contract already exists for this business. Please update the existing contract."
            )
        
        # Generate the PDF from the contract text and signature image
        pdf_data = generate_contract_pdf(
            contract_data.contract_text,
            contract_data.signature_image
        )
        
        # Create the file name based on business name and timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_business_name = "".join(c if c.isalnum() else "_" for c in current_business.business_name)
        file_name = f"{safe_business_name}_main_contract_{timestamp}.pdf"
        
        # Create new contract record
        new_contract = MainContract(
            id=str(uuid.uuid4()),
            business_id=current_business.id,
            contract_text=contract_data.contract_text,
            signature_image=contract_data.signature_image,
            pdf_file=pdf_data,
            file_name=file_name,
            created_at=datetime.now(BERLIN_TZ),
            updated_at=datetime.now(BERLIN_TZ)
        )
        
        db.add(new_contract)
        db.commit()
        db.refresh(new_contract)

        try:
            from ..core.database_manager import db_manager
            if db_manager.storage_mode.value in ["supabase", "dual"]:
                from ..repositories.supabase_repository import supabase_repository

                supabase_repository.sync_main_contract({
                    "id": new_contract.id,
                    "business_id": new_contract.business_id,
                    "contract_text": new_contract.contract_text,
                    "signature_image": new_contract.signature_image,
                    "signature_image_path": new_contract.signature_image_path,
                    "pdf_file": new_contract.pdf_file,
                    "file_name": new_contract.file_name,
                    "created_at": new_contract.created_at,
                    "updated_at": new_contract.updated_at,
                })
        except Exception as supabase_error:
            main_logger.warning(f"Failed to sync main contract to Supabase: {supabase_error}")
        
        return new_contract
    
    except Exception as e:
        main_logger.error(f"Error creating main contract: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create main contract: {str(e)}"
        )

@router.get("/", response_model=ContractResponse)
async def get_main_contract(
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Get the main contract information for the logged-in business.
    """
    contract = db.query(MainContract).filter(
        MainContract.business_id == current_business.id
    ).first()
    
    if not contract:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No main contract found for this business"
        )
    
    return contract

@router.get("/download")
async def download_main_contract(
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Download the PDF file of the main contract for the logged-in business.
    """
    contract = db.query(MainContract).filter(
        MainContract.business_id == current_business.id
    ).first()
    
    if not contract or not contract.pdf_file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No main contract PDF found for this business"
        )
    
    return Response(
        content=contract.pdf_file,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename={contract.file_name}"
        }
    )

@router.put("/update", response_model=ContractResponse)
async def update_main_contract(
    contract_data: ContractCreate,
    db: Session = Depends(get_db),
    current_business: Business = Depends(get_current_business)
):
    """
    Update the main contract for the logged-in business.
    """
    try:
        # Find existing contract
        existing_contract = db.query(MainContract).filter(
            MainContract.business_id == current_business.id
        ).first()
        
        if not existing_contract:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No main contract found for this business"
            )
        
        # Generate new PDF
        pdf_data = generate_contract_pdf(
            contract_data.contract_text,
            contract_data.signature_image
        )
        
        # Keep the same filename or create a new one with updated timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_business_name = "".join(c if c.isalnum() else "_" for c in current_business.business_name)
        file_name = f"{safe_business_name}_main_contract_{timestamp}.pdf"
        
        # Update contract
        existing_contract.contract_text = contract_data.contract_text
        existing_contract.signature_image = contract_data.signature_image
        existing_contract.pdf_file = pdf_data
        existing_contract.file_name = file_name
        existing_contract.updated_at = datetime.now(BERLIN_TZ)
        
        db.commit()
        db.refresh(existing_contract)

        try:
            from ..core.database_manager import db_manager
            if db_manager.storage_mode.value in ["supabase", "dual"]:
                from ..repositories.supabase_repository import supabase_repository

                supabase_repository.sync_main_contract({
                    "id": existing_contract.id,
                    "business_id": existing_contract.business_id,
                    "contract_text": existing_contract.contract_text,
                    "signature_image": existing_contract.signature_image,
                    "signature_image_path": existing_contract.signature_image_path,
                    "pdf_file": existing_contract.pdf_file,
                    "file_name": existing_contract.file_name,
                    "created_at": existing_contract.created_at,
                    "updated_at": existing_contract.updated_at,
                })
        except Exception as supabase_error:
            main_logger.warning(f"Failed to sync updated main contract to Supabase: {supabase_error}")
        
        return existing_contract
        
    except Exception as e:
        main_logger.error(f"Error updating main contract: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update main contract: {str(e)}"
        ) 
