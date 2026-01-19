import { serve } from "bun";
import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";

// สร้างโฟลเดอร์เก็บรูป (ถ้าไม่มีจะสร้างให้)
await mkdir("public", { recursive: true });

// ตั้งชื่อ Database ใหม่ (เพื่อไม่ให้ชนของเดิม)
const db = new Database("cafe_pos_final_v2.sqlite");

console.log("🛠️ System Initializing...");

// 1. สร้างตาราง (Schema ที่ตรงกับหน้า Admin 100%)
db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT)`);
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

// ✅ สร้าง User: Sparkyxzp (ถ้ายังไม่มี)
if (!db.query("SELECT * FROM users WHERE username = 'Sparkyxzp'").get()) {
    db.run("INSERT INTO users (username, password) VALUES ('Sparkyxzp', '1722')");
    console.log("👤 Admin Created: Sparkyxzp");
}

const server = serve({
    port: 3000,
    async fetch(req) {
        const url = new URL(req.url);
        
        // Headers อนุญาตให้หน้าเว็บคุยกับ Server ได้
        const headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        if (req.method === "OPTIONS") return new Response(null, { headers });

        try {
            // 🟢 LOGIN
            if (url.pathname === "/login" && req.method === "POST") {
                const body = await req.json() as any;
                const user = db.query("SELECT * FROM users WHERE username = $u AND password = $p").get({ $u: body.username, $p: body.password });
                return new Response(JSON.stringify(user ? { success: true } : { success: false }), { headers });
            }

            // 🟢 CATEGORIES (หมวดหมู่)
            if (url.pathname === "/categories") {
                if (req.method === "GET") {
                    return new Response(JSON.stringify(db.query("SELECT * FROM categories").all()), { headers });
                }
                if (req.method === "POST") {
                    const body = await req.json() as any;
                    db.run("INSERT INTO categories (name) VALUES (?)", [body.name]);
                    return new Response(JSON.stringify({ success: true }), { headers });
                }
            }
            // ลบหมวดหมู่
            if (url.pathname.startsWith("/categories/") && req.method === "DELETE") {
                const id = Number(url.pathname.split("/")[2]);
                if (!isNaN(id)) {
                    db.run("DELETE FROM products WHERE category_id = ?", [id]); // ลบสินค้าในหมวดด้วย
                    db.run("DELETE FROM categories WHERE id = ?", [id]);
                }
                return new Response(JSON.stringify({ success: true }), { headers });
            }

            // 🟢 PRODUCTS (สินค้า)
            if (url.pathname === "/products") {
                if (req.method === "GET") {
                    const products = db.query(`
                        SELECT p.*, c.name as category_name 
                        FROM products p 
                        LEFT JOIN categories c ON p.category_id = c.id
                    `).all();
                    return new Response(JSON.stringify(products), { headers });
                }
                if (req.method === "POST") {
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

                    db.run("INSERT INTO products (name, price, category_id, icon, has_sweetness) VALUES (?, ?, ?, ?, ?)", 
                        [name, price, category_id, iconPath, has_sweetness]);

                    return new Response(JSON.stringify({ success: true }), { headers });
                }
            }
            // ลบสินค้า
            if (url.pathname.startsWith("/products/") && req.method === "DELETE") {
                const id = Number(url.pathname.split("/")[2]);
                if (!isNaN(id)) {
                    db.run("DELETE FROM products WHERE id = ?", [id]);
                }
                return new Response(JSON.stringify({ success: true }), { headers });
            }

            // 🟢 ORDERS
            if (url.pathname === "/orders") {
                if (req.method === "GET") { // Admin ดูออเดอร์
                    const orders = db.query("SELECT * FROM orders ORDER BY id DESC LIMIT 50").all() as any[];
                    const parsed = orders.map(o => ({ ...o, items: JSON.parse(o.items) }));
                    return new Response(JSON.stringify(parsed), { headers });
                }
                if (req.method === "POST") { // ลูกค้าสั่ง
                    const body = await req.json() as any;
                    const res = db.query("INSERT INTO orders (items, total, status) VALUES (?, ?, ?) RETURNING id")
                        .get(JSON.stringify(body.items), body.total, 'pending') as any;
                    return new Response(JSON.stringify({ success: true, id: res.id }), { headers });
                }
            }

            // ✅ เพิ่ม API สำหรับลบออเดอร์ (Delete Order)
            if (url.pathname.startsWith("/orders/") && req.method === "DELETE") {
                const id = Number(url.pathname.split("/")[2]);
                if (!isNaN(id)) {
                    db.run("DELETE FROM orders WHERE id = ?", [id]);
                }
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            
            // 🟢 Dashboard Graph (กราฟยอดขาย)
            if (url.pathname === "/daily-sales" && req.method === "GET") {
                const sales = db.query(`
                    SELECT strftime('%Y-%m-%d', created_at) as sale_date, SUM(total) as total 
                    FROM orders GROUP BY sale_date ORDER BY sale_date DESC LIMIT 7
                `).all();
                return new Response(JSON.stringify(sales), { headers });
            }

            // 🔵 FILE SERVER (รูปภาพ & HTML)
            if (url.pathname.startsWith("/public/")) {
                const file = Bun.file(url.pathname.substring(1));
                return new Response(file);
            }
            
            // หน้าเว็บ
            if (url.pathname === "/" || url.pathname === "/login") return new Response(Bun.file("login.html"));
            
            const file = Bun.file(url.pathname.substring(1));
            if (await file.exists()) return new Response(file);

        } catch (e) {
            console.error("Server Error:", e);
            return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers });
        }

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`🚀 Server Running: http://localhost:${server.port}`);