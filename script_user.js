// script_user.js

// 1. KIỂM TRA ĐĂNG NHẬP
const token = localStorage.getItem('accessToken');
if (!token) {
    window.location.href = "index.html";
}

const API_URL = "https://smart-fish-tank.onrender.com/api";
let myUserInfo = null;     
let myCurrentConfig = {};  

const MQTT_CONFIG = {
    host: "cf75b9d0de634a4fa170d772c1681ed5.s1.eu.hivemq.cloud",
    port: 8884, 
    protocol: "wss",
    username: "aquarium",   
    password: "Hieu123456", 
    clientId: "Web_User_" + Math.random().toString(16).substr(2, 8)
};

let mqttClient = null;
let grid = null;            // Đối tượng GridStack
let chartInstances = {};    // Lưu trữ biểu đồ
let topicMap = {};          // <--- ĐÂY LÀ BIẾN BỊ THIẾU GÂY LỖI
// --- 2. HÀM KHỞI TẠO ---
async function initUserApp() {
    try {
        const res = await fetch(`${API_URL}/users/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            myUserInfo = await res.json();
            
            // a. Config & Theme
            try { myCurrentConfig = JSON.parse(myUserInfo.ui_config || "{}"); } catch(e) { myCurrentConfig = {}; }
            if (myCurrentConfig.theme) applyThemeUI(myCurrentConfig.theme);

            // b. Điền thông tin Settings
            fillMySettings();

            // c. Khởi tạo biểu đồ (nếu có)
            if (typeof initMonitorPage === 'function') initMonitorPage();
        } else {
            localStorage.clear();
            window.location.href = "index.html";
        }
    } catch (err) { console.error(err); }
}

initUserApp(); 

// --- 3. LOGIC SETTINGS (Điền thông tin) ---
function fillMySettings() {
    // Chỉ chạy khi đang ở tab Settings
    const nameInput = document.getElementById('st_fullname');
    if (!nameInput) return;

    if (document.activeElement !== nameInput) {
        nameInput.value = myUserInfo.full_name || myUserInfo.username;
    }
    document.getElementById('st_role').value = myUserInfo.role.toUpperCase();
    document.getElementById('st_username').value = myUserInfo.username;
    document.getElementById('st_email').value = myUserInfo.email;
    document.getElementById('st_phone').value = myUserInfo.phone || "";
    
    if (myUserInfo.created_at) {
        document.getElementById('st_created').value = new Date(myUserInfo.created_at).toLocaleDateString('vi-VN');
    }

    const hasPhone = (myUserInfo.phone && myUserInfo.phone.trim() !== "");
    const hint = document.getElementById('sec_hint');
    if (hasPhone) {
        if (!document.getElementById('sec_advanced').checked) document.getElementById('sec_advanced').checked = true;
        if (hint) { hint.innerText = "Đã bật xác thực 2 lớp."; hint.style.color = "#4ade80"; }
    } else {
        if (!document.getElementById('sec_normal').checked) document.getElementById('sec_normal').checked = true;
        if (hint) { hint.innerText = "Chế độ cơ bản."; hint.style.color = "#aaa"; }
    }
}

// --- 4. LOGIC UPDATE INFO & THEME ---
async function updateUserInfo() {
    const newName = document.getElementById('st_fullname').value.trim();
    if (newName === myUserInfo.full_name) return;

    await fetch(`${API_URL}/users/${myUserInfo.id}/info`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ full_name: newName })
    });
    myUserInfo.full_name = newName;
    showToast("Đã cập nhật tên hiển thị", "success");
}

async function changeTheme(themeName) {
    applyThemeUI(themeName);
    myCurrentConfig.theme = themeName;
    await fetch(`${API_URL}/users/${myUserInfo.id}/config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ui_config: JSON.stringify(myCurrentConfig) })
    });
}

function applyThemeUI(themeName) {
    document.body.className = `theme-${themeName}`;
    document.querySelectorAll('.theme-box').forEach(b => b.classList.remove('selected'));
    const box = document.querySelector(`.t-${themeName}`);
    if (box) box.classList.add('selected');
}

// --- 5. LOGIC BẢO MẬT (PHONE & PASS) ---

// Xử lý click Radio Button
function handleSecurityClick(value) {
    const currentPhone = document.getElementById('st_phone').value;
    const hint = document.getElementById('sec_hint');

    if (value === 'advanced') {
        if (!currentPhone || currentPhone.trim() === "") {
            document.getElementById('sec_normal').checked = true;
            if(hint) { hint.innerText = "Chế độ cơ bản."; hint.style.color = "#aaa"; }
            // Mở modal nhập SĐT
            openModal('rephone'); 
        } else {
            if(hint) { hint.innerText = "Đã bật xác thực 2 lớp."; hint.style.color = "#4ade80"; }
        }
    } else {
        if(hint) { hint.innerText = "Chế độ cơ bản."; hint.style.color = "#aaa"; }
    }
}

