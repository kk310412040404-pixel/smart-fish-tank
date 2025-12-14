// script_builder.js - PHIÊN BẢN CẬP NHẬT HỖ TRỢ CAMERA STREAM & 2 TAB

const urlParams = new URLSearchParams(window.location.search);
const targetUserId = urlParams.get('uid');
const token = localStorage.getItem('accessToken');
const API_URL = "https://smart-fish-tank.onrender.com/api";

let grid = null; 

// --- CẤU HÌNH QUẢN LÝ TRANG ---
let currentTab = 'monitor'; // Trang hiện tại đang sửa (monitor hoặc control)
let dashboardConfig = { 
    monitor: [], 
    control: [] 
}; 

// Biến tạm lưu config của từng widget (Label, Topic...)
let widgetConfigs = {}; 

// ============================================================
// 1. KHỞI TẠO
// ============================================================
async function init() {
    if (!token || !targetUserId) {
        alert("Không có quyền truy cập!");
        return;
    }

    // Khởi tạo Gridstack
    grid = GridStack.init({
        column: 12, cellHeight: 100, margin: 10, float: true,
        disableResize: false, disableDrag: false, animate: true
    });

    try {
        const res = await fetch(`${API_URL}/users`, { headers: { 'Authorization': `Bearer ${token}` } });
        if(res.ok) {
            const users = await res.json();
            const u = users.find(x => x.id == targetUserId);
            if(u) {
                document.getElementById('targetUserName').innerText = u.username;
                
                // Parse dữ liệu từ Server
                let svConfig = {};
                try { svConfig = JSON.parse(u.ui_config || "{}"); } catch(e){}
                
                // --- LOGIC TƯƠNG THÍCH DỮ LIỆU CŨ & MỚI ---
                if (svConfig.widgets) {
                    // Nếu là dữ liệu cũ (chưa chia trang) -> Gán hết vào Monitor
                    dashboardConfig.monitor = svConfig.widgets;
                    dashboardConfig.control = [];
                } else if (svConfig.pages) {
                    // Nếu là dữ liệu mới (đã chia trang)
                    dashboardConfig.monitor = svConfig.pages.monitor || [];
                    dashboardConfig.control = svConfig.pages.control || [];
                }

                // Mặc định load trang Giám sát trước
                loadItemsToGrid(dashboardConfig.monitor);
                updateTabUI(); // Cập nhật màu nút bấm
            }
        }
    } catch(e) { console.error("Lỗi tải dữ liệu:", e); }
}

init();

// ============================================================
// 2. LOGIC CHUYỂN TAB (GIÁM SÁT <-> ĐIỀU KHIỂN)
// ============================================================
function switchEditMode(mode) {
    if (currentTab === mode) return; 

    // B1: Lưu hiện trạng của trang cũ vào biến nhớ (dashboardConfig)
    saveCurrentGridToMem();

    // B2: Đổi trạng thái tab
    currentTab = mode;
    updateTabUI();

    // B3: Xóa lưới cũ và vẽ lưới của trang mới
    grid.removeAll();
    
    const itemsToLoad = (mode === 'monitor') ? dashboardConfig.monitor : dashboardConfig.control;
    loadItemsToGrid(itemsToLoad);
}

