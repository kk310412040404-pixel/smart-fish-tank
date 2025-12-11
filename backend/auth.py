# auth.py
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from jose import jwt, JWTError
from passlib.context import CryptContext
import uuid
import os

# load from env or defaults (for production, store secret safely!)
SECRET_KEY = os.environ.get("JWT_SECRET", "super-secret-change-this")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_SECONDS = 60 * 5       # 5 minutes
REFRESH_TOKEN_EXPIRE_DAYS = 30             # 30 days

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_access_token(subject: str, additional: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    now = datetime.utcnow()
    exp = now + timedelta(seconds=ACCESS_TOKEN_EXPIRE_SECONDS)
    payload = {"sub": subject, "exp": exp, "iat": now, "type": "access"}
    if additional:
        payload.update(additional)
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return {"access_token": token, "expires_at": exp}

def create_refresh_token(subject: str) -> Dict[str, Any]:
    now = datetime.utcnow()
    jti = str(uuid.uuid4())
    exp = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {"sub": subject, "exp": exp, "iat": now, "jti": jti, "type": "refresh"}
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return {"refresh_token": token, "jti": jti, "expires_at": exp}

def decode_token(token: str) -> Dict:
    try:
        data = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return data
    except JWTError as e:
        raise
