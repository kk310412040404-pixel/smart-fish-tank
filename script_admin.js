// script_admin.js

// 1. Kiểm tra Auth
const token = localStorage.getItem('accessToken');
const role = localStorage.getItem('userRole');
const storedUsername = localStorage.getItem('currentUsername');

if (!token || role !== 'admin') {
    window.location.href = "index.html";
}

const API_URL = "https://smart-fish-tank.onrender.com/api";
let allUsers = [];
let editingUserId = null;
let myUserId = null;
let myCurrentConfig = {}; // Biến lưu cấu hình hiện tại của Admin (Theme, Widgets...)

// --- CORE: LẤY DỮ LIỆU & TỰ NHẬN DIỆN ---
async function fetchUsers() {
    try {
        const res = await fetch(`${API_URL}/users`, { headers: { 'Authorization': `Bearer ${token}` } });
        if(res.ok) {
            allUsers = await res.json();
            identifyAdmin(); // Tìm xem "Tôi là ai"
            renderHomeCards();
            renderProfileTable();
        }
    } catch (err) { console.error(err); }
}

fetchUsers();
setInterval(fetchUsers, 60000); 

// --- 2. LOGIC TÌM VÀ ĐIỀN THÔNG TIN ADMIN ---
function identifyAdmin() {
    let me = null;
    
    // Ưu tiên 1: Tìm theo username đã lưu lúc login
    if (storedUsername) {
        me = allUsers.find(u => u.username === storedUsername);
    }
    // Ưu tiên 2: Lấy user đầu tiên là Admin
    if (!me) {
        me = allUsers.find(u => u.role === 'admin');
    }

    if (me) {
        myUserId = me.id;
        
        // --- QUAN TRỌNG: Đọc Config để lấy Theme ---
        try {
            myCurrentConfig = JSON.parse(me.ui_config || "{}");
        } catch (e) { myCurrentConfig = {}; }
        
        // Nếu trong DB đã có theme -> Áp dụng ngay
        if (myCurrentConfig.theme) {
            applyThemeUI(myCurrentConfig.theme);
        }
        // ------------------------------------------

        fillMyInfo(me);
    }
}

function fillMyInfo(me) {
    if (document.activeElement.id !== 'st_fullname') {
        document.getElementById('st_fullname').value = me.full_name || me.username;
    }
    document.getElementById('st_role').value = me.role.toUpperCase();
    document.getElementById('st_username').value = me.username;
    document.getElementById('st_email').value = me.email;
    document.getElementById('st_phone').value = me.phone || ""; 
    document.getElementById('st_created').value = me.created_at ? me.created_at.split('T')[0] : "";

    // Cập nhật trạng thái Radio Button
    const hasPhone = (me.phone && me.phone.trim() !== "");
    const hint = document.getElementById('sec_hint');
    
    if (hasPhone) {
        if (!document.getElementById('sec_advanced').checked) {
            document.getElementById('sec_advanced').checked = true;
        }
        hint.innerText = "Đã bật xác thực 2 lớp.";
        hint.style.color = "#4ade80";
    } else {
        if (!document.getElementById('sec_normal').checked) {
            document.getElementById('sec_normal').checked = true;
        }
        hint.innerText = "Chế độ cơ bản.";
        hint.style.color = "#aaa";
    }
}

// --- 3. LOGIC ĐỔI THEME VÀ LƯU VÀO DATABASE ---
async function changeTheme(themeName) {
    // 1. Đổi giao diện ngay lập tức cho mượt
    applyThemeUI(themeName);
    
    // 2. Cập nhật vào biến Config
    myCurrentConfig.theme = themeName;

    // 3. Gửi API lưu xuống Database
    if (myUserId) {
        try {
            await fetch(`${API_URL}/users/${myUserId}/config`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify({ 
                    ui_config: JSON.stringify(myCurrentConfig) 
                })
            });
            console.log("Theme saved:", themeName);
        } catch (e) {
            console.error("Lỗi lưu theme:", e);
        }
    }
}

