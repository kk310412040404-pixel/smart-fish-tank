# models.py
from typing import Optional
from sqlmodel import SQLModel, Field
from datetime import datetime

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    email: str = Field(index=True, unique=True)
    hashed_password: str
    full_name: Optional[str] = None
    phone: Optional[str] = None  # Số điện thoại cho bảo mật nâng cao
    
    role: str = Field(default="user")
    # Lưu cấu hình giao diện: theme, widgets, permissions
    ui_config: str = Field(default='{"theme": "default", "widgets": ["all"], "permissions": {"can_add": true, "can_control": true}}')
    
    is_active: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class OTP(SQLModel, table=True):
    email: str = Field(primary_key=True)
    code: str
    expires_at: datetime