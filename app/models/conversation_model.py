from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, JSON, Index
from sqlalchemy.sql import func
from .base import Base

class ConversationHistory(Base):
    __tablename__ = "conversation_history"
    
    id = Column(Integer, primary_key=True, index=True)
    mobile_number = Column(String(25), index=True)
    messages = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), index=True)
    
    # PERFORMANCE: Add composite indexes for common query patterns
    __table_args__ = (
        Index('idx_conversation_mobile_created', 'mobile_number', 'created_at'),
        Index('idx_conversation_updated_created', 'updated_at', 'created_at'),
    )
    
    def __repr__(self):
        return f"<ConversationHistory(mobile_number='{self.mobile_number}')>" 