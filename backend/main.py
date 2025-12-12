# main.py
import os
import random
import json
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, Depends, HTTPException, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import select, Session, SQLModel
from pydantic import BaseModel, EmailStr
from fastapi.security import OAuth2PasswordBearer 
from jose import jwt, JWTError

# Import các module nội bộ
from auth import (
    hash_password, 
    verify_password, 
    create_access_token, 
    SECRET_KEY, 
    ALGORITHM    
)
from database import init_db, engine
from models import User, OTP

# Khởi tạo bảng trong database
SQLModel.metadata.create_all(bind=engine)

app = FastAPI()

# --- CẤU HÌNH CORS (QUAN TRỌNG) ---
origins = [
    "https://kk310412040404-pixel.github.io",  # Trang GitHub Pages của bạn
    "http://127.0.0.1:5500",                   # Dành cho test Local
    "http://localhost:5500",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins, 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- DATA MODELS (Request Body) ---
class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: Optional[str] = None

class UserLogin(BaseModel):
    username: str
    password: str

class OTPVerify(BaseModel):
    email: EmailStr
    otp_code: str

class UpdatePhoneRequest(BaseModel):
    phone: str
    current_password: str

# --- ROUTE KIỂM TRA SERVER ---
@app.get("/")
def read_root():
    return {"status": "live", "message": "Smart Fish Tank API is running correctly!"}

# --- CÁC API AUTH & USER ---

@app.post("/api/register")
def register(user: UserCreate, background_tasks: BackgroundTasks):
    with Session(engine) as session:
        existing_user = session.exec(select(User).where((User.username == user.username) | (User.email == user.email))).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Username hoặc Email đã tồn tại")
        
        hashed_pw = hash_password(user.password)
        new_user = User(username=user.username, email=user.email, hashed_password=hashed_pw, full_name=user.full_name)
        session.add(new_user)
        session.commit()
        session.refresh(new_user)
        
        # Gửi OTP xác thực (Giả lập)
        otp_code = f"{random.randint(100000, 999999)}"
        # Trong thực tế: send_email(user.email, otp_code)
        # Ở đây lưu tạm vào DB để test
        otp_entry = OTP(email=new_user.email, code=otp_code, expires_at=datetime.utcnow() + timedelta(minutes=5))
        session.merge(otp_entry) # Merge để update nếu đã có
        session.commit()
        
        return {"message": "Đăng ký thành công. Vui lòng kiểm tra email lấy OTP (Demo: Check Database)", "username": new_user.username}

@app.post("/api/login/step1")
def login_step1(user_data: UserLogin):
    with Session(engine) as session:
        user = session.exec(select(User).where(User.username == user_data.username)).first()
        if not user or not verify_password(user_data.password, user.hashed_password):
            raise HTTPException(status_code=400, detail="Sai tên đăng nhập hoặc mật khẩu")
        
        # Nếu đúng pass, tạo OTP để xác thực bước 2
        otp_code = f"{random.randint(100000, 999999)}"
        otp_entry = OTP(email=user.email, code=otp_code, expires_at=datetime.utcnow() + timedelta(minutes=5))
        session.merge(otp_entry)
        session.commit()

        # Trả về email (đã che bớt) để Client hiển thị
        return {"message": "Mật khẩu đúng. Vui lòng nhập OTP.", "email": user.email, "require_otp": True}

@app.post("/api/verify-otp")
def verify_otp_endpoint(data: OTPVerify):
    with Session(engine) as session:
        otp_record = session.get(OTP, data.email)
        if not otp_record or otp_record.code != data.otp_code:
            raise HTTPException(status_code=400, detail="Mã OTP không đúng hoặc đã hết hạn")
        
        if datetime.utcnow() > otp_record.expires_at:
             raise HTTPException(status_code=400, detail="Mã OTP đã hết hạn")

        # OTP OK -> Tạo Token
        user = session.exec(select(User).where(User.email == data.email)).first()
        access_token = create_access_token(data={"sub": user.username, "role": user.role})
        
        # Xóa OTP sau khi dùng
        session.delete(otp_record)
        session.commit()

        return {
            "access_token": access_token, 
            "token_type": "bearer", 
            "role": user.role, 
            "username": user.username,
            "ui_config": user.ui_config
        }

@app.get("/api/users/me")
def read_users_me(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid auth credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid auth credentials")
    
    with Session(engine) as session:
        user = session.exec(select(User).where(User.username == username)).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user

@app.get("/api/users")
def get_all_users(token: str = Depends(oauth2_scheme)):
    # Cần check role admin ở đây (giản lược)
    with Session(engine) as session:
        users = session.exec(select(User)).all()
        return users

@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, token: str = Depends(oauth2_scheme)):
    # Cần check role admin
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        session.delete(user)
        session.commit()
        return {"message": "Deleted successfully"}

@app.put("/api/users/{user_id}/config")
def update_user_config(user_id: int, config: Dict[str, Any], token: str = Depends(oauth2_scheme)):
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # config nhận vào dạng {"ui_config": "{...string json...}"}
        if "ui_config" in config:
            user.ui_config = config["ui_config"]
            
        session.add(user)
        session.commit()
        return {"message": "Config updated"}
        
@app.put("/api/users/{user_id}/update-phone-secure")
def update_phone_secure(user_id: int, data: UpdatePhoneRequest):
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # 1. Kiểm tra mật khẩu hiện tại
        if not verify_password(data.current_password, user.hashed_password):
             raise HTTPException(status_code=400, detail="Mật khẩu xác nhận không đúng!")

        # 2. Kiểm tra định dạng số điện thoại (Cơ bản)
        if not data.phone.isdigit() or len(data.phone) < 9:
             raise HTTPException(status_code=400, detail="Số điện thoại không hợp lệ")

        # 3. Lưu SĐT mới
        user.phone = data.phone
        session.add(user)
        session.commit()
        return {"message": "Cập nhật số điện thoại thành công"}
