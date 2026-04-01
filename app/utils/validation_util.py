import re
from typing import List, Optional, Union, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class ValidationError(Exception):
    """Custom exception for validation errors."""
    pass

class EnumValidator:
    """Centralized enum validation for TimeGlobe API parameters."""
    
    # Define all valid enum values
    SALUTATION_CODES = ["na", "male", "female", "diverse"]
    
    @staticmethod
    def validate_salutation_cd(value: str) -> str:
        """
        Validate salutationCd enum value.
        
        Args:
            value: The salutation code to validate
            
        Returns:
            str: The validated salutation code
            
        Raises:
            ValidationError: If the value is invalid
        """
        if not value:
            raise ValidationError("salutationCd cannot be empty")
            
        if not isinstance(value, str):
            raise ValidationError(f"salutationCd must be a string, got {type(value).__name__}")
            
        value = value.lower().strip()
        
        if value not in EnumValidator.SALUTATION_CODES:
            raise ValidationError(
                f"Invalid salutationCd '{value}'. Must be one of: {EnumValidator.SALUTATION_CODES}"
            )
            
        return value

class ParameterValidator:
    """General parameter validation utilities."""
    
    @staticmethod
    def validate_email(email: str) -> str:
        """
        Validate email format.
        
        Args:
            email: Email address to validate
            
        Returns:
            str: The validated email address
            
        Raises:
            ValidationError: If email format is invalid
        """
        if not email:
            raise ValidationError("Email cannot be empty")
            
        if not isinstance(email, str):
            raise ValidationError(f"Email must be a string, got {type(email).__name__}")
            
        email = email.strip()
        
        # Basic email regex pattern
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        
        if not re.match(email_pattern, email):
            raise ValidationError(f"Invalid email format: {email}")
            
        return email
    
    @staticmethod
    def validate_mobile_number(mobile_number: str) -> str:
        """
        Validate and format mobile number.
        
        Args:
            mobile_number: Mobile number to validate
            
        Returns:
            str: The formatted mobile number with + prefix
            
        Raises:
            ValidationError: If mobile number format is invalid
        """
        if not mobile_number:
            raise ValidationError("Mobile number cannot be empty")
            
        if not isinstance(mobile_number, str):
            raise ValidationError(f"Mobile number must be a string, got {type(mobile_number).__name__}")
            
        # Remove whitespace and common separators
        mobile_number = re.sub(r'[\s\-\(\)]', '', mobile_number.strip())
        
        # Remove leading zeros
        if mobile_number.startswith("0"):
            mobile_number = mobile_number[1:]
            
        # Add + prefix if missing
        if not mobile_number.startswith("+"):
            mobile_number = "+" + mobile_number
            
        # Basic validation - should start with + and contain only digits after
        if not re.match(r'^\+\d{7,15}$', mobile_number):
            raise ValidationError(f"Invalid mobile number format: {mobile_number}")
            
        return mobile_number
    
    @staticmethod
    def validate_site_cd(site_cd: str) -> str:
        """
        Validate site code format.
        
        Args:
            site_cd: Site code to validate
            
        Returns:
            str: The validated site code
            
        Raises:
            ValidationError: If site code is invalid
        """
        if not site_cd:
            raise ValidationError("Site code cannot be empty")
            
        if not isinstance(site_cd, str):
            raise ValidationError(f"Site code must be a string, got {type(site_cd).__name__}")
            
        site_cd = site_cd.strip()
        
        # Basic validation - alphanumeric and common separators
        if not re.match(r'^[a-zA-Z0-9_-]+$', site_cd):
            raise ValidationError(f"Invalid site code format: {site_cd}")
            
        return site_cd
    
    @staticmethod
    def validate_boolean(value: Any, param_name: str) -> bool:
        """
        Validate and convert boolean parameter.
        
        Args:
            value: Value to validate as boolean
            param_name: Name of the parameter for error messages
            
        Returns:
            bool: The validated boolean value
            
        Raises:
            ValidationError: If value cannot be converted to boolean
        """
        if value is None:
            return False
            
        if isinstance(value, bool):
            return value
            
        if isinstance(value, str):
            value_lower = value.lower().strip()
            if value_lower in ['true', '1', 'yes', 'on']:
                return True
            elif value_lower in ['false', '0', 'no', 'off']:
                return False
            else:
                raise ValidationError(f"Invalid boolean value for {param_name}: {value}")
                
        if isinstance(value, int):
            return bool(value)
            
        raise ValidationError(f"Cannot convert {param_name} to boolean: {value} ({type(value).__name__})")
    
    @staticmethod
    def validate_integer(value: Any, param_name: str, min_value: Optional[int] = None, max_value: Optional[int] = None) -> int:
        """
        Validate and convert integer parameter.
        
        Args:
            value: Value to validate as integer
            param_name: Name of the parameter for error messages
            min_value: Optional minimum value
            max_value: Optional maximum value
            
        Returns:
            int: The validated integer value
            
        Raises:
            ValidationError: If value cannot be converted to integer or is out of range
        """
        if value is None:
            raise ValidationError(f"{param_name} cannot be None")
            
        try:
            if isinstance(value, str):
                int_value = int(value.strip())
            else:
                int_value = int(value)
        except (ValueError, TypeError):
            raise ValidationError(f"Invalid integer value for {param_name}: {value}")
            
        if min_value is not None and int_value < min_value:
            raise ValidationError(f"{param_name} must be >= {min_value}, got {int_value}")
            
        if max_value is not None and int_value > max_value:
            raise ValidationError(f"{param_name} must be <= {max_value}, got {int_value}")
            
        return int_value
    
    @staticmethod
    def validate_string(value: Any, param_name: str, max_length: Optional[int] = None, min_length: Optional[int] = None) -> str:
        """
        Validate string parameter.
        
        Args:
            value: Value to validate as string
            param_name: Name of the parameter for error messages
            max_length: Optional maximum length
            min_length: Optional minimum length
            
        Returns:
            str: The validated string value
            
        Raises:
            ValidationError: If value is invalid or length is out of range
        """
        if value is None:
            raise ValidationError(f"{param_name} cannot be None")
            
        if not isinstance(value, str):
            raise ValidationError(f"{param_name} must be a string, got {type(value).__name__}")
            
        value = value.strip()
        
        if min_length is not None and len(value) < min_length:
            raise ValidationError(f"{param_name} must be at least {min_length} characters, got {len(value)}")
            
        if max_length is not None and len(value) > max_length:
            raise ValidationError(f"{param_name} must be at most {max_length} characters, got {len(value)}")
            
        return value
    
    @staticmethod
    def validate_positions_array(positions: List[dict]) -> List[dict]:
        """
        Validate positions array for appointment booking.
        
        Args:
            positions: List of position dictionaries to validate
            
        Returns:
            List[dict]: The validated positions array
            
        Raises:
            ValidationError: If positions array is invalid
        """
        if not positions:
            raise ValidationError("Positions array cannot be empty")
            
        if not isinstance(positions, list):
            raise ValidationError(f"Positions must be a list, got {type(positions).__name__}")
            
        validated_positions = []
        
        for i, position in enumerate(positions):
            if not isinstance(position, dict):
                raise ValidationError(f"Position {i+1} must be a dictionary, got {type(position).__name__}")
                
            # Validate required fields
            required_fields = ['itemNo']
            for field in required_fields:
                if field not in position:
                    raise ValidationError(f"Position {i+1} missing required field: {field}")
                    
            # Validate itemNo
            try:
                item_no = ParameterValidator.validate_integer(position['itemNo'], f"Position {i+1} itemNo", min_value=1)
                position['itemNo'] = item_no
            except ValidationError as e:
                raise ValidationError(f"Position {i+1}: {str(e)}")
                
            # Validate employeeId if present
            if 'employeeId' in position and position['employeeId'] is not None:
                try:
                    employee_id = ParameterValidator.validate_integer(position['employeeId'], f"Position {i+1} employeeId", min_value=1)
                    position['employeeId'] = employee_id
                except ValidationError as e:
                    raise ValidationError(f"Position {i+1}: {str(e)}")
                    
            validated_positions.append(position)
            
        return validated_positions