function forceDefaultSecurity() { 
    document.getElementById('sec_normal').checked = true; 
}

// Lưu SĐT (Có check mật khẩu)
async function savePhoneNumber() {
    const phone = document.getElementById('new_phone').value.trim();
    const password = document.getElementById('confirm_pass_for_phone').value.trim();

    if (!phone) return showToast("Nhập số điện thoại!", "error");
    if (!password) return showToast("Nhập mật khẩu xác nhận!", "error");

    const btn = document.querySelector('#rephoneModal .btn-save');
    const oldText = btn.innerText;
    btn.innerText = "Đang lưu..."; btn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/users/${myUserInfo.id}/update-phone-secure`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ phone: phone, current_password: password })
        });

        const data = await res.json();

        if (res.ok) {
            closeModal('rephoneModal');
            showToast("Cập nhật thành công!", "success");
            
            document.getElementById('st_phone').value = phone;
            document.getElementById('confirm_pass_for_phone').value = "";
            myUserInfo.phone = phone;
            
            document.getElementById('sec_advanced').checked = true;
            const hint = document.getElementById('sec_hint');
            if(hint) { hint.innerText = "Đã bật xác thực 2 lớp."; hint.style.color = "#4ade80"; }
        } else {
            showToast(data.detail || "Mật khẩu sai!", "error");
        }
    } catch (e) {
        showToast("Lỗi kết nối!", "error");
    } finally {
        btn.innerText = oldText; btn.disabled = false;
    }
}

// Gửi OTP đổi mật khẩu
async function sendPasswordOTP() {
    const btn = document.getElementById('btnGetPassOTP');
    const msg = document.getElementById('otp_msg');
    const oldText = btn.innerText;
    
    msg.innerText = ""; 
    btn.innerText = "Đang gửi..."; btn.disabled = true; btn.style.opacity = "0.7";

    try {
        const res = await fetch(`${API_URL}/users/${myUserInfo.id}/request-password-otp`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            msg.innerText = "Đã gửi mã!"; msg.style.color = "#4ade80";
            let count = 60;
            const interval = setInterval(() => {
                count--; btn.innerText = `${count}s`;
                if (count <= 0) { 
                    clearInterval(interval); btn.innerText = "Lấy mã"; 
                    btn.disabled = false; btn.style.opacity = "1"; msg.innerText = "";
                }
            }, 1000);
        } else {
            msg.innerText = "Lỗi gửi mail."; msg.style.color = "#ef4444";
            btn.innerText = "Lấy mã"; btn.disabled = false;
        }
    } catch(e) { 
        btn.innerText = "Lấy mã"; btn.disabled = false;
    }
}

// Đổi mật khẩu
async function doChangePassword() {
    const otp = document.getElementById('pass_otp').value.trim();
    const newPass = document.getElementById('new_pass').value.trim();
    const confirmPass = document.getElementById('confirm_new_pass').value.trim();

    if(!otp || !newPass) return showToast("Nhập đủ thông tin!", "error");
    if(newPass !== confirmPass) return showToast("Mật khẩu không khớp!", "error");

    const btn = document.querySelector('#repassModal .btn-save');
    btn.innerText = "Đang xử lý..."; btn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/users/${myUserInfo.id}/change-password`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ otp: otp, new_password: newPass })
        });
        if(res.ok) { 
            showToast("Đổi mật khẩu thành công!", "success"); 
            closeModal('repassModal'); 
            // Reset form
            document.getElementById('pass_otp').value = "";
            document.getElementById('new_pass').value = "";
            document.getElementById('confirm_new_pass').value = "";
        } else { 
            const d = await res.json();
            showToast(d.detail || "Sai mã OTP!", "error"); 
        }
    } catch (e) { showToast("Lỗi hệ thống", "error"); }
    finally { btn.innerText = "Lưu"; btn.disabled = false; }
}

// --- 6. HÀM TIỆN ÍCH (UTILS) ---

// Chuyển trang Tab
function showPage(pid) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pid);
    if(target) target.classList.add('active');
    
    document.querySelectorAll('.sidebar li').forEach(li => li.classList.remove('active'));
    if(event && event.currentTarget) event.currentTarget.classList.add('active');
    
    if (pid === 'settings') fillMySettings();
}

// MỞ MODAL (Đã sửa để thông minh hơn)
function openModal(name) { 
    // Ẩn tất cả modal khác trước
    document.querySelectorAll('.modal').forEach(m => m.style.display='none'); 
    
    // Tìm modal: Nếu user truyền 'repass' -> tìm 'repass' trước, không thấy thì tìm 'repassModal'
    let modal = document.getElementById(name);
    if(!modal) modal = document.getElementById(name + 'Modal');
    
    if(modal) {
        modal.style.display='flex'; 
    } else {
        console.error("Không tìm thấy modal ID: " + name);
        showToast("Lỗi: Không tìm thấy cửa sổ " + name, "error");
    }
}

