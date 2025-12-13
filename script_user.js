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
// Thay đổi: Dùng 2 lưới riêng biệt
let gridMonitor = null;     
let gridControl = null;     
let chartInstances = {};    
let topicMap = {};          

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

            // c. Khởi tạo Dashboard (Hàm mới)
            if (typeof initDashboard === 'function') initDashboard();

        } else {
            localStorage.clear();
            window.location.href = "index.html";
        }
    } catch (err) { console.error(err); }
}

initUserApp(); 

// --- 3. LOGIC GRID & DASHBOARD (ĐÃ NÂNG CẤP) ---

function initDashboard() {
    console.log("Khởi tạo Dashboard đa trang...");
    
    // 1. Phân loại dữ liệu (Tương thích ngược)
    let pagesData = { monitor: [], control: [] };
    
    if (myCurrentConfig.widgets) {
        // Nếu là data cũ (chưa chia trang) -> Gán hết vào Monitor
        pagesData.monitor = myCurrentConfig.widgets;
    } else if (myCurrentConfig.pages) {
        // Nếu là data mới
        pagesData.monitor = myCurrentConfig.pages.monitor || [];
        pagesData.control = myCurrentConfig.pages.control || [];
    }

    // 2. Khởi tạo Grid Giám Sát (Chế độ 'view')
    const elMon = document.querySelector('#grid-monitor');
    if (elMon) {
        elMon.innerHTML = ""; 
        gridMonitor = GridStack.init({ 
            staticGrid: true, margin: 10, column: 12, disableOneColumnMode: false 
        }, elMon);
        renderWidgetsToGrid(gridMonitor, pagesData.monitor, 'view');
    }

    // 3. Khởi tạo Grid Điều Khiển (Chế độ 'control')
    const elCon = document.querySelector('#grid-control');
    if (elCon) {
        elCon.innerHTML = "";
        gridControl = GridStack.init({ 
            staticGrid: true, margin: 10, column: 12, disableOneColumnMode: false 
        }, elCon);
        renderWidgetsToGrid(gridControl, pagesData.control, 'control');
    }

    // 4. Kết nối MQTT (Chỉ cần gọi 1 lần cho cả app)
    connectMQTT();
}

// Hàm vẽ widget lên lưới cụ thể
function renderWidgetsToGrid(gridInstance, widgets, mode) {
    if (!widgets) return;

    widgets.forEach(w => {
        // Đăng ký Topic vào Map để nhận MQTT
        const topic = w.config ? w.config.key : ""; 
        if (topic) {
            if (!topicMap[topic]) topicMap[topic] = [];
            // Tránh trùng lặp ID trong map nếu widget xuất hiện ở cả 2 tab (hiếm nhưng có thể)
            if (!topicMap[topic].includes(w.id)) {
                topicMap[topic].push(w.id);
            }
        }

        // Tạo HTML: 'view' (chỉ xem) hoặc 'control' (bấm được)
        const html = generateWidgetContent(w, mode);
        
        gridInstance.addWidget({
            x: w.x, y: w.y, w: w.w, h: w.h,
            content: html,
            id: w.id
        });

        // Vẽ biểu đồ nếu là widget chart/temp (thường chỉ ở tab View)
        if (w.type === 'chart' || w.type === 'temp') {
            renderChart(w.id, w.dataType);
        }
    });
}