// Cập nhật giao diện nút bấm
function updateTabUI() {
    const btnMon = document.getElementById('btnTabMonitor');
    const btnCon = document.getElementById('btnTabControl');
    const previewMon = document.getElementById('preview-mon');
    const previewCon = document.getElementById('preview-con');
    
    // Reset style
    const activeStyle = "background:#a855f7; color:white;";
    const inactiveStyle = "background:transparent; color:#94a3b8;";
    const sideActive = "background:#a855f7; color:white; opacity:1;";
    const sideInactive = "background:transparent; color:#fff; opacity:0.5;";

    if (currentTab === 'monitor') {
        btnMon.style.cssText = activeStyle + "border:none; padding:6px 15px; border-radius:6px; cursor:pointer; font-weight:bold;";
        btnCon.style.cssText = inactiveStyle + "border:none; padding:6px 15px; border-radius:6px; cursor:pointer; font-weight:bold;";
        if(previewMon) previewMon.style.cssText = sideActive + "padding:12px; margin:5px 0; border-radius:6px; display:flex; gap:10px; align-items:center;";
        if(previewCon) previewCon.style.cssText = sideInactive + "padding:12px; margin:5px 0; display:flex; gap:10px; align-items:center;";
    } else {
        btnCon.style.cssText = activeStyle + "border:none; padding:6px 15px; border-radius:6px; cursor:pointer; font-weight:bold;";
        btnMon.style.cssText = inactiveStyle + "border:none; padding:6px 15px; border-radius:6px; cursor:pointer; font-weight:bold;";
        if(previewCon) previewCon.style.cssText = sideActive + "padding:12px; margin:5px 0; border-radius:6px; display:flex; gap:10px; align-items:center;";
        if(previewMon) previewMon.style.cssText = sideInactive + "padding:12px; margin:5px 0; display:flex; gap:10px; align-items:center;";
    }
}

// ============================================================
// 3. QUẢN LÝ WIDGET (THÊM / XÓA / LOAD)
// ============================================================

function loadItemsToGrid(items) {
    if (!items) return;
    items.forEach(w => {
        // Khôi phục config vào bộ nhớ tạm
        widgetConfigs[w.id] = w.config || {}; 

        const contentHTML = getWidgetContent(w.type, w.id, w.config);
        
        grid.addWidget({
            x: w.x, y: w.y, w: w.w, h: w.h,
            content: contentHTML,
            id: w.id,
            type: w.type // Lưu loại widget vào node để truy xuất sau này
        });
    });
}

function addWidgetToGrid(type) {
    let w = 3, h = 2;
    if (type === 'switch') { w = 2; h = 1; }
    if (type === 'camera') { w = 6; h = 4; }
    if (type === 'temp')   { w = 4; h = 3; }

    const id = Date.now().toString();
    const contentHTML = getWidgetContent(type, id);

    grid.addWidget({
        w: w, h: h,
        content: contentHTML,
        id: id,
        type: type, // Quan trọng: Lưu type để openConfigModal biết
        autoPosition: true 
    });
    
    toggleDrawer();
}

function getWidgetContent(type, id, config = {}) {
    let icon = 'cube', defaultLabel = 'Widget', color = '#a855f7';

    if (type === 'temp')   { icon = 'thermometer-half'; defaultLabel = 'Nhiệt độ'; color='#f87171'; }
    if (type === 'switch') { icon = 'toggle-on'; defaultLabel = 'Công tắc'; color='#4ade80'; }
    if (type === 'camera') { icon = 'video'; defaultLabel = 'Camera'; color='#60a5fa'; }

    const displayLabel = config.label || defaultLabel;
    
    // Nếu là Camera thì hiển thị URL cắt ngắn, còn lại hiển thị Topic
    let dataKey = config.key || "Chưa cấu hình";
    if (type === 'camera' && config.key && config.key.length > 20) {
        dataKey = "URL: " + config.key.substring(0, 15) + "...";
    }

    return `
        <div class="delete-widget-btn" onclick="removeWidget(this)"><i class="fas fa-times"></i></div>
        <div class="config-widget-btn" onclick="openConfigModal('${id}')"><i class="fas fa-cog"></i></div>
        
        <i class="fas fa-${icon}" style="font-size:32px; color:${color}; margin-bottom:10px;"></i>
        <h4 id="lbl-${id}" style="margin:0; color:#fff; font-weight:600;">${displayLabel}</h4>
        <small style="color:#94a3b8; margin-top:4px;">KEY: <span id="key-${id}">${dataKey}</span></small>
    `;
}

window.removeWidget = function(el) {
    const item = el.closest('.grid-stack-item');
    grid.removeWidget(item);
};

// ============================================================
// 4. LƯU DỮ LIỆU (SAVE)
// ============================================================

