# main.py
import os
import random
import json
import requests # <--- BẮT BUỘC PHẢI CÓ
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, Depends, HTTPException, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import select, Session, SQLModel
from pydantic import BaseModel, EmailStr
from fastapi.security import OAuth2PasswordBearer 
from jose import jwt, JWTError
# Đã xóa import fastapi_mail vì không dùng nữa

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

# --- HÀM GỬI MAIL QUA API BREVO (KHÔNG DÙNG SMTP NỮA) ---
def send_email_via_brevo(to_email: str, subject: str, html_content: str):
    # Lấy API Key từ biến môi trường (Lưu ý: Đây là API Key, không phải SMTP Key)
    api_key = os.getenv("MAIL_PASSWORD") 
    url = "https://api.brevo.com/v3/smtp/email"
    
    headers = {
        "accept": "application/json",
        "api-key": api_key,
        "content-type": "application/json"
    }
    
    payload = {
        "sender": {
            "name": "Smart Fish Tank", 
            "email": "kk310412040404@gmail.com" # Email người gửi
        },
        "to": [{"email": to_email}],
        "subject": subject,
        "htmlContent": html_content
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers)
        if response.status_code == 201:
            print(f" Email sent to {to_email}")
        else:
            print(f" Error sending email: {response.text}")
    except Exception as e:
        print(f" Exception sending email: {str(e)}")

