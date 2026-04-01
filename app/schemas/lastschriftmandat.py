from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class LastschriftmandatCreate(BaseModel):
    pdf_file: str = Field(..., description="Base64 encoded PDF file")
    file_name: str = Field(..., description="Original filename of the PDF")
    description: Optional[str] = Field(None, description="Optional description for the Lastschriftmandat")

class LastschriftmandatResponse(BaseModel):
    id: str
    file_name: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True 