// Hàm tạo HTML nội dung Card (Xử lý giao diện 2 chế độ)
function generateWidgetContent(w, mode) {
    let inner = '';
    let icon = 'cube';
    let color = 'var(--primary)';
    
    // Lấy tên hiển thị
    const label = w.config && w.config.label ? w.config.label : (w.title || 'Widget');

    // === 1. LOGIC SWITCH (QUAN TRỌNG) ===
    if (w.type === 'switch') {
        icon = 'toggle-on'; color = '#4ade80';
        
        if (mode === 'control') {
            // [TRANG ĐIỀU KHIỂN]: Nút bấm to, click được
            inner = `
                <div class="widget-body" style="flex-direction:column;">
                    <i class="fas fa-power-off btn-switch" 
                       style="font-size:40px; color:#ef4444; cursor:pointer; transition:0.2s;" 
                       onclick="toggleDevice('${w.id}', this)"></i>
                    <span class="status-text" style="font-size:16px; margin-top:10px; font-weight:bold;">OFF</span>
                </div>
            `;
        } else {
            // [TRANG GIÁM SÁT]: Đèn báo trạng thái, KHÔNG click
            inner = `
                <div class="widget-body" style="flex-direction:row; gap:15px;">
                    <div class="status-indicator" style="width:20px; height:20px; border-radius:50%; background:#ef4444; box-shadow:0 0 5px #ef4444; transition:0.3s;"></div>
                    <span class="status-text" style="font-size:20px; font-weight:bold;">OFF</span>
                </div>
                <div style="font-size:12px; color:#94a3b8; margin-top:5px; text-align:center;">(Trạng thái)</div>
            `;
        }
    }
    
    // === 2. CÁC LOẠI KHÁC ===
    else if (w.type === 'temp') {
        icon = 'thermometer-half'; color = '#f87171';
        inner = `<div class="widget-body"><canvas id="chart_${w.id}"></canvas></div>`;
    }
    else if (w.type === 'camera') {
        icon = 'video'; color = '#60a5fa';
        inner = `
            <div class="widget-body" style="background:black; position:relative; width:100%; height:100%; overflow:hidden; border-radius:8px;">
                <span style="position:absolute; top:5px; right:5px; background:red; color:white; font-size:10px; padding:2px 5px; border-radius:3px; animation:blink 1s infinite;">LIVE</span>
                <i class="fas fa-play-circle" style="font-size:40px; color:rgba(255,255,255,0.5)"></i>
            </div>
        `;
    }

    return `
        <div class="widget-content" gs-id="${w.id}" data-type="${w.type}">
            <div class="widget-header">
                <i class="fas fa-${icon}" style="color:${color}"></i>
                <h4>${label}</h4>
            </div>
            ${inner}
        </div>
    `;
}

// Hàm vẽ biểu đồ
function renderChart(id, type) {
    setTimeout(() => { 
        const ctx = document.getElementById(`chart_${id}`);
        if (!ctx) return;

        if (chartInstances[id]) chartInstances[id].destroy();

        chartInstances[id] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [], 
                datasets: [{
                    label: 'Giá trị', data: [],
                    borderColor: '#a855f7', backgroundColor: 'rgba(168, 85, 247, 0.2)',
                    fill: true, tension: 0.4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { display: true }, y: { grid: { color: '#334155' } } }
            }
        });
    }, 100);
}

// --- 4. LOGIC MQTT & CẬP NHẬT DỮ LIỆU ---

function connectMQTT() {
    console.log("Đang kết nối MQTT...", MQTT_CONFIG.host);
    const { host, port, protocol, username, password, clientId } = MQTT_CONFIG;
    const connectUrl = `${protocol}://${host}:${port}/mqtt`;

    mqttClient = mqtt.connect(connectUrl, { clientId, username, password, clean: true, reconnectPeriod: 5000 });

    mqttClient.on('connect', () => {
        console.log("✅ MQTT Connected!");
        showToast("Đã kết nối Server", "success");
        for (const topic in topicMap) {
            mqttClient.subscribe(topic);
        }
    });

    mqttClient.on('message', (topic, payload) => {
        const msgString = payload.toString();
        // Tìm xem Topic này thuộc về những Widget ID nào
        if (topicMap[topic]) {
            topicMap[topic].forEach(widgetId => {
                updateWidgetVal(widgetId, msgString);
            });
        }
    });
}