// Hàm phụ trợ: Chỉ xử lý việc đổi class CSS và active box
function applyThemeUI(themeName) {
    document.body.className = `theme-${themeName}`;
    
    // Xóa class selected ở tất cả các box
    document.querySelectorAll('.theme-box').forEach(b => b.classList.remove('selected'));
    
    // Thêm class selected vào box tương ứng
    const activeBox = document.querySelector(`.t-${themeName}`);
    if (activeBox) activeBox.classList.add('selected');
}

// --- 4. XỬ LÝ BẢO MẬT ---
function handleSecurityClick(value) {
    const currentPhone = document.getElementById('st_phone').value;
    
    if (value === 'advanced') {
        if (!currentPhone || currentPhone.trim() === "") {
            document.getElementById('sec_normal').checked = true;
            document.getElementById('sec_hint').innerText = "Chế độ cơ bản.";
            document.getElementById('sec_hint').style.color = "#aaa";
            openModal('rephone');
        } else {
            document.getElementById('sec_hint').innerText = "Đã bật xác thực 2 lớp.";
            document.getElementById('sec_hint').style.color = "#4ade80";
        }
    } else {
        document.getElementById('sec_hint').innerText = "Chế độ cơ bản.";
        document.getElementById('sec_hint').style.color = "#aaa";
    }
}

function forceDefaultSecurity() {
    document.getElementById('sec_normal').checked = true;
}

// --- 5. CÁC HÀM UPDATE INFO ---
async function updateAdminInfo() {
    if (!myUserId) return;
    const newName = document.getElementById('st_fullname').value.trim();
    await fetch(`${API_URL}/users/${myUserId}/info`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ full_name: newName })
    });
}

async function savePhoneNumber() {
    // Kiểm tra xem đã tải được ID người dùng chưa
    if (!myUserId) {
        showToast("Đang tải thông tin... Vui lòng thử lại sau giây lát!", "error");
        // Thử tìm lại Admin/User nếu bị null
        if(typeof identifyAdmin === 'function') identifyAdmin();
        if(typeof initUserApp === 'function') initUserApp();
        return;
    }

    // Lấy thẻ input
    const phoneInput = document.getElementById('new_phone');
    const passInput = document.getElementById('confirm_pass_for_phone');

    // Kiểm tra xem thẻ input có tồn tại trong HTML không
    if (!phoneInput) return showToast("Lỗi HTML: Không tìm thấy ô nhập SĐT (id='new_phone')", "error");
    if (!passInput) return showToast("Lỗi HTML: Không tìm thấy ô mật khẩu (id='confirm_pass_for_phone')", "error");

    const phone = phoneInput.value.trim();
    const password = passInput.value.trim();

    // Validate dữ liệu
    if (!phone) return showToast("Vui lòng nhập số điện thoại!", "error");
    if (!password) return showToast("Vui lòng nhập mật khẩu xác nhận!", "error");
    if (phone.length < 9 || isNaN(phone)) return showToast("Số điện thoại không hợp lệ!", "error");

    // Hiệu ứng nút bấm
    const btnSave = document.querySelector('#rephoneModal .btn-save');
    const originalText = btnSave.innerText;
    btnSave.innerText = "Đang lưu...";
    btnSave.disabled = true;

    try {
        const res = await fetch(`${API_URL}/users/${myUserId}/update-phone-secure`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ 
                phone: phone, 
                current_password: password 
            })
        });

        const data = await res.json();

        if (res.ok) {
            closeModal('rephoneModal');
            showToast("Cập nhật SĐT thành công!", "success");
            
            // Xóa mật khẩu đã nhập để bảo mật
            passInput.value = "";
            
            // Cập nhật giao diện
            const stPhone = document.getElementById('st_phone');
            if (stPhone) stPhone.value = phone;
            
            // Cập nhật biến dữ liệu local
            if (typeof myUserInfo !== 'undefined') myUserInfo.phone = phone; // Cho trang User
            
            // Bật radio Nâng cao
            const radioAdv = document.getElementById('sec_advanced');
            if(radioAdv) radioAdv.checked = true;
            
            const hint = document.getElementById('sec_hint');
            if(hint) {
                hint.innerText = "Đã bật xác thực 2 lớp.";
                hint.style.color = "#4ade80";
            }
            
            // Nếu là Admin thì reload list
            if(typeof fetchUsers === 'function') fetchUsers(); 

        } else {
            showToast(data.detail || "Mật khẩu không đúng!", "error");
        }
    } catch (e) {
        console.error(e);
        showToast("Lỗi kết nối Server!", "error");
    } finally {
        // Trả lại trạng thái nút
        btnSave.innerText = originalText;
        btnSave.disabled = false;
    }
}

