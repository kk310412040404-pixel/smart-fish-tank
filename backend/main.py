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
from fastapi_mail import FastMail, MessageSchema, ConnectionConfig, MessageType

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

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/login")

# --- CẤU HÌNH GMAIL (Điền lại thông tin của bạn) ---
conf = ConnectionConfig(
    MAIL_USERNAME="ngytunkhoa311204n@gmail.com", # Email đăng ký Brevo
    MAIL_PASSWORD="xsmtpsib-0cc5f6ead11df511dcbcd12a6b6c8b0f258bd7ea95771bc1d43c9fe8911241d5-4vPfETdEtsHvaKXs",     # Mật khẩu SMTP của Brevo (Master Password)
    MAIL_FROM="kk310412040404@gmail.com",                  # Email người gửi (Vẫn là mail bạn)
    MAIL_PORT=587,
    MAIL_SERVER="smtp-relay.brevo.com",                    # Server của Brevo
    MAIL_STARTTLS=True,
    MAIL_SSL_TLS=False,
    USE_CREDENTIALS=True,
    VALIDATE_CERTS=False
)

## --- MODELS REQUEST ---
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
    ui_config: str  # Dành cho Admin cấu hình giao diện User

class UserInfoUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None

class ChangePasswordRequest(BaseModel):
    otp: str
    new_password: str

class UpdatePhoneRequest(BaseModel):
    phone: str
    current_password: str

# --- ROUTE KIỂM TRA SERVER ---
@app.get("/")
def read_root():
    return {"status": "live", "message": "Smart Fish Tank API is running correctly!"}

# --- CÁC API AUTH & USER ---

@app.on_event("startup")
def on_startup():
    init_db()
    # Tạo Admin mặc định nếu chưa có
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

# --- API AUTHENTICATION ---
@app.post("/api/register")
async def register(user_data: UserRegister, background_tasks: BackgroundTasks):
    with Session(engine) as session:
        # 1. Kiểm tra User đã tồn tại chưa
        existing_user = session.exec(select(User).where((User.username == user_data.username) | (User.email == user_data.email))).first()
        if existing_user:
            if existing_user.is_active:
                raise HTTPException(status_code=400, detail="Username hoặc Email đã tồn tại")
            else:
                # Nếu User tồn tại nhưng chưa kích hoạt -> Xóa OTP cũ & User cũ để tạo lại
                otp_old = session.exec(select(OTP).where(OTP.email == existing_user.email)).first()
                if otp_old: session.delete(otp_old)
                session.delete(existing_user)
                session.commit()

        # 2. Tạo User mới (Chưa kích hoạt)
        default_config = {"theme": "default", "widgets": ["temp_chart"], "permissions": {"can_add": False, "can_control": False}}
        hashed_pwd = hash_password(user_data.password)
        
        new_user = User(
            username=user_data.username,
            email=user_data.email,  # Lưu đúng email người dùng nhập
            hashed_password=hashed_pwd,
            full_name=user_data.full_name,
            role="user",
            ui_config=json.dumps(default_config),
            is_active=False
        )
        session.add(new_user)
        
        # 3. Tạo mã OTP
        otp_code = str(random.randint(100000, 999999))
        session.add(OTP(email=user_data.email, code=otp_code, expires_at=datetime.utcnow() + timedelta(minutes=5)))
        session.commit()

        # 4. Gửi Mail OTP (SỬA LẠI ĐÚNG NGƯỜI NHẬN)
        message = MessageSchema(
            subject="Kích hoạt tài khoản Bể Cá",
            recipients=[user_data.email],  # <--- QUAN TRỌNG: Phải là user_data.email
            body=f"Mã OTP kích hoạt của bạn là: {otp_code}",
            subtype=MessageType.plain
        )
        fm = FastMail(conf)
        background_tasks.add_task(fm.send_message, message)

        return {"message": "Đăng ký thành công. Vui lòng kiểm tra email của bạn."}