// Hàm cập nhật giao diện (Đồng bộ cả Tab Monitor & Control)
function updateWidgetVal(id, value) {
    // 1. Chart (Nếu có)
    if (chartInstances[id]) {
        const chart = chartInstances[id];
        const now = new Date().toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'});
        
        chart.data.labels.push(now);
        chart.data.datasets[0].data.push(parseFloat(value));
        if (chart.data.labels.length > 10) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }
        chart.update();
    }
    
    // 2. Switch (Cập nhật cho TẤT CẢ widget có cùng ID trên màn hình)
    // Lưu ý: Có thể widget này xuất hiện ở cả 2 tab (nếu admin cấu hình vậy), hoặc chỉ 1.
    // Chúng ta dùng querySelectorAll để bắt hết.
    const widgetEls = document.querySelectorAll(`.widget-content[gs-id="${id}"]`);
    
    widgetEls.forEach(el => {
        const type = el.getAttribute('data-type');
        if (type === 'switch') {
            // Chuẩn hóa giá trị ON/OFF
            const isOn = (value.toUpperCase() === "ON" || value == "1");

            // a. Cập nhật Chữ
            const statusText = el.querySelector('.status-text');
            if (statusText) statusText.innerText = isOn ? "ON" : "OFF";

            // b. Cập nhật Nút bấm (Ở Tab Control)
            const btnIcon = el.querySelector('.btn-switch');
            if (btnIcon) {
                btnIcon.style.color = isOn ? "#4ade80" : "#ef4444";
            }

            // c. Cập nhật Đèn báo (Ở Tab Monitor)
            const indicator = el.querySelector('.status-indicator');
            if (indicator) {
                indicator.style.background = isOn ? "#4ade80" : "#ef4444";
                indicator.style.boxShadow = isOn ? "0 0 10px #4ade80" : "0 0 5px #ef4444";
            }
        }
    });
}

// Gửi lệnh điều khiển
function toggleDevice(id, btn) {
    // Tìm Topic MQTT của widget này
    let targetTopic = "";
    for (const [t, ids] of Object.entries(topicMap)) {
        if (ids.includes(id)) { targetTopic = t; break; }
    }

    if (!targetTopic) return showToast("Lỗi: Chưa có Topic!", "error");

    // Lấy trạng thái hiện tại dựa trên màu nút
    const isCurrentlyOn = (btn.style.color === "rgb(74, 222, 128)" || btn.style.color === "#4ade80");
    const msg = isCurrentlyOn ? "OFF" : "ON";

    if (mqttClient && mqttClient.connected) {
        mqttClient.publish(targetTopic, msg);
        showToast(`Gửi lệnh: ${msg}`, "success");
    } else {
        showToast("Mất kết nối MQTT!", "error");
    }
}


// --- 5. LOGIC SETTINGS & UTILS (Giữ nguyên) ---

function showPage(pid) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pid);
    if(target) target.classList.add('active');
    
    document.querySelectorAll('.sidebar li').forEach(li => li.classList.remove('active'));
    if(event && event.currentTarget) event.currentTarget.classList.add('active');
    
    if (pid === 'settings') fillMySettings();
}