// --- 6. RENDER GIAO DIỆN ---
function renderHomeCards() {
    const grid = document.getElementById('userGrid');
    grid.innerHTML = '';
    
    allUsers.forEach(u => {
        if(u.role === 'admin') return; 
        
        const card = document.createElement('div');
        card.className = 'user-card';
        card.innerHTML = `
            <div class="u-avatar">${u.username[0].toUpperCase()}</div>
            <div class="u-info" style="flex:1">
                <h4>${u.username}</h4>
                <p>${u.email}</p>
            </div>
            
            <button onclick="openBuilder(${u.id})" style="padding:8px 12px; background:#334155; border:1px solid #475569; color:white; border-radius:6px; cursor:pointer;" title="Thiết kế giao diện">
                <i class="fas fa-paint-brush" style="color:#a855f7"></i> Thiết kế
            </button>
        `;
        grid.appendChild(card);
    });
}

function openBuilder(uid) {
    // Mở trang builder.html trong tab mới
    window.open(`builder.html?uid=${uid}`, '_blank');
}

// ---  HÀM RENDER BẢNG CHI TIẾT (10 CỘT) ---
function renderProfileTable() {
    const tbody = document.querySelector('#userTable tbody');
    tbody.innerHTML = '';
    
    allUsers.forEach((u, index) => {
        // Parse cấu hình JSON
        let config = {};
        try { config = JSON.parse(u.ui_config || "{}"); } catch(e){}
        const perms = config.permissions || {};

        // A. Xử lý hiển thị Role
        const roleClass = (u.role === 'admin') ? 'role-admin' : 'role-user';
        
        // B. Xử lý hiển thị Trạng thái (Active/Inactive)
        const statusHtml = u.is_active 
            ? `<span class="status-dot st-active"></span> <span style="color:#4ade80">Hoạt động</span>` 
            : `<span class="status-dot st-inactive"></span> <span style="color:#ef4444">Chưa duyệt</span>`;
        
        // C. Xử lý hiển thị Ngày tháng
        let dateStr = "---";
        if (u.created_at) {
            const d = new Date(u.created_at);
            // Format ngày giờ Việt Nam
            dateStr = d.toLocaleDateString('vi-VN') + " " + d.toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'});
        }

        // D. Tạo dòng tr
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td style="font-weight:bold; color:#fff">${u.full_name || '---'}</td>
            <td><span class="role-badge ${roleClass}">${u.role.toUpperCase()}</span></td>
            <td>${u.username}</td>
            <td>${u.email}</td>
            
            <td>
                <div class="pass-wrapper" onclick="togglePass(this)">
                    <span class="p-text">••••••</span>
                    <i class="fas fa-eye"></i>
                </div>
            </td>

            <td>${dateStr}</td>
            <td>${statusHtml}</td>

            <td style="text-align: left;">
                <div style="display:flex; flex-direction:column; gap:6px; font-size:13px;">
                    <label style="cursor:pointer; display:flex; align-items:center; gap:5px;">
                        <input type="checkbox" ${perms.can_add ? 'checked' : ''} 
                               ${u.role === 'admin' ? 'disabled' : ''} 
                               onchange="updPerm(${u.id}, 'can_add', this.checked)"> 
                        Thêm thiết bị
                    </label>
                    <label style="cursor:pointer; display:flex; align-items:center; gap:5px;">
                        <input type="checkbox" ${perms.can_control ? 'checked' : ''} 
                               ${u.role === 'admin' ? 'disabled' : ''} 
                               onchange="updPerm(${u.id}, 'can_control', this.checked)"> 
                        Điều khiển
                    </label>
                </div>
            </td>

            <td>
                ${u.role !== 'admin' ? 
                `<button class="btn-delete" onclick="deleteUser(${u.id})" title="Xóa tài khoản">
                    <i class="fas fa-trash"></i>
                </button>` : 
                `<span style="opacity:0.3; font-size:20px;">-</span>`}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function updPerm(uid, key, val) {
    const user = allUsers.find(u => u.id === uid);
    let config = JSON.parse(user.ui_config || "{}");
    if(!config.permissions) config.permissions = {};
    config.permissions[key] = val;
    await fetch(`${API_URL}/users/${uid}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ui_config: JSON.stringify(config) })
    });
}

// ---  MODAL & UTILS ---
function showPage(pid) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pid).classList.add('active');
    document.querySelectorAll('.sidebar li').forEach(li => li.classList.remove('active'));
    event.currentTarget.classList.add('active');
}
function openConfigModal(id, name) {
    editingUserId = id;
    document.getElementById('cfg_target_user').innerText = name;
    document.getElementById('configModal').style.display = 'flex';
    const user = allUsers.find(u => u.id === id);
    let config = JSON.parse(user.ui_config || "{}");
    const ws = config.widgets || [];
    ['water','control','feeder','camera'].forEach(k => document.getElementById(`w_${k}`).checked = ws.includes(k));
}
async function saveUserInterface() {
    if(!editingUserId) return;
    const ws = [];
    ['water','control','feeder','camera'].forEach(k => { if(document.getElementById(`w_${k}`).checked) ws.push(k) });
    const user = allUsers.find(u => u.id === editingUserId);
    let config = JSON.parse(user.ui_config || "{}");
    config.widgets = ws;
    await fetch(`${API_URL}/users/${editingUserId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ui_config: JSON.stringify(config) })
    });
    closeModal('configModal');
    showToast("Đã lưu!");
}
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function openModal(id) { 
    document.querySelectorAll('.modal').forEach(m => m.style.display='none'); 
    document.getElementById(id+'Modal').style.display='flex'; 
}
function logout() { localStorage.clear(); window.location.href='index.html'; }


// --- LOGIC ĐỔI MẬT KHẨU (NEW) ---

// 1. Gửi yêu cầu lấy OTP
// --- LOGIC GỬI OTP (FIX UX: KHÔNG DÙNG showToast) ---
async function sendPasswordOTP() {
    if (!myUserId) return;
    
    const btn = document.getElementById('btnGetPassOTP');
    const msg = document.getElementById('otp_msg'); // Thẻ thông báo nhỏ
    
    // 1. Reset trạng thái UI
    msg.innerText = "";
    const originalText = "Lấy mã";
    
    // 2. Hiệu ứng đang gửi
    btn.innerText = "Đang gửi...";
    btn.disabled = true;
    btn.style.opacity = "0.7";
    btn.style.cursor = "wait";

    try {
        const res = await fetch(`${API_URL}/users/${myUserId}/request-password-otp`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            // === THÀNH CÔNG: XỬ LÝ NGAY LẬP TỨC ===
            
            // a. Hiện thông báo nhỏ màu xanh
            msg.innerText = "Đã gửi mã về Email!";
            msg.style.color = "#4ade80"; // Màu xanh lá
            
            // b. Bắt đầu đếm ngược NGAY LẬP TỨC (Không chờ user bấm OK)
            let count = 90;
            btn.innerText = `Gửi lại (${count}s)`;
            btn.style.background = "#475569"; // Đổi màu nút cho khác biệt xíu
            
            const interval = setInterval(() => {
                count--;
                btn.innerText = `Gửi lại (${count}s)`;
                
                if (count <= 0) {
                    clearInterval(interval);
                    // Reset lại nút khi hết giờ
                    btn.innerText = "Lấy mã";
                    btn.disabled = false;
                    btn.style.opacity = "1";
                    btn.style.cursor = "pointer";
                    btn.style.background = "#334155"; // Trả lại màu cũ
                    msg.innerText = ""; // Xóa thông báo
                }
            }, 1000);

        } else {
            // === LỖI ===
            msg.innerText = "Lỗi gửi mail. Thử lại sau.";
            msg.style.color = "#ef4444"; // Màu đỏ
            
            // Trả lại nút bình thường
            btn.innerText = originalText;
            btn.disabled = false;
            btn.style.opacity = "1";
            btn.style.cursor = "pointer";
        }
    } catch (e) {
        console.error(e);
        msg.innerText = "Lỗi kết nối!";
        msg.style.color = "#ef4444";
        btn.innerText = originalText;
        btn.disabled = false;
        btn.style.cursor = "pointer";
    }
}

// 2. Xác nhận đổi mật khẩu
async function doChangePassword() {
    const otp = document.getElementById('pass_otp').value.trim();
    const newPass = document.getElementById('new_pass').value.trim();
    const confirmPass = document.getElementById('confirm_new_pass').value.trim();

    // Validate
    if (!otp) return showToast("Vui lòng nhập mã OTP!");
    if (!newPass) return showToast("Vui lòng nhập mật khẩu mới!");
    if (newPass !== confirmPass) return showToast("Mật khẩu nhập lại không khớp!");
    if (newPass.length < 4) return showToast("Mật khẩu quá ngắn (tối thiểu 4 ký tự)!");

    const btnSave = document.querySelector('#repassModal .btn-save');
    const originalText = btnSave.innerText;
    btnSave.innerText = "Đang xử lý...";
    btnSave.disabled = true;

    try {
        const res = await fetch(`${API_URL}/users/${myUserId}/change-password`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ otp: otp, new_password: newPass })
        });

        const data = await res.json();

        if (res.ok) {
            showToast("Đổi mật khẩu thành công!");
            closeModal('repassModal');
            
            // Reset form
            document.getElementById('pass_otp').value = "";
            document.getElementById('new_pass').value = "";
            document.getElementById('confirm_new_pass').value = "";
            
            // Không gọi logout() -> Người dùng vẫn ở lại trang Admin
        } else {
            showToast(data.detail || "Mã OTP không đúng hoặc đã hết hạn.");
        }
    } catch (e) {
        console.error(e);
        showToast("Lỗi hệ thống.");
    } finally {
        btnSave.innerText = originalText;
        btnSave.disabled = false;
    }
}

