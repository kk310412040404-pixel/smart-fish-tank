// script_builder.js 

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
}; // Biến lưu trữ toàn bộ cấu hình của cả 2 trang

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
    if (currentTab === mode) return; // Đang ở trang đó rồi thì không làm gì

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

// Cập nhật giao diện nút bấm (Màu tím cho trang đang chọn)
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

// Hàm load danh sách widget lên lưới
function loadItemsToGrid(items) {
    if (!items) return;
    items.forEach(w => {
        // Khôi phục config vào bộ nhớ tạm để Modal dùng được
        widgetConfigs[w.id] = w.config || {}; 

        const contentHTML = getWidgetContent(w.type, w.id, w.config);
        
        grid.addWidget({
            x: w.x, y: w.y, w: w.w, h: w.h,
            content: contentHTML,
            id: w.id,
            type: w.type // Lưu loại widget vào node
        });
    });
}

// Hàm thêm Widget mới từ Drawer
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
        type: type, // Lưu type
        autoPosition: true 
    });
    
    toggleDrawer();
}

// Tạo nội dung HTML cho thẻ
function getWidgetContent(type, id, config = {}) {
    let icon = 'cube', defaultLabel = 'Widget', color = '#a855f7';

    if (type === 'temp')   { icon = 'thermometer-half'; defaultLabel = 'Nhiệt độ'; color='#f87171'; }
    if (type === 'switch') { icon = 'toggle-on'; defaultLabel = 'Công tắc'; color='#4ade80'; }
    if (type === 'camera') { icon = 'video'; defaultLabel = 'Camera'; color='#60a5fa'; }

    const displayLabel = config.label || defaultLabel;
    const dataKey = config.key || "Chưa cấu hình";

    // Thêm data-type vào div để dễ truy xuất nếu cần
    return `
        <div class="delete-widget-btn" onclick="removeWidget(this)"><i class="fas fa-times"></i></div>
        <div class="config-widget-btn" onclick="openConfigModal('${id}')"><i class="fas fa-cog"></i></div>
        
        <i class="fas fa-${icon}" style="font-size:32px; color:${color}; margin-bottom:10px;"></i>
        <h4 id="lbl-${id}" style="margin:0; color:#fff; font-weight:600;">${displayLabel}</h4>
        <small style="color:#94a3b8; margin-top:4px;">KEY: <span id="key-${id}">${dataKey}</span></small>
    `;
}

// Xóa Widget
window.removeWidget = function(el) {
    const item = el.closest('.grid-stack-item');
    grid.removeWidget(item);
};

// ============================================================
// 4. LƯU DỮ LIỆU (SAVE)
// ============================================================

// Hàm gom dữ liệu hiện tại trên lưới vào biến dashboardConfig
function saveCurrentGridToMem() {
    const items = [];
    grid.getGridItems().forEach(item => {
        const node = item.gridstackNode;
        if(node) {
            // Lấy config từ bộ nhớ tạm
            const conf = widgetConfigs[node.id] || {};
            items.push({
                id: node.id,
                type: node.type, // Lấy từ thuộc tính node.type đã gán lúc addWidget
                x: node.x, y: node.y, w: node.w, h: node.h,
                config: conf
            });
        }
    });

    // Lưu vào đúng nhánh (monitor hoặc control)
    if (currentTab === 'monitor') dashboardConfig.monitor = items;
    else dashboardConfig.control = items;
}

// Lưu lên Server
async function saveDashboard() {
    // 1. Lưu trang hiện tại vào bộ nhớ trước đã
    saveCurrentGridToMem();

    // 2. Tạo payload theo cấu trúc mới { pages: ... }
    const payload = { 
        ui_config: JSON.stringify({ 
            pages: dashboardConfig // Lưu cả 2 trang
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

function openConfigModal(id) {
    const el = document.querySelector(`.grid-stack-item[gs-id="${id}"]`);
    if(!el) return;

    const currentConf = widgetConfigs[id] || { label: '', key: '' };

    document.getElementById('cfgWidgetId').value = id;
    document.getElementById('cfgLabel').value = currentConf.label;
    document.getElementById('cfgKey').value = currentConf.key;
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

    // Cập nhật hiển thị ngay lập tức
    const lbl = document.getElementById(`lbl-${id}`);
    const keySpan = document.getElementById(`key-${id}`);
    if(lbl) lbl.innerText = label;
    if(keySpan) keySpan.innerText = key;

    closeConfigModal();
}