function fillMySettings() {
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

function handleSecurityClick(value) {
    const currentPhone = document.getElementById('st_phone').value;
    const hint = document.getElementById('sec_hint');
    if (value === 'advanced') {
        if (!currentPhone || currentPhone.trim() === "") {
            document.getElementById('sec_normal').checked = true;
            if(hint) { hint.innerText = "Chế độ cơ bản."; hint.style.color = "#aaa"; }
            openModal('rephone'); 
        } else {
            if(hint) { hint.innerText = "Đã bật xác thực 2 lớp."; hint.style.color = "#4ade80"; }
        }
    } else {
        if(hint) { hint.innerText = "Chế độ cơ bản."; hint.style.color = "#aaa"; }
    }
}
function forceDefaultSecurity() { document.getElementById('sec_normal').checked = true; }

async function savePhoneNumber() {
    const phone = document.getElementById('new_phone').value.trim();
    const password = document.getElementById('confirm_pass_for_phone').value.trim();
    if (!phone) return showToast("Nhập số điện thoại!", "error");
    if (!password) return showToast("Nhập mật khẩu xác nhận!", "error");

    const btn = document.querySelector('#rephoneModal .btn-save');
    const oldText = btn.innerText; btn.innerText = "Đang lưu..."; btn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/users/${myUserInfo.id}/update-phone-secure`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ phone: phone, current_password: password })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('rephoneModal'); showToast("Cập nhật thành công!", "success");
            document.getElementById('st_phone').value = phone; document.getElementById('confirm_pass_for_phone').value = "";
            myUserInfo.phone = phone;
            document.getElementById('sec_advanced').checked = true;
            const hint = document.getElementById('sec_hint');
            if(hint) { hint.innerText = "Đã bật xác thực 2 lớp."; hint.style.color = "#4ade80"; }
        } else { showToast(data.detail || "Mật khẩu sai!", "error"); }
    } catch (e) { showToast("Lỗi kết nối!", "error"); } 
    finally { btn.innerText = oldText; btn.disabled = false; }
}

async function sendPasswordOTP() {
    const btn = document.getElementById('btnGetPassOTP');
    const msg = document.getElementById('otp_msg');
    msg.innerText = ""; btn.innerText = "Đang gửi..."; btn.disabled = true; btn.style.opacity = "0.7";
    try {
        const res = await fetch(`${API_URL}/users/${myUserInfo.id}/request-password-otp`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            msg.innerText = "Đã gửi mã!"; msg.style.color = "#4ade80";
            let count = 60;
            const interval = setInterval(() => {
                count--; btn.innerText = `${count}s`;
                if (count <= 0) { clearInterval(interval); btn.innerText = "Lấy mã"; btn.disabled = false; btn.style.opacity = "1"; msg.innerText = ""; }
            }, 1000);
        } else { msg.innerText = "Lỗi gửi mail."; msg.style.color = "#ef4444"; btn.innerText = "Lấy mã"; btn.disabled = false; }
    } catch(e) { btn.innerText = "Lấy mã"; btn.disabled = false; }
}

async function doChangePassword() {
    const otp = document.getElementById('pass_otp').value.trim();
    const newPass = document.getElementById('new_pass').value.trim();
    const confirmPass = document.getElementById('confirm_new_pass').value.trim();

    if(!otp || !newPass) return showToast("Nhập đủ thông tin!", "error");
    if(newPass !== confirmPass) return showToast("Mật khẩu không khớp!", "error");

    const btn = document.querySelector('#repassModal .btn-save'); btn.innerText = "Đang xử lý..."; btn.disabled = true;
    try {
        const res = await fetch(`${API_URL}/users/${myUserInfo.id}/change-password`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ otp: otp, new_password: newPass })
        });
        if(res.ok) { 
            showToast("Đổi mật khẩu thành công!", "success"); closeModal('repassModal'); 
            document.getElementById('pass_otp').value = ""; document.getElementById('new_pass').value = ""; document.getElementById('confirm_new_pass').value = "";
        } else { const d = await res.json(); showToast(d.detail || "Sai mã OTP!", "error"); }
    } catch (e) { showToast("Lỗi hệ thống", "error"); }
    finally { btn.innerText = "Lưu"; btn.disabled = false; }
}

function openModal(name) { 
    document.querySelectorAll('.modal').forEach(m => m.style.display='none'); 
    let modal = document.getElementById(name);
    if(!modal) modal = document.getElementById(name + 'Modal');
    if(modal) modal.style.display='flex'; 
    else showToast("Lỗi: Không tìm thấy cửa sổ " + name, "error");
}
function closeModal(id) { const m = document.getElementById(id); if(m) m.style.display = 'none'; }
function logout() { localStorage.clear(); window.location.href = 'index.html'; }
function showToast(message, type = 'success') {
    let box = document.getElementById('toast-box');
    if (!box) { box = document.createElement('div'); box.id = 'toast-box'; document.body.appendChild(box); }
    const toast = document.createElement('div'); toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    box.appendChild(toast); setTimeout(() => toast.remove(), 3000);
}

// --- LOGIC CHO MENU MOBILE ---

function toggleMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    
    // Thêm hoặc bỏ class 'show' để kích hoạt CSS
    sidebar.classList.toggle('show');
    overlay.classList.toggle('show');
}

// Tự động đóng Sidebar khi bấm vào một mục menu (UX tốt hơn)
document.addEventListener("DOMContentLoaded", function() {
    const menuItems = document.querySelectorAll('.sidebar ul li');
    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            // Chỉ đóng nếu đang ở giao diện mobile
            if (window.innerWidth <= 768) {
                toggleMobileSidebar();
            }
        });
    });
});