function closeModal(id) { 
    const m = document.getElementById(id);
    if(m) m.style.display = 'none'; 
}

function logout() {
    localStorage.clear();
    window.location.href = 'index.html';
}

// HIỂN THỊ THÔNG BÁO (Tự tạo khung nếu thiếu)
function showToast(message, type = 'success') {
    let box = document.getElementById('toast-box');
    if (!box) { 
        box = document.createElement('div'); 
        box.id = 'toast-box'; 
        document.body.appendChild(box); 
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    box.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}


// --- 8. PHẦN RENDER DASHBOARD (QUAN TRỌNG: VẼ GIAO DIỆN TỪ CONFIG) ---
// --- HÀM VẼ GIAO DIỆN (QUAN TRỌNG) ---

function initMonitorPage() {
    const monitorSection = document.querySelector('#monitor');
    
    // 1. Reset vùng chứa và hiển thị tiêu đề
    monitorSection.innerHTML = `<h3>Giám sát hệ thống</h3><div class="grid-stack"></div>`;
    
    // 2. Kiểm tra dữ liệu cấu hình
    if (!myCurrentConfig.widgets || myCurrentConfig.widgets.length === 0) {
        monitorSection.innerHTML += `<p style="color:#ccc; text-align:center; margin-top:50px">Chưa có thiết bị nào. Vui lòng liên hệ Admin (Builder) để lưu cấu hình.</p>`;
        return;
    }

    // 3. Khởi tạo Gridstack (Lưới giao diện)
    grid = GridStack.init({
        staticGrid: true, // User không được kéo thả
        column: 12,
        cellHeight: 100,
        margin: 10,
        disableOneColumnMode: false
    }, document.querySelector('.grid-stack'));

    // 4. Duyệt qua từng Widget để vẽ lên màn hình
    myCurrentConfig.widgets.forEach(w => {
        // --- A. Lấy Topic MQTT từ cấu hình (Admin nhập) ---
        const topic = w.config ? w.config.key : ""; // Lấy topic, ví dụ: "aquarium/temp"
        
        // Lưu vào bản đồ topicMap để khi có tin nhắn MQTT thì biết update cho widget nào
        if (topic) {
            if (!topicMap[topic]) topicMap[topic] = [];
            topicMap[topic].push(w.id);
        }

        // --- B. Tạo HTML và Thêm vào lưới (QUAN TRỌNG: Không được xóa đoạn này) ---
        const contentHTML = generateWidgetContent(w);
        
        grid.addWidget({
            x: w.x, y: w.y, w: w.w, h: w.h,
            content: contentHTML,
            id: w.id
        });

        // --- C. Vẽ biểu đồ nếu là widget chart/temp ---
        if (w.type === 'chart' || w.type === 'temp') {
            renderChart(w.id, w.dataType);
        }
    });

    // 5. Sau khi vẽ xong giao diện thì mới kết nối MQTT
    if (typeof connectMQTT === 'function') {
        connectMQTT();
    } else {
        console.warn("Chưa có hàm connectMQTT, vui lòng thêm vào script_user.js");
    }
}

// Hàm tạo HTML nội dung Card
function generateWidgetContent(w) {
    let inner = '';
    let icon = 'cube';
    let color = 'var(--primary)';

    // Icon tiêu đề
    if (w.type === 'temp') { icon = 'thermometer-half'; color = '#f87171'; }
    if (w.type === 'switch') { icon = 'toggle-on'; color = '#4ade80'; }
    if (w.type === 'camera') { icon = 'video'; color = '#60a5fa'; }

    // Nội dung chính
    if (w.type === 'chart' || w.type === 'temp') {
        inner = `<div class="widget-body"><canvas id="chart_${w.id}"></canvas></div>`;
    } 
    else if (w.type === 'switch') {
        inner = `
            <div class="widget-body" style="flex-direction:column;">
                <i class="fas fa-power-off" style="font-size:40px; color:#4ade80; cursor:pointer; margin-bottom:10px;" 
                   onclick="toggleDevice('${w.id}', this)"></i>
                <span style="font-size:18px; font-weight:bold; color:#fff">ĐANG BẬT</span>
            </div>
        `;
    }
    else if (w.type === 'camera') {
        inner = `
            <div class="widget-body" style="background:black; border-radius:8px; position:relative; overflow:hidden; width:100%; height:100%;">
                <span style="position:absolute; top:5px; right:5px; background:red; color:white; padding:2px 5px; font-size:10px; border-radius:3px; animation:blink 1s infinite;">LIVE</span>
                <i class="fas fa-play-circle" style="font-size:40px; color:rgba(255,255,255,0.5)"></i>
            </div>
        `;
    }

    // Trả về khung HTML
    return `
        <div class="widget-content">
            <div class="widget-header">
                <i class="fas fa-${icon}" style="color:${color}"></i>
                <h4 style="margin:0; font-size:14px; text-transform:uppercase;">${w.title || 'Widget'}</h4>
            </div>
            ${inner}
        </div>
    `;
}

// Hàm vẽ biểu đồ (Giả lập dữ liệu để demo)
function renderChart(id, type) {
    setTimeout(() => { 
        const ctx = document.getElementById(`chart_${id}`);
        if (!ctx) return;

        // Xóa biểu đồ cũ nếu có (tránh lỗi vẽ chồng)
        if (chartInstances[id]) {
            chartInstances[id].destroy();
        }

        // Tạo biểu đồ mới và LƯU VÀO chartInstances
        chartInstances[id] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [], // Bắt đầu rỗng
                datasets: [{
                    label: 'Giá trị',
                    data: [], // Bắt đầu rỗng
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168, 85, 247, 0.2)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { 
                    x: { display: true }, // Hiện trục thời gian
                    y: { grid: { color: '#334155' } } 
                }
            }
        });
    }, 100);
}

