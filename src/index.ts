import { serve } from "bun";
import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";

// สร้างโฟลเดอร์เก็บรูป
await mkdir("public", { recursive: true });

const db = new Database("cafe_pos_final_v2.sqlite");
console.log("🛠️ System Initializing...");

// 1. สร้างตาราง
db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, token TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    name TEXT, 
    price REAL, 
    category_id INTEGER, 
    icon TEXT, 
    has_sweetness INTEGER DEFAULT 0
)`);
db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    items TEXT, 
    total REAL, 
    status TEXT DEFAULT 'pending', 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// ✅ สร้าง User: Admin (รหัส: 1722)
if (!db.query("SELECT * FROM users WHERE username = 'Admin'").get()) {
    db.run("INSERT INTO users (username, password) VALUES ('Admin', '1722')");
    console.log("👤 Admin Created: Admin");
}

// 🔐 Middleware ตรวจสอบ Token
function isAuthorized(req: Request): boolean {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return false;
    const token = authHeader.split(" ")[1];
    if (!token) return false;
    const user = db.query("SELECT * FROM users WHERE token = ?").get(token);
    return !!user;
}

const server = serve({
    port: 3000,
    async fetch(req) {
        const url = new URL(req.url);
        
        const headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        };

        if (req.method === "OPTIONS") return new Response(null, { headers });

        try {
            // ==========================================
            // 🔓 PUBLIC ZONE (Guest เข้าได้ไม่ต้องใช้ Token)
            // ==========================================

            // 1. LOGIN
            if (url.pathname === "/login" && req.method === "POST") {
                const body = await req.json() as any;
                const user = db.query("SELECT * FROM users WHERE username = $u AND password = $p").get({ $u: body.username, $p: body.password }) as any;
                
                if (user) {
                    const newToken = "TOKEN_" + crypto.randomUUID();
                    db.run("UPDATE users SET token = ? WHERE id = ?", [newToken, user.id]);
                    return new Response(JSON.stringify({ success: true, token: newToken }), { headers });
                }
                return new Response(JSON.stringify({ success: false }), { status: 401, headers });
            }

            // 2. FILES & PAGES
            if (req.method === "GET") {
                if (url.pathname.startsWith("/public/")) return new Response(Bun.file(url.pathname.substring(1)));
                if (url.pathname === "/" || url.pathname === "/login") return new Response(Bun.file("login.html"));
                
                // เช็คไฟล์ HTML (ถ้ามีไฟล์ให้ส่งกลับ ถ้าไม่มีให้ข้ามไปเช็ค API ต่อ)
                const file = Bun.file(url.pathname.substring(1));
                if (await file.exists()) return new Response(file);
            }

            // 3. GET DATA (ให้ Guest ดึงข้อมูลไปโชว์ได้) ✅ ย้ายมาไว้ตรงนี้
            
            // 👉 ดึงหมวดหมู่ (Public)
            if (url.pathname === "/categories" && req.method === "GET") {
                return new Response(JSON.stringify(db.query("SELECT * FROM categories").all()), { headers });
            }

            // 👉 ดึงสินค้า (Public)
            if (url.pathname === "/products" && req.method === "GET") {
                const products = db.query(`SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id`).all();
                return new Response(JSON.stringify(products), { headers });
            }

            // 👉 สั่งออเดอร์ (Public)
            if (url.pathname === "/orders" && req.method === "POST") {
                const body = await req.json() as any;
                const total = Number(body.total) || 0;
                const res = db.query("INSERT INTO orders (items, total, status) VALUES (?, ?, ?) RETURNING id")
                    .get(JSON.stringify(body.items), total, 'pending') as any;
                return new Response(JSON.stringify({ success: true, id: res.id }), { headers });
            }


            // ==========================================
            // ⛔ PROTECTED ZONE (ต้องมี Token เท่านั้น)
            // ==========================================
            if (!isAuthorized(req)) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
            }

            // --- ADMIN API ---

            // จัดการหมวดหมู่ (เพิ่ม/ลบ)
            if (url.pathname === "/categories" && req.method === "POST") {
                const body = await req.json() as any;
                db.run("INSERT INTO categories (name) VALUES (?)", [body.name]);
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            if (url.pathname.startsWith("/categories/") && req.method === "DELETE") {
                const id = Number(url.pathname.split("/")[2]);
                if(!isNaN(id)) {
                    db.run("DELETE FROM products WHERE category_id = ?", [id]);
                    db.run("DELETE FROM categories WHERE id = ?", [id]);
                }
                return new Response(JSON.stringify({ success: true }), { headers });
            }

            // จัดการสินค้า (เพิ่ม/ลบ)
            if (url.pathname === "/products" && req.method === "POST") {
                const formData = await req.formData();
                const name = String(formData.get('name') || '');
                const price = Number(formData.get('price') || 0);
                const category_id = Number(formData.get('category_id') || 0);
                const has_sweetness = (formData.get('has_sweetness') === 'true') ? 1 : 0;
                const image = formData.get('image');
                let iconPath = '☕'; 
                if (image && image instanceof File) {
                    const fileName = `${Date.now()}_${image.name}`;
                    await Bun.write(`public/${fileName}`, image);
                    iconPath = `/public/${fileName}`;
                }
                db.run("INSERT INTO products (name, price, category_id, icon, has_sweetness) VALUES (?, ?, ?, ?, ?)", [name, price, category_id, iconPath, has_sweetness]);
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            if (url.pathname.startsWith("/products/") && req.method === "DELETE") {
                const id = Number(url.pathname.split("/")[2]);
                if(!isNaN(id)) db.run("DELETE FROM products WHERE id = ?", [id]);
                return new Response(JSON.stringify({ success: true }), { headers });
            }

            // จัดการออเดอร์ (ดู/ลบ)
            if (url.pathname === "/orders" && req.method === "GET") {
                const orders = db.query("SELECT * FROM orders ORDER BY id DESC LIMIT 50").all() as any[];
                const parsed = orders.map(o => ({ ...o, items: JSON.parse(o.items) }));
                return new Response(JSON.stringify(parsed), { headers });
            }
            if (url.pathname.startsWith("/orders/") && req.method === "DELETE") {
                const id = Number(url.pathname.split("/")[2]);
                if(!isNaN(id)) db.run("DELETE FROM orders WHERE id = ?", [id]);
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            
            // Dashboard
            if (url.pathname === "/daily-sales" && req.method === "GET") {
                const sales = db.query(`SELECT strftime('%Y-%m-%d', created_at) as sale_date, SUM(total) as total FROM orders GROUP BY sale_date ORDER BY sale_date DESC LIMIT 7`).all();
                return new Response(JSON.stringify(sales), { headers });
            }

        } catch (e) {
            console.error("Server Error:", e);
            return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers });
        }
        return new Response("Not Found", { status: 404 });
    },
});
console.log(`🚀 Server Running: http://localhost:${server.port}`);