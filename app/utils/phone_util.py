import re
from typing import Optional

def normalize_phone_number(phone_number: Optional[str]) -> Optional[str]:
    """
    Normalize a phone number by removing spaces, special characters, and standardizing format.
    
    Args:
        phone_number: The phone number to normalize
        
    Returns:
        Normalized phone number or None if input is None/empty
    """
    if not phone_number:
        return None
    
    # Remove all whitespace and special characters except digits and +
    normalized = re.sub(r'[^\d+]', '', phone_number.strip())
    
    # Remove leading zeros if present (but keep + if it exists)
    if normalized.startswith('00'):
        normalized = '+' + normalized[2:]
    elif normalized.startswith('0') and not normalized.startswith('+'):
        normalized = normalized[1:]
    
    return normalized if normalized else None

def format_phone_number_variants(phone_number: str) -> list[str]:
    """
    Generate different format variants of a phone number for database lookup.
    
    Args:
        phone_number: The base phone number
        
    Returns:
        List of phone number variants to try for matching
    """
    if not phone_number:
        return []
    
    normalized = normalize_phone_number(phone_number)
    if not normalized:
        return []
    
    variants = [normalized]
    
    # Add variant with + prefix if not present
    if not normalized.startswith('+'):
        variants.append('+' + normalized)
    
    # Add variant without + prefix if present
    if normalized.startswith('+'):
        variants.append(normalized[1:])
    
    # Remove duplicates while preserving order
    return list(dict.fromkeys(variants)) 