function saveCurrentGridToMem() {
    const items = [];
    grid.getGridItems().forEach(item => {
        const node = item.gridstackNode;
        if(node) {
            const conf = widgetConfigs[node.id] || {};
            items.push({
                id: node.id,
                type: node.type, 
                x: node.x, y: node.y, w: node.w, h: node.h,
                config: conf
            });
        }
    });

    if (currentTab === 'monitor') dashboardConfig.monitor = items;
    else dashboardConfig.control = items;
}

async function saveDashboard() {
    saveCurrentGridToMem();
    const payload = { 
        ui_config: JSON.stringify({ 
            pages: dashboardConfig 
        }) 
    };

    try {
        const res = await fetch(`${API_URL}/users/${targetUserId}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        
        if(res.ok) alert("Đã lưu giao diện thành công (Cả 2 trang)!");
        else alert("Lỗi khi lưu!");
        
    } catch(e) { 
        console.error(e);
        alert("Lỗi kết nối!"); 
    }
}

// ============================================================
// 5. CÁC HÀM UI PHỤ TRỢ (MODAL, DRAWER)
// ============================================================
function toggleDrawer() {
    document.getElementById('widgetDrawer').classList.toggle('open');
}

// --- [UPDATED] HÀM MỞ MODAL VỚI LOGIC CAMERA STREAM ---
function openConfigModal(id) {
    // Tìm element grid stack item thông qua gs-id
    const el = document.querySelector(`.grid-stack-item[gs-id="${id}"]`);
    if(!el) return;

    // Lấy thông tin type từ Node của GridStack
    // Lưu ý: node.type đã được lưu lúc gọi addWidgetToGrid
    const type = el.gridstackNode.type || 'text'; 
    const currentConf = widgetConfigs[id] || { label: '', key: '' };

    // Set giá trị cho các input
    document.getElementById('cfgWidgetId').value = id;
    document.getElementById('cfgWidgetType').value = type; // Cần thiết để lưu lại
    document.getElementById('cfgLabel').value = currentConf.label;
    document.getElementById('cfgKey').value = currentConf.key;

    // --- LOGIC THAY ĐỔI GIAO DIỆN MODAL DỰA VÀO TYPE ---
    const lblKey = document.getElementById('lblConfigKey');
    const hintKey = document.getElementById('hintConfigKey');
    const inpKey = document.getElementById('cfgKey');

    // Nếu các ID này chưa tồn tại trong HTML (bạn chưa sửa file html), code sẽ bỏ qua để tránh lỗi
    if (lblKey && hintKey && inpKey) {
        if (type === 'camera') {
            lblKey.innerText = "Đường dẫn Stream (URL HTTPS):";
            inpKey.placeholder = "Vd: https://camera.ngrok-free.app/stream";
            hintKey.innerText = "Nhập đường dẫn Proxy (Ngrok/Cloudflare) để xem video.";
        } else {
            lblKey.innerText = "Mã dữ liệu / Topic MQTT:";
            inpKey.placeholder = "Vd: aquarium/temp_sensor";
            hintKey.innerText = "Topic MQTT dùng để gửi hoặc nhận dữ liệu.";
        }
    }
    // ----------------------------------------------------

    document.getElementById('configModal').classList.add('active');
}

function closeConfigModal() {
    document.getElementById('configModal').classList.remove('active');
}

function saveWidgetConfig() {
    const id = document.getElementById('cfgWidgetId').value;
    const label = document.getElementById('cfgLabel').value;
    const key = document.getElementById('cfgKey').value;

    // Lưu vào bộ nhớ tạm
    widgetConfigs[id] = { label, key };

    // Cập nhật hiển thị ngay lập tức (UI Preview trên Grid)
    const lbl = document.getElementById(`lbl-${id}`);
    const keySpan = document.getElementById(`key-${id}`);
    if(lbl) lbl.innerText = label;
    
    // Nếu key quá dài (như URL), cắt bớt khi hiển thị preview
    if(keySpan) {
        if (key.startsWith('http') && key.length > 20) {
            keySpan.innerText = "URL: " + key.substring(0, 15) + "...";
        } else {
            keySpan.innerText = key;
        }
    }

    closeConfigModal();
}
