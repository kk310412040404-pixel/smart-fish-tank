// script_builder.js - BẢN FIX LOGIC GRIDSTACK

const urlParams = new URLSearchParams(window.location.search);
const targetUserId = urlParams.get('uid');
const token = localStorage.getItem('accessToken');
const API_URL = "http://127.0.0.1:8000/api";

let grid = null; // Biến giữ lưới

// 1. KHỞI TẠO GRID & DATA
async function init() {
    if (!token || !targetUserId) {
        alert("Không có quyền truy cập!");
        return;
    }

    // Khởi tạo Gridstack
    // float: true -> Widget không tự trôi lên trên (giữ vị trí cố định)
    grid = GridStack.init({
        column: 12,       // Lưới 12 cột (chuẩn Bootstrap)
        cellHeight: 100,  // Chiều cao cơ sở mỗi ô
        margin: 10,       // Khoảng cách giữa các ô
        float: true,      // Cho phép để khoảng trống
        disableResize: false, 
        disableDrag: false,
        animate: true     // Hiệu ứng mượt
    });

    // Lấy dữ liệu cũ từ Server
    try {
        const res = await fetch(`${API_URL}/users`, { headers: { 'Authorization': `Bearer ${token}` } });
        if(res.ok) {
            const users = await res.json();
            const u = users.find(x => x.id == targetUserId);
            if(u) {
                document.getElementById('targetUserName').innerText = u.username;
                let config = {};
                try { config = JSON.parse(u.ui_config || "{}"); } catch(e){}
                
                // Nếu có widgets đã lưu -> Load lên lưới
                if (config.widgets && Array.isArray(config.widgets)) {
                    loadWidgetsToGrid(config.widgets);
                }
            }
        }
    } catch(e) { console.error("Lỗi tải dữ liệu:", e); }
}

// Chạy hàm khởi tạo
init();

// 2. LOAD WIDGET CŨ LÊN LƯỚI
function loadWidgetsToGrid(widgets) {
    // Xóa hết widget cũ (nếu có)
    grid.removeAll();

    widgets.forEach(w => {
        // Tạo nội dung HTML cho Card
        const contentHTML = getWidgetContent(w.type, w.id);
        
        // Thêm vào lưới
        grid.addWidget({
            x: w.x, y: w.y, w: w.w, h: w.h, // Tọa độ và kích thước
            content: contentHTML,
            id: w.id,   // ID riêng
            type: w.type // Loại widget (để lưu lại sau này)
        });
    });
}

// 3. THÊM WIDGET MỚI (Từ Drawer)
function addWidgetToGrid(type) {
    let w = 3, h = 2; // Mặc định 3x2 ô
    
    // Kích thước gợi ý theo loại
    if (type === 'switch') { w = 2; h = 1; } // Công tắc nhỏ gọn
    if (type === 'camera') { w = 6; h = 4; } // Camera to
    if (type === 'temp')   { w = 4; h = 3; } // Biểu đồ vừa

    const id = Date.now().toString(); // Tạo ID ngẫu nhiên
    const contentHTML = getWidgetContent(type, id);

    // Thêm vào lưới (autoPosition: true để tự tìm chỗ trống)
    grid.addWidget({
        w: w, h: h,
        content: contentHTML,
        id: id,
        type: type, // Lưu loại widget vào thuộc tính của node
        autoPosition: true 
    });
    
    toggleDrawer(); // Đóng ngăn kéo
}

// 4. HTML NỘI DUNG CARD (DEMO CHO ADMIN)
function getWidgetContent(type, id) {
    let icon = 'cube', label = 'Widget', color = '#a855f7';

    if (type === 'temp')   { icon = 'thermometer-half'; label = 'Nhiệt độ'; color='#f87171'; }
    if (type === 'switch') { icon = 'toggle-on'; label = 'Công tắc'; color='#4ade80'; }
    if (type === 'camera') { icon = 'video'; label = 'Camera'; color='#60a5fa'; }

    // Nút xóa + Icon + Tên
    return `
        <div class="delete-widget-btn" onclick="removeWidget(this)"><i class="fas fa-times"></i></div>
        <i class="fas fa-${icon}" style="font-size:32px; color:${color}; margin-bottom:10px;"></i>
        <h4 style="margin:0; color:#fff; font-weight:600;">${label}</h4>
        <small style="color:#94a3b8; margin-top:4px;">${type.toUpperCase()}</small>
    `;
}

// 5. XÓA WIDGET
window.removeWidget = function(el) {
    // Tìm phần tử cha là grid-stack-item
    const item = el.closest('.grid-stack-item');
    grid.removeWidget(item);
};

// 6. LƯU CẤU HÌNH (QUAN TRỌNG)
async function saveDashboard() {
    // Lấy danh sách các node hiện tại trên lưới
    // Gridstack lưu thông tin trong grid.engine.nodes hoặc qua phương thức save()
    const items = [];
    
    grid.getGridItems().forEach(item => {
        // item là DOM element, gridstackNode chứa data
        const node = item.gridstackNode;
        if(node) {
            items.push({
                id: node.id,
                type: node.type || 'unknown', // Lấy type ta đã gán lúc add
                x: node.x,
                y: node.y,
                w: node.w,
                h: node.h
            });
        }
    });

    const payload = { ui_config: JSON.stringify({ widgets: items }) };

    try {
        const res = await fetch(`${API_URL}/users/${targetUserId}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        
        if(res.ok) alert("Đã lưu giao diện thành công!");
        else alert("Lỗi khi lưu!");
        
    } catch(e) { 
        console.error(e);
        alert("Lỗi kết nối!"); 
    }
}

function toggleDrawer() {
    document.getElementById('widgetDrawer').classList.toggle('open');
}