@app.post("/api/login/step1")
async def login_step1(data: LoginStep1, background_tasks: BackgroundTasks):
    with Session(engine) as session:
        # 1. Tìm User trong Database dựa vào Email nhập vào
        user = session.exec(select(User).where(User.email == data.email)).first()
        
        # 2. Kiểm tra thông tin
        if not user or not verify_password(data.password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Email hoặc mật khẩu không đúng")
        
        if not user.is_active:
             raise HTTPException(status_code=403, detail="Tài khoản chưa được kích hoạt")

        # 3. Tạo OTP đăng nhập mới
        otp_code = str(random.randint(100000, 999999))
        
        # Xóa OTP cũ nếu có
        old_otp = session.exec(select(OTP).where(OTP.email == user.email)).first()
        if old_otp: session.delete(old_otp)
            
        session.add(OTP(email=user.email, code=otp_code, expires_at=datetime.utcnow() + timedelta(minutes=5)))
        session.commit()

        # 4. Gửi Mail OTP (SỬA LẠI ĐÚNG NGƯỜI NHẬN)
        message = MessageSchema(
            subject="OTP Đăng nhập Hệ thống",
            recipients=[user.email], # <--- QUAN TRỌNG: Phải là user.email (lấy từ DB)
            body=f"Xin chào {user.username},\nMã OTP đăng nhập của bạn là: {otp_code}\nMã có hiệu lực trong 5 phút.",
            subtype=MessageType.plain
        )
        fm = FastMail(conf)
        background_tasks.add_task(fm.send_message, message)

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
            "full_name": user.full_name, # Trả về để client biết
            "role": user.role,
            "ui_config": user.ui_config
        }

# --- API QUẢN LÝ USER ---
@app.get("/api/users")
def get_all_users():
    with Session(engine) as session:
        users = session.exec(select(User)).all()
        return users # SQLModel tự convert sang JSON

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

#  API Gửi OTP để đổi mật khẩu (User phải bấm nút mới gửi)
@app.post("/api/users/{user_id}/request-password-otp")
async def request_password_otp(user_id: int, background_tasks: BackgroundTasks):
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")
        
        # Tạo OTP mới
        otp_code = str(random.randint(100000, 999999))
        
        # Xóa OTP cũ nếu có để tránh rác DB
        existing_otp = session.exec(select(OTP).where(OTP.email == user.email)).first()
        if existing_otp: session.delete(existing_otp)
        
        # Lưu OTP mới (Hết hạn sau 5 phút)
        session.add(OTP(email=user.email, code=otp_code, expires_at=datetime.utcnow() + timedelta(minutes=5)))
        session.commit()

        # Soạn Email
        html_content = f"""
        <h3>Yêu cầu Đổi Mật Khẩu</h3>
        <p>Xin chào <b>{user.username}</b>,</p>
        <p>Mã xác thực (OTP) để đổi mật khẩu của bạn là:</p>
        <h2 style="color: #d946ef; letter-spacing: 5px;">{otp_code}</h2>
        <p>Mã này có hiệu lực trong 5 phút. Vui lòng không chia sẻ cho người khác.</p>
        """
        
        message = MessageSchema(
            subject="Mã OTP Đổi Mật Khẩu",
            recipients=[user.email],
            body=html_content,
            subtype=MessageType.html
        )
        fm = FastMail(conf)
        background_tasks.add_task(fm.send_message, message)
        
        return {"message": "OTP sent"}

# API Thực hiện đổi mật khẩu
@app.put("/api/users/{user_id}/change-password")
def change_password(user_id: int, data: ChangePasswordRequest):
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user: 
            raise HTTPException(status_code=404, detail="User not found")
        
        # 1. Kiểm tra OTP
        otp_record = session.exec(select(OTP).where(OTP.email == user.email)).first()
        if not otp_record:
             raise HTTPException(status_code=400, detail="Vui lòng lấy mã OTP trước")
        
        if otp_record.code != data.otp:
             raise HTTPException(status_code=400, detail="Mã OTP không chính xác")
        
        if datetime.utcnow() > otp_record.expires_at:
             raise HTTPException(status_code=400, detail="Mã OTP đã hết hạn")
             
        # 2. Đổi mật khẩu (Hash mật khẩu mới)
        user.hashed_password = hash_password(data.new_password)
        session.add(user)
        
        # 3. Xóa OTP sau khi dùng xong
        session.delete(otp_record)
        session.commit()
        
        # Lưu ý: Không thu hồi Token cũ -> User vẫn đăng nhập bình thường
        return {"message": "Đổi mật khẩu thành công"}
    
@app.delete("/api/users/{user_id}")
def delete_user(user_id: int):
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Không cho phép xóa Admin
        if user.role == "admin":
             raise HTTPException(status_code=400, detail="Không thể xóa Admin")
             
        # Xóa OTP liên quan trước
        otp = session.exec(select(OTP).where(OTP.email == user.email)).first()
        if otp: session.delete(otp)
        
        session.delete(user)
        session.commit()
        return {"message": "User deleted"}

# --- API MỚI: LẤY THÔNG TIN CỦA CHÍNH MÌNH (Cho User) ---
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
        
        return {"message": "Phone updated securely"}