// Hàm bật tắt thiết bị
function toggleDevice(id, btn) {
    // Tìm Topic của widget này
    // Lưu ý: Đây là cách tìm ngược từ ID ra Topic. 
    // Để đơn giản, ta duyệt topicMap
    let targetTopic = "";
    for (const [t, ids] of Object.entries(topicMap)) {
        if (ids.includes(id)) {
            targetTopic = t; 
            break;
        }
    }

    if (!targetTopic) {
        showToast("Chưa cấu hình Topic cho nút này!", "error");
        return;
    }

    // Xác định trạng thái muốn gửi
    const isCurrentlyOn = (btn.style.color === "rgb(74, 222, 128)" || btn.style.color === "#4ade80");
    const msg = isCurrentlyOn ? "OFF" : "ON"; // Đảo trạng thái

    // Gửi lệnh MQTT
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish(targetTopic, msg);
        showToast(`Đã gửi lệnh: ${msg}`, "success");
        
        // (Tùy chọn) Cập nhật UI ngay lập tức để phản hồi nhanh
        // updateWidgetVal(id, msg); 
    } else {
        showToast("Mất kết nối MQTT!", "error");
    }
}

//MQTT
function connectMQTT() {
    console.log("Đang kết nối MQTT...", MQTT_CONFIG.host);
    const { host, port, protocol, username, password, clientId } = MQTT_CONFIG;
    
    // Tạo URL kết nối (WSS cho trình duyệt)
    const connectUrl = `${protocol}://${host}:${port}/mqtt`;

    mqttClient = mqtt.connect(connectUrl, {
        clientId, username, password, 
        clean: true, 
        reconnectPeriod: 5000 
    });

    mqttClient.on('connect', () => {
        console.log(" MQTT Connected!");
        showToast("Đã kết nối Server", "success");
        
        // Đăng ký (Subscribe) tất cả các topic có trong Config
        for (const topic in topicMap) {
            console.log("Subscribing to:", topic);
            mqttClient.subscribe(topic);
        }
    });

    mqttClient.on('message', (topic, payload) => {
        const msgString = payload.toString();
        // console.log("Nhận:", topic, msgString);

        // Tìm xem Widget nào cần cập nhật
        if (topicMap[topic]) {
            topicMap[topic].forEach(widgetId => {
                updateWidgetVal(widgetId, msgString);
            });
        }
    });
}


function updateWidgetVal(id, value) {
    // 1. Xử lý Biểu đồ
    if (chartInstances[id]) {
        const chart = chartInstances[id];
        const now = new Date().toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
        
        // Thêm dữ liệu mới
        chart.data.labels.push(now);
        chart.data.datasets[0].data.push(parseFloat(value));

        // Giới hạn chỉ hiện 10 điểm dữ liệu gần nhất (để không bị rối)
        if (chart.data.labels.length > 10) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }
        chart.update();
    }
    
    // 2. Xử lý Công tắc (Switch) & Text
    // Tìm element hiển thị text (nếu có)
    // Cập nhật trạng thái nút bấm
    const btnIcon = document.querySelector(`.widget-content[gs-id="${id}"] .fa-power-off`);
    if (btnIcon) {
        if (value.toUpperCase() === "ON") {
            btnIcon.style.color = "#4ade80"; // Xanh
        } else {
            btnIcon.style.color = "#ef4444"; // Đỏ
        }
    }
}