# --- CẤU HÌNH CORS ---
origins = [
    "https://kk310412040404-pixel.github.io",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins, 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/login")

# --- MODELS REQUEST ---
class UserRegister(BaseModel):
    username: str
    password: str
    email: EmailStr
    full_name: Optional[str] = None

class LoginStep1(BaseModel):
    email: EmailStr
    password: str

class VerifyOTP(BaseModel):
    email: EmailStr
    otp_code: str

class UserConfigUpdate(BaseModel):
    ui_config: str 

class UserInfoUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None

class ChangePasswordRequest(BaseModel):
    otp: str
    new_password: str

class UpdatePhoneRequest(BaseModel):
    phone: str
    current_password: str

# --- ROUTE ---
@app.get("/")
def read_root():
    return {"status": "live", "message": "Smart Fish Tank API is running via Brevo HTTP API!"}

@app.on_event("startup")
def on_startup():
    init_db()
    # Tạo Admin mặc định
    with Session(engine) as session:
        if not session.exec(select(User).where(User.username == "admin")).first():
            print("--- CREATING DEFAULT ADMIN ---")
            pwd = hash_password("1234")
            admin_config = {
                "theme": "default", 
                "widgets": ["all"], 
                "permissions": {"can_add": True, "can_control": True}
            }
            new_user = User(
                username="admin", 
                email="kk310412040404@gmail.com",
                hashed_password=pwd, 
                full_name="Administrator", 
                role="admin", 
                ui_config=json.dumps(admin_config),
                is_active=True 
            )
            session.add(new_user)
            session.commit()

# --- API ĐĂNG KÝ (Đã sửa để dùng API Brevo) ---
@app.post("/api/register")
async def register(user_data: UserRegister, background_tasks: BackgroundTasks):
    with Session(engine) as session:
        # 1. Kiểm tra tồn tại
        existing_user = session.exec(select(User).where((User.username == user_data.username) | (User.email == user_data.email))).first()
        if existing_user:
            if existing_user.is_active:
                raise HTTPException(status_code=400, detail="Username hoặc Email đã tồn tại")
            else:
                # Xóa user rác chưa kích hoạt
                otp_old = session.exec(select(OTP).where(OTP.email == existing_user.email)).first()
                if otp_old: session.delete(otp_old)
                session.delete(existing_user)
                session.commit()

        # 2. Tạo User mới
        default_config = {"theme": "default", "widgets": ["temp_chart"], "permissions": {"can_add": False, "can_control": False}}
        hashed_pwd = hash_password(user_data.password)
        
        new_user = User(
            username=user_data.username,
            email=user_data.email,
            hashed_password=hashed_pwd,
            full_name=user_data.full_name,
            role="user",
            ui_config=json.dumps(default_config),
            is_active=False
        )
        session.add(new_user)
        
        # 3. Tạo OTP
        otp_code = str(random.randint(100000, 999999))
        session.add(OTP(email=user_data.email, code=otp_code, expires_at=datetime.utcnow() + timedelta(minutes=5)))
        session.commit()

        # 4. Gửi Mail qua API (ĐOẠN NÀY ĐÃ SỬA)
        email_body = f"Mã OTP kích hoạt của bạn là: <b>{otp_code}</b>"
        background_tasks.add_task(send_email_via_brevo, user_data.email, "Kích hoạt tài khoản Bể Cá", email_body)

        return {"message": "Đăng ký thành công. Vui lòng kiểm tra email."}

# --- API LOGIN STEP 1 (Đã sửa session.get) ---
@app.post("/api/login/step1")
async def login_step1(data: LoginStep1, background_tasks: BackgroundTasks):
    with Session(engine) as session:
        # 1. Tìm User
        user = session.exec(select(User).where(User.email == data.email)).first()
        
        if not user or not verify_password(data.password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Email hoặc mật khẩu không đúng")
        
        if not user.is_active:
             raise HTTPException(status_code=403, detail="Tài khoản chưa được kích hoạt")

        # 2. Tạo OTP mới
        otp_code = "".join([str(random.randint(0, 9)) for _ in range(6)])
        
        # Xóa OTP cũ (Dùng select an toàn hơn get)
        existing_otp = session.exec(select(OTP).where(OTP.email == user.email)).first()
        if existing_otp:
            session.delete(existing_otp)
            
        new_otp = OTP(email=user.email, code=otp_code, expires_at=datetime.utcnow() + timedelta(minutes=5))
        session.add(new_otp)
        session.commit()
    
        # 3. Gửi Mail qua API
        email_body = f"""
        <h3>Mã xác thực đăng nhập</h3>
        <p>Xin chào {user.username},</p>
        <p>Mã OTP của bạn là: <b style='font-size:24px; color:#a855f7'>{otp_code}</b></p>
        <p>Mã có hiệu lực trong 5 phút.</p>
        """
        background_tasks.add_task(send_email_via_brevo, user.email, "Mã OTP Đăng Nhập", email_body)
    
        return {"message": "OTP sent", "email": user.email}

@app.post("/api/verify-otp")
def verify_otp_and_get_token(data: VerifyOTP):
    with Session(engine) as session:
        otp = session.exec(select(OTP).where(OTP.email == data.email)).first()
        if not otp or otp.code != data.otp_code:
            raise HTTPException(status_code=400, detail="OTP sai")
        if datetime.utcnow() > otp.expires_at:
            session.delete(otp); session.commit()
            raise HTTPException(status_code=400, detail="OTP hết hạn")
        
        user = session.exec(select(User).where(User.email == data.email)).first()
        if not user.is_active:
            user.is_active = True
            session.add(user)
        
        session.delete(otp)
        session.commit()
        
        token = create_access_token(subject=str(user.id))
        return {
            "access_token": token["access_token"],
            "username": user.username,
            "full_name": user.full_name,
            "role": user.role,
            "ui_config": user.ui_config
        }

@app.get("/api/users")
def get_all_users():
    with Session(engine) as session:
        users = session.exec(select(User)).all()
        return users

@app.put("/api/users/{user_id}/config")
def update_user_config(user_id: int, data: UserConfigUpdate):
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user: raise HTTPException(status_code=404)
        user.ui_config = data.ui_config
        session.add(user)
        session.commit()
        return {"message": "Config updated"}

@app.put("/api/users/{user_id}/info")
def update_user_info(user_id: int, info: UserInfoUpdate):
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user: raise HTTPException(status_code=404)
        
        if info.full_name is not None: user.full_name = info.full_name
        if info.phone is not None: user.phone = info.phone
        
        session.add(user)
        session.commit()
        return {"message": "Info updated"}

# API Gửi OTP Đổi Mật Khẩu (Đã sửa để dùng API Brevo)
@app.post("/api/users/{user_id}/request-password-otp")
async def request_password_otp(user_id: int, background_tasks: BackgroundTasks):
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")
        
        otp_code = str(random.randint(100000, 999999))
        
        # Xóa OTP cũ
        existing_otp = session.exec(select(OTP).where(OTP.email == user.email)).first()
        if existing_otp: session.delete(existing_otp)
        
        session.add(OTP(email=user.email, code=otp_code, expires_at=datetime.utcnow() + timedelta(minutes=5)))
        session.commit()

        # Gửi Mail qua API
        html_content = f"""
        <h3>Yêu cầu Đổi Mật Khẩu</h3>
        <p>Xin chào <b>{user.username}</b>,</p>
        <p>Mã xác thực (OTP) là:</p>
        <h2 style="color: #d946ef;">{otp_code}</h2>
        """
        background_tasks.add_task(send_email_via_brevo, user.email, "Mã OTP Đổi Mật Khẩu", html_content)
        
        return {"message": "OTP sent"}

@app.put("/api/users/{user_id}/change-password")
def change_password(user_id: int, data: ChangePasswordRequest):
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user: 
            raise HTTPException(status_code=404, detail="User not found")
        
        otp_record = session.exec(select(OTP).where(OTP.email == user.email)).first()
        if not otp_record:
             raise HTTPException(status_code=400, detail="Vui lòng lấy mã OTP trước")
        
        if otp_record.code != data.otp:
             raise HTTPException(status_code=400, detail="Mã OTP không chính xác")
        
        if datetime.utcnow() > otp_record.expires_at:
             raise HTTPException(status_code=400, detail="Mã OTP đã hết hạn")
             
        user.hashed_password = hash_password(data.new_password)
        session.add(user)
        
        session.delete(otp_record)
        session.commit()
        
        return {"message": "Đổi mật khẩu thành công"}
    
@app.delete("/api/users/{user_id}")
def delete_user(user_id: int):
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        if user.role == "admin":
             raise HTTPException(status_code=400, detail="Không thể xóa Admin")
             
        otp = session.exec(select(OTP).where(OTP.email == user.email)).first()
        if otp: session.delete(otp)
        
        session.delete(user)
        session.commit()
        return {"message": "User deleted"}

@app.get("/api/users/me")
def get_my_info(token: str = Depends(oauth2_scheme)): 
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid auth credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid auth credentials")

    with Session(engine) as session:
        user = session.get(User, int(user_id))
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user
    
@app.put("/api/users/{user_id}/update-phone-secure")
def update_phone_secure(user_id: int, data: UpdatePhoneRequest):
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        if not verify_password(data.current_password, user.hashed_password):
             raise HTTPException(status_code=400, detail="Mật khẩu xác nhận không đúng!")

        if not data.phone.isdigit() or len(data.phone) < 9:
             raise HTTPException(status_code=400, detail="Số điện thoại không hợp lệ")

        user.phone = data.phone
        session.add(user)
        session.commit()
        
        return {"message": "Phone updated securely"}
