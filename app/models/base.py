from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import MetaData

metadata = MetaData()
Base = declarative_base(metadata=metadata)

# Do not import models here to avoid circular imports
# Models are imported in all_models.py instead