// ---  HÀM ẨN/HIỆN MẬT KHẨU (UI Only) ---
function togglePass(el) {
    const txt = el.querySelector('.p-text');
    const icn = el.querySelector('i');
    
    // Logic: Nếu đang là chấm tròn -> Hiện chữ "(Đã mã hóa)"
    if (txt.innerText === "••••••") {
        txt.innerText = "(Đã mã hóa)"; 
        txt.style.fontSize = "11px";
        txt.style.color = "#a855f7"; // Màu tím
        icn.className = "fas fa-eye-slash";
    } else {
        txt.innerText = "••••••";
        txt.style.fontSize = "14px";
        txt.style.color = "#94a3b8";
        icn.className = "fas fa-eye";
    }
}

// ---  HÀM XÓA USER (GỌI API) ---
async function deleteUser(uid) {
    if(!confirm("CẢNH BÁO: Bạn có chắc chắn muốn xóa vĩnh viễn người dùng này không?")) return;
    
    try {
        const res = await fetch(`${API_URL}/users/${uid}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if(res.ok) {
            showToast("Đã xóa người dùng thành công!");
            fetchUsers(); // Tải lại danh sách
        } else {
            const data = await res.json();
            showToast(data.detail || "Lỗi khi xóa!");
        }
    } catch(e) { 
        console.error(e);
        showToast("Lỗi kết nối Server!"); 
    }
}


function showToast(message, type = 'success') {
    let box = document.getElementById('toast-box');
    
    // Nếu trong HTML quên chưa tạo thẻ div này, JS sẽ tự tạo luôn
    if (!box) {
        box = document.createElement('div');
        box.id = 'toast-box';
        document.body.appendChild(box);
    }

    // Tạo thẻ div thông báo
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    
    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;

    box.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);

}
