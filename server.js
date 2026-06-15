 const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

// ตั้งค่าให้ Server สามารถอ่านข้อมูลจาก Form และ JSON ได้
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// เปิดให้เข้าถึงไฟล์ในโฟลเดอร์ public (พวกไฟล์ HTML)
app.use(express.static(path.join(__dirname, 'public')));

// --- เชื่อมต่อและสร้างตารางฐานข้อมูล (SQLite) ---
const db = new sqlite3.Database('./repair_system.db', (err) => {
    if (err) {
        console.error('เกิดข้อผิดพลาดในการสร้างฐานข้อมูล:', err.message);
    } else {
        console.log('เชื่อมต่อฐานข้อมูล SQLite สำเร็จ (ไฟล์ repair_system.db ถูกสร้างแล้ว)');
    }
});

// สร้างตารางเก็บข้อมูลการแจ้งซ่อม ถ้ายังไม่มีในระบบ
db.run(`
    CREATE TABLE IF NOT EXISTS repair_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_name TEXT NOT NULL,
        department TEXT NOT NULL,
        room_name TEXT,
        problem_type TEXT NOT NULL,
        description TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT DEFAULT 'รอดำเนินการ',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);


// --- API ROUTES ---

// 1. API สำหรับบันทึกข้อมูลการแจ้งซ่อม (POST /api/repair)
app.post('/api/repair', (req, res) => {
    // ✨ ดึง room_name ออกมาจาก req.body
    const { requester_name, department, room_name, problem_type, description, priority } = req.body;
    
    // ✨ อัปเดต SQL INSERT ให้ใส่ค่า room_name ลงไปด้วย
    const sql = `INSERT INTO repair_requests (requester_name, department, room_name, problem_type, description, priority) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [requester_name, department, room_name, problem_type, description, priority];

    db.run(sql, params, function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
        res.json({ success: true, message: 'ส่งข้อมูลแจ้งซ่อมสำเร็จ!', id: this.lastID });
    });
});

// 2. API สำหรับดึงข้อมูลแจ้งซ่อมทั้งหมดไปแสดงบน Dashboard (GET /api/repairs)
app.get('/api/repairs', (req, res) => {
    const sql = `SELECT * FROM repair_requests ORDER BY id DESC`;
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
        res.json(rows);
    });
});

// 3. API สำหรับให้ช่างอัปเดตสถานะ (PUT /api/repair/:id)
app.put('/api/repair/:id', (req, res) => {
    const { status } = req.body;
    const { id } = req.params;

    const sql = `UPDATE repair_requests SET status = ? WHERE id = ?`;
    
    db.run(sql, [status, id], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
        res.json({ success: true, message: 'อัปเดตสถานะเรียบร้อยแล้ว' });
    });
});

// รัน Server
// ==========================================
//           ✨ API เพิ่มเติมสำหรับ ADMIN ✨
// ==========================================

// 1. API สำหรับดึงข้อมูลสถิติไปโชว์ที่การ์ดสรุปบนหน้า Admin (GET /api/admin/stats)
app.get('/api/admin/stats', (req, res) => {
    const stats = { total: 0, pending: 0, processing: 0, completed: 0 };
    
    // นับจำนวนเคสทั้งหมดและแยกตามสถานะ
    db.all(`SELECT status, COUNT(*) as count FROM repair_requests GROUP BY status`, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
        
        rows.forEach(row => {
            if (row.status === 'รอดำเนินการ') stats.pending = row.count;
            if (row.status === 'กำลังซ่อม') stats.processing = row.count;
            if (row.status === 'ซ่อมเสร็จสิ้น') stats.completed = row.count;
        });
        
        stats.total = stats.pending + stats.processing + stats.completed;
        res.json(stats);
    });
});

// 2. API สำหรับจำลองดึงรายการอุปกรณ์ทั้งหมดในองค์กรมาแสดง (GET /api/admin/devices)
app.get('/api/admin/devices', (req, res) => {
    // ในโปรเจกต์ต้นแบบนี้ เราจะดึงข้อมูลอุปกรณ์ที่ถูกแจ้งซ่อมเข้ามาบ่อยที่สุดมาแสดงให้ Admin ดู
    const sql = `SELECT problem_type, COUNT(*) as report_count 
                 FROM repair_requests 
                 GROUP BY problem_type 
                 ORDER BY report_count DESC`;
                 
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
        res.json(rows);
    });
});
// API สำหรับดึงข้อมูลเฉพาะเคสที่ "ซ่อมเสร็จสิ้น" แล้ว (ประวัติการซ่อม)
app.get('/api/repairs/history', (req, res) => {
    const query = `SELECT * FROM repairs WHERE status = 'ซ่อมเสร็จสิ้น' ORDER BY id DESC`;
    db.all(query, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
        res.json(rows);
    });
});
// 3. API สำหรับให้ Admin ลบประวัติการแจ้งซ่อม (DELETE /api/repair/:id)
app.delete('/api/repair/:id', (req, res) => {
    const { id } = req.params;

    const sql = `DELETE FROM repair_requests WHERE id = ?`;
    
    db.run(sql, [id], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
        res.json({ success: true, message: 'ลบข้อมูลประวัติเรียบร้อยแล้ว' });
    });
});
app.listen(PORT, () => {
    console.log(`เซิร์ฟเวอร์ทำงานแล้วที่ http://localhost:${PORT}`);
});