def validate_function_parameters(func_name: str, **kwargs) -> dict:
    """
    Centralized parameter validation for tool functions.
    
    Args:
        func_name: Name of the function being validated
        **kwargs: Parameters to validate
        
    Returns:
        dict: Validated parameters
        
    Raises:
        ValidationError: If any parameter is invalid
    """
    logger.debug(f"Validating parameters for function: {func_name}")
    
    validated_params = {}
    
    try:
        if func_name == "updateProfileSalutation":
            validated_params['salutationCd'] = EnumValidator.validate_salutation_cd(kwargs.get('salutationCd'))
            if 'mobile_number' in kwargs:
                validated_params['mobile_number'] = ParameterValidator.validate_mobile_number(kwargs['mobile_number'])
                
        elif func_name == "store_profile" or func_name == "store_profile_wrapper":
            if 'salutationCd' in kwargs and kwargs['salutationCd']:
                validated_params['salutationCd'] = EnumValidator.validate_salutation_cd(kwargs['salutationCd'])
            if 'email' in kwargs and kwargs['email']:
                validated_params['email'] = ParameterValidator.validate_email(kwargs['email'])
            if 'mobile_number' in kwargs:
                validated_params['mobile_number'] = ParameterValidator.validate_mobile_number(kwargs['mobile_number'])
            if 'fullNm' in kwargs and kwargs['fullNm']:
                validated_params['fullNm'] = ParameterValidator.validate_string(kwargs['fullNm'], 'fullNm', max_length=100, min_length=1)
            if 'dplAccepted' in kwargs:
                validated_params['dplAccepted'] = ParameterValidator.validate_boolean(kwargs['dplAccepted'], 'dplAccepted')
                
        elif func_name == "updateProfileEmail":
            validated_params['email'] = ParameterValidator.validate_email(kwargs.get('email'))
            if 'mobile_number' in kwargs:
                validated_params['mobile_number'] = ParameterValidator.validate_mobile_number(kwargs['mobile_number'])
                
        elif func_name == "updateProfileName":
            if 'fullNm' in kwargs and kwargs['fullNm']:
                validated_params['fullNm'] = ParameterValidator.validate_string(kwargs['fullNm'], 'fullNm', max_length=100, min_length=1)
            if 'mobile_number' in kwargs:
                validated_params['mobile_number'] = ParameterValidator.validate_mobile_number(kwargs['mobile_number'])
                
        elif func_name == "AppointmentSuggestion":
            if 'siteCd' in kwargs:
                validated_params['siteCd'] = ParameterValidator.validate_site_cd(kwargs['siteCd'])
            if 'week' in kwargs:
                validated_params['week'] = ParameterValidator.validate_integer(kwargs['week'], 'week', min_value=0, max_value=52)
            if 'positions' in kwargs and kwargs['positions']:
                validated_params['positions'] = ParameterValidator.validate_positions_array(kwargs['positions'])
                
        elif func_name == "getProducts" or func_name == "getEmployees" or func_name == "getBookableCustomers":
            if 'siteCd' in kwargs:
                validated_params['siteCd'] = ParameterValidator.validate_site_cd(kwargs['siteCd'])
                
        elif func_name == "bookAppointment":
            if 'siteCd' in kwargs:
                validated_params['siteCd'] = ParameterValidator.validate_site_cd(kwargs['siteCd'])
            if 'reminderSms' in kwargs:
                validated_params['reminderSms'] = ParameterValidator.validate_boolean(kwargs['reminderSms'], 'reminderSms')
            if 'reminderEmail' in kwargs:
                validated_params['reminderEmail'] = ParameterValidator.validate_boolean(kwargs['reminderEmail'], 'reminderEmail')
                
        elif func_name == "cancelAppointment":
            if 'orderId' in kwargs:
                validated_params['orderId'] = ParameterValidator.validate_integer(kwargs['orderId'], 'orderId', min_value=1)
            if 'siteCd' in kwargs:
                validated_params['siteCd'] = ParameterValidator.validate_site_cd(kwargs['siteCd'])
                
        # Copy over any parameters that weren't specifically validated
        for key, value in kwargs.items():
            if key not in validated_params:
                validated_params[key] = value
                
        logger.debug(f"Parameter validation successful for {func_name}")
        return validated_params
        
    except ValidationError as e:
        logger.error(f"Parameter validation failed for {func_name}: {str(e)}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error during parameter validation for {func_name}: {str(e)}")
        raise ValidationError(f"Parameter validation error: {str(e)}") 