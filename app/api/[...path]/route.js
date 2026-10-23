import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  clearSessionCookieHeader,
  createSession,
  destroySession,
  getCurrentUser,
  isAllowed,
  sessionCookieHeader,
  toPublicUser,
} from "@/lib/auth";
import { getPool, initializeDatabase } from "@/lib/database";
import { getWhatsAppService } from "@/lib/whatsapp";

const json = (data, status = 200, headers = {}) =>
  NextResponse.json(data, { status, headers });

const fail = (message, status = 500) => json({ success: false, message }, status);

async function readBody(request) {
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await request.formData();
    const values = {};
    for (const [key, value] of form.entries()) {
      values[key] = value;
    }
    return values;
  }

  const raw = await request.text();
  if (!raw.trim()) return {};

  if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Request body must contain valid JSON."), { status: 400 });
  }
}

async function saveImage(value, folder) {
  if (!value || typeof value === "string" || value.size === 0) return null;

  const allowedTypes = new Map([
    ["image/jpeg", ".jpg"],
    ["image/jpg", ".jpg"],
    ["image/png", ".png"],
    ["image/webp", ".webp"],
  ]);
  const extension = allowedTypes.get(value.type);
  if (!extension) throw Object.assign(new Error("Only jpg, jpeg, png, and webp images are allowed."), { status: 400 });
  if (value.size > 2 * 1024 * 1024) {
    throw Object.assign(new Error("Image must be 2MB or smaller."), { status: 413 });
  }

  const filename = `${Date.now()}-${randomUUID()}${extension}`;
  const directory = path.join(process.cwd(), "public", "public", folder);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), Buffer.from(await value.arrayBuffer()));
  return `/public/${folder}/${filename}`;
}

function publicRow(row, mapping = {}) {
  const result = {};
  for (const [column, property] of Object.entries(mapping)) {
    result[property] = row[column];
  }
  result._id = row.id;
  result.createdAt = row.created_at;
  result.updatedAt = row.updated_at;
  return result;
}

function validPage(query) {
  const page = Math.max(1, Number.parseInt(query.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.get("limit") || "10", 10) || 10));
  return { page, limit, offset: (page - 1) * limit };
}

function requirePermission(user, action) {
  if (!user) return fail("Not logged in. Please login first.", 401);
  if (!isAllowed(user, action)) {
    return fail(`Access denied. You do not have permission to perform: ${action}`, 403);
  }
  return null;
}

async function findUserByEmail(email) {
  const [rows] = await getPool().execute("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
  return rows[0] || null;
}

async function handleAuth(request, method, route, body) {
  if (route === "login" && method === "POST") {
    const { email, password } = body;
    if (!email || !password) return fail("Email and password are required.", 400);

    const user = await findUserByEmail(String(email).trim().toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return fail("Invalid email or password.", 401);
    }

    await getPool().execute("UPDATE users SET last_login = UTC_TIMESTAMP(3) WHERE id = ?", [user.id]);
    const sessionId = await createSession(user.id);
    return json(
      { success: true, user: toPublicUser({ ...user, last_login: new Date() }) },
      200,
      { "Set-Cookie": sessionCookieHeader(sessionId) },
    );
  }

  if (route === "signup" && method === "POST") {
    const { fullName, email, mobile, username, password } = body;
    if (!fullName || !email || !mobile || !username || !password) {
      return fail("All fields are required.", 400);
    }
    if (String(password).length < 6) return fail("Password must be at least 6 characters.", 400);

    const id = randomUUID();
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedUsername = String(username).trim().toLowerCase();
    const userType = "sales";
    await getPool().execute(
      `INSERT INTO users (id, full_name, email, mobile, username, password_hash, user_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        String(fullName).trim(),
        normalizedEmail,
        String(mobile).trim(),
        normalizedUsername,
        await bcrypt.hash(String(password), 10),
        userType,
      ],
    );
    const [rows] = await getPool().execute("SELECT * FROM users WHERE id = ?", [id]);
    const sessionId = await createSession(id);
    return json(
      { success: true, user: toPublicUser(rows[0]) },
      201,
      { "Set-Cookie": sessionCookieHeader(sessionId) },
    );
  }

  if (route === "bootstrap-admin" && method === "POST") {
    const bootstrapKey = process.env.ADMIN_BOOTSTRAP_KEY;
    const suppliedKey = String(body.bootstrapKey || "");
    const expected = Buffer.from(bootstrapKey || "");
    const supplied = Buffer.from(suppliedKey);
    if (!bootstrapKey || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      return fail("A valid ADMIN_BOOTSTRAP_KEY is required.", 403);
    }

    const { fullName, email, mobile, username, password } = body;
    if (!fullName || !email || !mobile || !username || !password) {
      return fail("All fields are required.", 400);
    }
    if (String(password).length < 6) return fail("Password must be at least 6 characters.", 400);

    const connection = await getPool().getConnection();
    const id = randomUUID();
    try {
      await connection.beginTransaction();
      const [settings] = await connection.execute(
        "SELECT setting_value FROM app_settings WHERE setting_key = 'admin_bootstrap' FOR UPDATE",
      );
      const [users] = await connection.query("SELECT COUNT(*) AS total FROM users");
      if (settings[0]?.setting_value !== "available" || Number(users[0].total) > 0) {
        await connection.rollback();
        return fail("Admin bootstrap is only available before the first user is created.", 409);
      }

      await connection.execute(
        `INSERT INTO users (id, full_name, email, mobile, username, password_hash, user_type)
         VALUES (?, ?, ?, ?, ?, ?, 'admin')`,
        [
          id,
          String(fullName).trim(),
          String(email).trim().toLowerCase(),
          String(mobile).trim(),
          String(username).trim().toLowerCase(),
          await bcrypt.hash(String(password), 10),
        ],
      );
      await connection.execute(
        "UPDATE app_settings SET setting_value = 'complete' WHERE setting_key = 'admin_bootstrap'",
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const [rows] = await getPool().execute("SELECT * FROM users WHERE id = ?", [id]);
    const sessionId = await createSession(id);
    return json(
      { success: true, user: toPublicUser(rows[0]) },
      201,
      { "Set-Cookie": sessionCookieHeader(sessionId) },
    );
  }

  if (route === "me" && method === "GET") {
    const user = await getCurrentUser(request);
    return user
      ? json({ success: true, user })
      : fail("Session expired or not authenticated.", 401);
  }

  if (route === "logout" && method === "POST") {
    await destroySession(request);
    return json(
      { success: true, message: "Logged out successfully." },
      200,
      { "Set-Cookie": clearSessionCookieHeader() },
    );
  }

  return fail("Route not found.", 404);
}

async function handleUsers(request, method, route, user, query, body) {
  const actions = {
    adduser: "adduser",
    getalluser: "getalluser",
    profile: "getprofile",
    edituser: "edituser",
    deleteuser: "deleteuser",
  };
  const action = actions[route[0]];
  if (!action) return fail("Route not found.", 404);
  const denied = requirePermission(user, action);
  if (denied) return denied;
  const pool = getPool();

  if (route[0] === "adduser" && method === "POST") {
    const { fullName, email, mobile, username, password } = body;
    if (!fullName || !email || !mobile || !username || !password) return fail("All fields are required.", 400);
    if (String(password).length < 6) return fail("Password must be at least 6 characters.", 400);

    const id = randomUUID();
    const userType = body.userType === "admin" || body.role === "admin" ? "admin" : "sales";
    await pool.execute(
      `INSERT INTO users (id, full_name, email, mobile, username, password_hash, user_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        String(fullName).trim(),
        String(email).trim().toLowerCase(),
        String(mobile).trim(),
        String(username).trim().toLowerCase(),
        await bcrypt.hash(String(password), 10),
        userType,
      ],
    );
    const [rows] = await pool.execute("SELECT * FROM users WHERE id = ?", [id]);
    return json({ success: true, user: toPublicUser(rows[0]) }, 201);
  }

  if (route[0] === "getalluser" && method === "GET") {
    const { page, limit, offset } = validPage(query);
    const search = query.get("search");
    const mobile = query.get("mobile");
    const conditions = [];
    const params = [];
    if (search) {
      conditions.push("(full_name LIKE ? OR email LIKE ? OR username LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (mobile) {
      conditions.push("mobile = ?");
      params.push(mobile);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM users ${where}`, params);
    const sortColumns = { createdAt: "created_at", fullName: "full_name", email: "email", username: "username" };
    const sort = sortColumns[query.get("sortBy")] || "created_at";
    const order = query.get("order") === "asc" ? "ASC" : "DESC";
    const [rows] = await pool.query(
      `SELECT id, full_name, email, mobile, username, user_type, last_login, created_at, updated_at
         FROM users ${where} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = countRows[0].total;
    return json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      users: rows.map((row) => toPublicUser(row)),
    });
  }

  if (route[0] === "profile" && method === "GET") {
    const [rows] = await pool.execute(
      `SELECT id, full_name, email, mobile, username, user_type, last_login, created_at, updated_at
         FROM users WHERE id = ? LIMIT 1`,
      [route[1]],
    );
    return rows[0] ? json({ success: true, user: toPublicUser(rows[0]) }) : fail("User not found.", 404);
  }

  if (route[0] === "edituser" && method === "PUT") {
    const password = body.password;
    if (password !== undefined && password !== "" && String(password).length < 6) {
      return fail("Password must be at least 6 characters.", 400);
    }

    const [existing] = await pool.execute("SELECT id FROM users WHERE id = ? LIMIT 1", [route[1]]);
    if (!existing[0]) return fail("User not found.", 404);

    const fieldMap = {
      fullName: "full_name",
      email: "email",
      mobile: "mobile",
      username: "username",
      userType: "user_type",
      role: "user_type",
    };
    const values = [];
    const updates = [];
    for (const [field, column] of Object.entries(fieldMap)) {
      if (body[field] !== undefined) {
        updates.push(`${column} = ?`);
        values.push(field === "email" || field === "username"
          ? String(body[field]).trim().toLowerCase()
          : body[field]);
      }
    }
    if (password !== undefined && password !== "") {
        updates.push("password_hash = ?");
        values.push(await bcrypt.hash(String(password), 10));
    }
    if (updates.length) {
        values.push(route[1]);
        await pool.execute(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, values);
    }
    const [rows] = await pool.execute(
      `SELECT id, full_name, email, mobile, username, user_type, last_login, created_at, updated_at
         FROM users WHERE id = ? LIMIT 1`,
      [route[1]],
    );
    return rows[0] ? json({ success: true, user: toPublicUser(rows[0]) }) : fail("User not found.", 404);
  }

  if (route[0] === "deleteuser" && method === "DELETE") {
    const [rows] = await pool.execute("SELECT id FROM users WHERE id = ? LIMIT 1", [route[1]]);
    if (!rows[0]) return fail("User not found.", 404);
    await pool.execute("DELETE FROM users WHERE id = ?", [route[1]]);
    return json({ success: true, message: "User deleted successfully." });
  }

  return fail("Route not found.", 404);
}

async function handleCompanies(request, method, route, user, query, body) {
  const actions = { getallcompany: "getallcompany", addcompany: "addcompany", createcompany: "addcompany", editcompany: "editcompany", deletecompany: "deletecompany" };
  const action = actions[route[0]];
  if (!action) return fail("Route not found.", 404);
  const denied = requirePermission(user, action);
  if (denied) return denied;
  const pool = getPool();

  if (route[0] === "getallcompany" && method === "GET") {
    const { page, limit, offset } = validPage(query);
    const search = query.get("search");
    const where = search ? "WHERE name LIKE ?" : "";
    const params = search ? [`%${search}%`] : [];
    const [counts] = await pool.execute(`SELECT COUNT(*) AS total FROM companies ${where}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM companies ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = counts[0].total;
    return json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      companies: rows.map((row) => publicRow(row, { name: "name", image: "image", website: "website", mobile: "mobile" })),
    });
  }

  if (["addcompany", "createcompany"].includes(route[0]) && method === "POST") {
    if (!body.name) return fail("Company name is required.", 400);
    const image = await saveImage(body.image, "company");
    const id = randomUUID();
    await pool.execute(
      "INSERT INTO companies (id, name, image, website, mobile) VALUES (?, ?, ?, ?, ?)",
      [id, body.name, image, body.website || null, body.mobile || null],
    );
    const [rows] = await pool.execute("SELECT * FROM companies WHERE id = ?", [id]);
    return json({ success: true, company: publicRow(rows[0], { name: "name", image: "image", website: "website", mobile: "mobile" }) }, 201);
  }

  if (route[0] === "editcompany" && method === "PUT") {
    const [existing] = await pool.execute("SELECT * FROM companies WHERE id = ? LIMIT 1", [route[1]]);
    if (!existing[0]) return fail("Company not found.", 404);
    const image = await saveImage(body.image, "company");
    const current = existing[0];
    await pool.execute(
      "UPDATE companies SET name = ?, image = ?, website = ?, mobile = ? WHERE id = ?",
      [
        body.name ?? current.name,
        image || current.image,
        body.website ?? current.website,
        body.mobile ?? current.mobile,
        route[1],
      ],
    );
    const [rows] = await pool.execute("SELECT * FROM companies WHERE id = ?", [route[1]]);
    return json({ success: true, company: publicRow(rows[0], { name: "name", image: "image", website: "website", mobile: "mobile" }) });
  }

  if (route[0] === "deletecompany" && method === "DELETE") {
    const [result] = await pool.execute("DELETE FROM companies WHERE id = ?", [route[1]]);
    if (!result.affectedRows) return fail("Company not found.", 404);
    return json({ success: true, message: "Company deleted successfully." });
  }

  return fail("Route not found.", 404);
}

async function handleCategories(request, method, route, user, query, body) {
  const actions = { getall: "getallcategory", addcategory: "addcategory", editcategory: "editcategory", deletecategory: "deletecategory" };
  const action = actions[route[0]];
  if (!action) return fail("Route not found.", 404);
  const denied = requirePermission(user, action);
  if (denied) return denied;
  const pool = getPool();

  if (route[0] === "getall" && method === "GET") {
    const { page, limit, offset } = validPage(query);
    const search = query.get("search");
    const where = search ? "WHERE c.name LIKE ?" : "";
    const params = search ? [`%${search}%`] : [];
    const [counts] = await pool.execute(`SELECT COUNT(*) AS total FROM categories c ${where}`, params);
    const [rows] = await pool.query(
      `SELECT c.*, u.full_name AS added_full_name, u.email AS added_email, u.username AS added_username
         FROM categories c LEFT JOIN users u ON u.id = c.added_by_whom
         ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = counts[0].total;
    return json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      categories: rows.map((row) => ({
        ...publicRow(row, { name: "name", img: "img" }),
        addedByWhom: row.added_by_whom
          ? { _id: row.added_by_whom, fullName: row.added_full_name, email: row.added_email, username: row.added_username }
          : null,
      })),
    });
  }

  if (route[0] === "addcategory" && method === "POST") {
    if (!body.name) return fail("Category name is required.", 400);
    const img = await saveImage(body.img, "category");
    const id = randomUUID();
    await pool.execute(
      "INSERT INTO categories (id, name, img, added_by_whom) VALUES (?, ?, ?, ?)",
      [id, body.name, img, user._id],
    );
    const [rows] = await pool.execute("SELECT * FROM categories WHERE id = ?", [id]);
    return json({
      success: true,
      category: {
        ...publicRow(rows[0], { name: "name", img: "img" }),
        addedByWhom: { _id: user._id, fullName: user.fullName, email: user.email, username: user.username },
      },
    }, 201);
  }

  if (route[0] === "editcategory" && method === "PUT") {
    const [existing] = await pool.execute("SELECT * FROM categories WHERE id = ? LIMIT 1", [route[1]]);
    if (!existing[0]) return fail("Category not found.", 404);
    const img = await saveImage(body.img, "category");
    await pool.execute(
      "UPDATE categories SET name = ?, img = ? WHERE id = ?",
      [body.name ?? existing[0].name, img || existing[0].img, route[1]],
    );
    const [rows] = await pool.execute("SELECT * FROM categories WHERE id = ?", [route[1]]);
    return json({
      success: true,
      category: {
        ...publicRow(rows[0], { name: "name", img: "img" }),
        addedByWhom: existing[0].added_by_whom
          ? { _id: existing[0].added_by_whom, fullName: user.fullName, email: user.email, username: user.username }
          : null,
      },
    });
  }

  if (route[0] === "deletecategory" && method === "DELETE") {
    const [result] = await pool.execute("DELETE FROM categories WHERE id = ?", [route[1]]);
    if (!result.affectedRows) return fail("Category not found.", 404);
    return json({ success: true, message: "Category deleted successfully." });
  }

  return fail("Route not found.", 404);
}

function parseSku(value) {
  if (value === undefined) return undefined;
  let sku;
  try {
    sku = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw Object.assign(new Error("Invalid SKU format. Must be a JSON array."), { status: 400 });
  }
  if (!Array.isArray(sku)) throw Object.assign(new Error("Invalid SKU format. Must be a JSON array."), { status: 400 });
  return sku.map((entry) => ({
    _id: entry._id || randomUUID(),
    size: String(entry.size || ""),
    mrp: Number(entry.mrp || 0),
    innerPack: Number(entry.innerPack || 0),
    masterPack: Number(entry.masterPack || 0),
  }));
}

function parseJsonColumn(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function getProductsByIds(ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await getPool().execute(
    `SELECT p.*, c.name AS category_name, c.img AS category_img,
            co.name AS company_name, co.image AS company_image,
            u.full_name AS added_full_name, u.email AS added_email
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN companies co ON co.id = p.company_id
       LEFT JOIN users u ON u.id = p.added_by_whom
      WHERE p.id IN (${placeholders})`,
    ids,
  );

  return rows.map((row) => ({
    ...publicRow(row, {
      name: "name",
      material: "material",
      hsn_code: "hsnCode",
      gst_percentage: "gstPercentage",
      img: "img",
      description: "description",
    }),
    sku: parseJsonColumn(row.sku, []),
    category: row.category_id ? { _id: row.category_id, name: row.category_name, img: row.category_img } : null,
    company: row.company_id ? { _id: row.company_id, name: row.company_name, image: row.company_image } : null,
    addedByWhom: row.added_by_whom ? { _id: row.added_by_whom, fullName: row.added_full_name, email: row.added_email } : null,
  }));
}

async function handleProducts(request, method, route, user, query, body) {
  const actions = { getallproducts: "getallproduct", addproduct: "addproduct", editproduct: "editproduct", deleteproduct: "deleteproduct", getbyids: "getallproduct" };
  const action = actions[route[0]];
  if (!action) return fail("Route not found.", 404);
  const denied = requirePermission(user, action);
  if (denied) return denied;
  const pool = getPool();

  if (route[0] === "getallproducts" && method === "GET") {
    const { page, limit, offset } = validPage(query);
    const search = query.get("search");
    const category = query.get("category");
    const company = query.get("company");
    const conditions = [];
    const params = [];
    if (search) {
      conditions.push("p.name LIKE ?");
      params.push(`%${search}%`);
    }
    if (category) {
      conditions.push("p.category_id = ?");
      params.push(category);
    }
    if (company) {
      conditions.push("p.company_id = ?");
      params.push(company);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [counts] = await pool.execute(`SELECT COUNT(*) AS total FROM products p ${where}`, params);
    const [rows] = await pool.query(
      `SELECT p.id FROM products p ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const productsById = new Map(
      (await getProductsByIds(rows.map((row) => row.id))).map((product) => [product._id, product]),
    );
    const products = rows.map((row) => productsById.get(row.id)).filter(Boolean);
    const total = counts[0].total;
    return json({ success: true, total, page, pages: Math.ceil(total / limit), products });
  }

  if (route[0] === "getbyids" && method === "POST") {
    const { ids } = body;
    if (!Array.isArray(ids) || ids.length === 0) return fail("ids must be a non-empty array.", 400);
    const products = await getProductsByIds(ids);
    return json({
      success: true,
      products,
      productMap: Object.fromEntries(products.map((product) => [product._id, product])),
    });
  }

  if (route[0] === "addproduct" && method === "POST") {
    if (!body.name || !body.category || !body.company) {
      return fail("name, category, and company are required.", 400);
    }
    const sku = parseSku(body.sku) || [];
    const img = await saveImage(body.img, "products");
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO products
        (id, name, category_id, company_id, material, hsn_code, gst_percentage, img, description, sku, added_by_whom)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.name,
        body.category,
        body.company,
        body.material || null,
        body.hsnCode || null,
        Number(body.gstPercentage || 0),
        img,
        body.description || null,
        JSON.stringify(sku),
        user._id,
      ],
    );
    const [product] = await getProductsByIds([id]);
    return json({ success: true, product }, 201);
  }

  if (route[0] === "editproduct" && method === "PUT") {
    const [existing] = await pool.execute("SELECT * FROM products WHERE id = ? LIMIT 1", [route[1]]);
    if (!existing[0]) return fail("Product not found.", 404);
    const current = existing[0];
    const sku = body.sku === undefined ? parseJsonColumn(current.sku, []) : parseSku(body.sku);
    const img = await saveImage(body.img, "products");
    await pool.execute(
      `UPDATE products
          SET name = ?, category_id = ?, company_id = ?, material = ?, hsn_code = ?,
              gst_percentage = ?, img = ?, description = ?, sku = ?
        WHERE id = ?`,
      [
        body.name ?? current.name,
        body.category ?? current.category_id,
        body.company ?? current.company_id,
        body.material ?? current.material,
        body.hsnCode ?? current.hsn_code,
        Number(body.gstPercentage ?? current.gst_percentage),
        img || current.img,
        body.description ?? current.description,
        JSON.stringify(sku),
        route[1],
      ],
    );
    const [product] = await getProductsByIds([route[1]]);
    return json({ success: true, product });
  }

  if (route[0] === "deleteproduct" && method === "DELETE") {
    const [result] = await pool.execute("DELETE FROM products WHERE id = ?", [route[1]]);
    if (!result.affectedRows) return fail("Product not found.", 404);
    return json({ success: true, message: "Product deleted successfully." });
  }

  return fail("Route not found.", 404);
}

async function handleQuotations(request, method, route, user, query, body) {
  if (route[0] === "editquotation") {
    if (!user) return fail("Not logged in. Please login first.", 401);
    if (user.userType !== "admin") return fail("Admin only.", 403);
    if (method !== "PUT") return fail("Method not allowed.", 405);

    const [existing] = await getPool().execute(
      "SELECT id FROM quotations WHERE id = ? LIMIT 1",
      [route[1]],
    );
    if (!existing[0]) return fail("Quotation not found.", 404);

    const clientName = String(body.clientName || "").trim();
    const quotationId = String(body.q_id || "").trim();
    if (!clientName) return fail("Client name is required.", 400);
    if (!/^MH-\d{6}$/.test(quotationId)) return fail("Quotation number must use the format MH-000000.", 400);
    if (!Array.isArray(body.products) || body.products.length === 0) {
      return fail("At least one product is required.", 400);
    }

    const numeric = (value, label, { min = 0 } = {}) => {
      const number = Number(value);
      if (!Number.isFinite(number) || number < min) {
        throw Object.assign(new Error(`${label} must be a valid number greater than or equal to ${min}.`), { status: 400 });
      }
      return number;
    };
    const products = body.products.map((product, index) => {
      const productId = typeof product.product_id === "string"
        ? product.product_id.trim()
        : product.product_id?._id;
      const productName = String(product.productName || "").trim();
      if (!productId || !productName) {
        throw Object.assign(new Error(`Product ${index + 1} must have a product and name.`), { status: 400 });
      }
      const innerPack = numeric(product.innerPack, `Product ${index + 1} inner pack`, { min: 1 });
      const masterPack = numeric(product.masterPack, `Product ${index + 1} master pack`, { min: 1 });
      const quantity = numeric(product.quatity ?? product.quantity, `Product ${index + 1} quantity`, { min: 1 });
      const mrp = numeric(product.mrp, `Product ${index + 1} MRP`);
      const discount = numeric(product.discount, `Product ${index + 1} discount`, { min: 0 });
      const finalPrice = numeric(product.finalPrice, `Product ${index + 1} final price`);
      const gstPercentage = numeric(product.gstPercentage, `Product ${index + 1} GST`);
      if (discount > 100) throw Object.assign(new Error(`Product ${index + 1} discount cannot exceed 100%.`), { status: 400 });
      if (gstPercentage > 100) throw Object.assign(new Error(`Product ${index + 1} GST cannot exceed 100%.`), { status: 400 });

      const totalpcs = innerPack * quantity;
      const total = totalpcs * finalPrice;
      return {
        product_id: productId,
        productName,
        size: String(product.size || "").trim(),
        innerPack,
        masterPack,
        quatity: quantity,
        quantity,
        totalpcs,
        cartoon: Number(((innerPack / masterPack) * quantity).toFixed(2)),
        mrp,
        discount,
        finalPrice,
        gstPercentage,
        total,
      };
    });
    const discount = numeric(body.discount ?? 0, "Global discount");
    if (discount > 100) return fail("Global discount cannot exceed 100%.", 400);
    const termsConditions = normalizeQuotationTerms(body.termsConditions);
    const subtotal = products.reduce((sum, product) => sum + product.total, 0);
    const gstamount = products.reduce(
      (sum, product) => sum + (product.total * product.gstPercentage) / 100,
      0,
    );
    const grandtotal = subtotal + gstamount;
    const date = String(body.createdAt || "");
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      return fail("A valid quotation date is required.", 400);
    }

    try {
      await getPool().execute(
        `UPDATE quotations
            SET q_id = ?, client_name = ?, firm_name = ?, mobile = ?, email = ?, address = ?,
                gst_number = ?, discount = ?, products = ?, terms_conditions = ?, subtotal = ?, gst_amount = ?,
                grandtotal = ?, created_at = ?
          WHERE id = ?`,
        [
          quotationId,
          clientName,
          String(body.firmName || "").trim() || null,
          body.mobile == null ? null : String(body.mobile).trim() || null,
          String(body.email || "").trim() || null,
          String(body.address || "").trim() || null,
          String(body.gstNumber || "").trim() || null,
          discount,
          JSON.stringify(products),
          JSON.stringify(termsConditions),
          subtotal,
          gstamount,
          grandtotal,
          `${date} 00:00:00`,
          route[1],
        ],
      );
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") return fail("That quotation number is already in use.", 409);
      throw error;
    }
    const [rows] = await getPool().execute("SELECT * FROM quotations WHERE id = ?", [route[1]]);
    return json({ success: true, message: "Quotation updated successfully.", data: quotationRow(rows[0]) });
  }

  const denied = requirePermission(user, method === "POST" ? "addquotation" : "getallquotation");
  if (denied) return denied;
  const pool = getPool();

  if (route[0] === "addquotation" && method === "POST") {
    if (!body.clientName) return fail("Client Name is required.", 400);
    const products = Array.isArray(body.products) ? body.products : [];
    const connection = await pool.getConnection();
    let id;
    let quotationId;
    try {
      await connection.beginTransaction();
      const [sequence] = await connection.query(
        "SELECT next_value FROM quotation_sequences WHERE id = 1 FOR UPDATE",
      );
      const next = Number(sequence[0].next_value);
      if (next > 999999) throw new Error("Quotation ID limit reached (MH-999999).");
      quotationId = `MH-${String(next).padStart(6, "0")}`;
      await connection.execute("UPDATE quotation_sequences SET next_value = ? WHERE id = 1", [next + 1]);
      id = randomUUID();
      await connection.execute(
        `INSERT INTO quotations
          (id, q_id, client_name, firm_name, mobile, email, address, gst_number, discount,
           products, terms_conditions, subtotal, gst_amount, grandtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          quotationId,
          body.clientName,
          body.firmName || null,
          body.mobile == null ? null : String(body.mobile),
          body.email || null,
          body.address || null,
          body.gstNumber || null,
          body.discount ?? null,
          JSON.stringify(products),
          JSON.stringify(normalizeQuotationTerms(body.termsConditions)),
          body.Subtotal ?? null,
          body.gstamount ?? null,
          body.grandtotal ?? null,
        ],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const [rows] = await pool.execute("SELECT * FROM quotations WHERE id = ?", [id]);
    return json({
      success: true,
      message: "Quotation created successfully.",
      data: quotationRow(rows[0]),
    }, 201);
  }

  if (route[0] === "getallquotations" && method === "GET") {
    const { page, limit, offset } = validPage(query);
    const conditions = [];
    const params = [];
    const search = query.get("search");
    if (search) {
      conditions.push("(q_id LIKE ? OR client_name LIKE ? OR firm_name LIKE ? OR email LIKE ? OR mobile LIKE ?)");
      params.push(...Array.from({ length: 5 }, () => `%${search}%`));
    }
    for (const [key, column] of [["clientName", "client_name"], ["firmName", "firm_name"]]) {
      const value = query.get(key);
      if (value) {
        conditions.push(`${column} LIKE ?`);
        params.push(`%${value}%`);
      }
    }
    if (query.get("from")) {
      conditions.push("created_at >= ?");
      params.push(query.get("from"));
    }
    if (query.get("to")) {
      conditions.push("created_at <= ?");
      params.push(query.get("to"));
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const sortColumns = { createdAt: "created_at", clientName: "client_name", firmName: "firm_name", q_id: "q_id" };
    const sort = sortColumns[query.get("sortBy")] || "created_at";
    const order = query.get("sortOrder") === "asc" ? "ASC" : "DESC";
    const [counts] = await pool.execute(`SELECT COUNT(*) AS total FROM quotations ${where}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM quotations ${where} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = counts[0].total;
    const totalPages = Math.ceil(total / limit);
    const data = rows.map(quotationRow);
    const productIds = [...new Set(data.flatMap((quotation) =>
      quotation.products.map((product) =>
        typeof product.product_id === "string" ? product.product_id : product.product_id?._id,
      ).filter(Boolean),
    ))];
    const products = await getProductsByIds(productIds);
    const productNames = new Map(products.map((product) => [product._id, product.name]));
    for (const quotation of data) {
      quotation.products = quotation.products.map((product) => ({
        ...product,
        product_id: typeof product.product_id === "string"
          ? { _id: product.product_id, name: productNames.get(product.product_id) }
          : product.product_id,
      }));
    }
    return json({
      success: true,
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  }

  return fail("Route not found.", 404);
}

function quotationRow(row) {
  const termsConditions = normalizeQuotationTerms(
    parseJsonColumn(row.terms_conditions, { selected: [], paymentTerms: "" }),
  );
  // Quotes created before `paymentTerms` was accepted as a selected ID still
  // contain the entered text. Treat that text as an enabled payment term.
  if (termsConditions.paymentTerms && !termsConditions.selected.includes("paymentTerms")) {
    termsConditions.selected.push("paymentTerms");
  }

  return {
    _id: row.id,
    q_id: row.q_id,
    clientName: row.client_name,
    firmName: row.firm_name,
    mobile: row.mobile,
    email: row.email,
    address: row.address,
    gstNumber: row.gst_number,
    discount: row.discount,
    products: parseJsonColumn(row.products, []),
    termsConditions,
    Subtotal: row.subtotal,
    gstamount: row.gst_amount,
    grandtotal: row.grandtotal,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeQuotationTerms(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { selected: [], paymentTerms: "" };
  }
  const selected = Array.isArray(value.selected)
    ? [...new Set(value.selected.filter((id) => typeof id === "string" && /^[a-z][A-Za-z-]*$/.test(id)))]
    : [];
  const paymentTerms = typeof value.paymentTerms === "string"
    ? value.paymentTerms.trim().slice(0, 1000)
    : "";
  return { selected, paymentTerms };
}

async function handleWhatsApp(request, method, route, user, body) {
  if (!user) return fail("Not logged in. Please login first.", 401);
  const userId = user._id;
  const service = getWhatsAppService();

  if (route[0] === "status" && method === "GET") {
    return json({ success: true, ...service.getStatusForUser(userId) });
  }
  if (route[0] === "qr" && method === "GET") {
    const { qr, status } = service.getStatusForUser(userId);
    return qr
      ? json({ success: true, qr })
      : json({ success: false, message: status === "ready" ? "Already authenticated." : "No QR available. Try connecting first." });
  }
  if (route[0] === "connect" && method === "POST") {
    const { status } = service.getStatusForUser(userId);
    if (status === "ready") return json({ success: true, message: "Already connected." });
    if (status === "initializing" || status === "qr_pending") {
      return json({ success: true, message: "Already initializing. Check /qr for QR code." });
    }
    service.initClientForUser(userId);
    return json({ success: true, message: "WhatsApp initialization started. Poll /status for updates." });
  }
  if (route[0] === "disconnect" && method === "POST") {
    await service.logoutUser(userId);
    return json({ success: true, message: "WhatsApp disconnected." });
  }
  if (route[0] === "reset" && method === "POST") {
    await service.logoutUser(userId);
    return json({ success: true, message: "Session reset. You can now reconnect." });
  }
  if (route[0] === "send-quotation" && method === "POST") {
    const { to, caption, pdf } = body;
    if (!to) return fail("Recipient number (to) is required.", 400);
    if (!pdf) return fail("PDF data is required.", 400);
    const { status } = service.getStatusForUser(userId);
    if (status !== "ready") return fail(`Your WhatsApp is not connected. Status: ${status}. Please connect first.`, 503);
    await service.sendPDFAsUser(userId, to, Buffer.from(pdf, "base64"), caption || "Please find your quotation attached.\n\n- Mahaveer Hospitality");
    return json({ success: true, message: `Quotation sent to ${to} on WhatsApp.` });
  }
  if (route[0] === "sessions" && method === "GET") {
    if (user.userType !== "admin") return fail("Admin only.", 403);
    return json({ success: true, sessions: service.getAllSessions() });
  }
  return fail("Route not found.", 404);
}

async function dispatch(request, context) {
  try {
    await initializeDatabase();
    const { path: segments = [] } = await context.params;
    const route = segments.map((segment) => decodeURIComponent(segment));
    const [area, ...tail] = route;
    const method = request.method;
    const query = new URL(request.url).searchParams;
    const body = ["POST", "PUT", "PATCH", "DELETE"].includes(method)
      ? await readBody(request)
      : {};
    const user = area === "auth" ? null : await getCurrentUser(request);

    if (area === "auth") return handleAuth(request, method, tail.join("/"), body);
    if (area === "users") return handleUsers(request, method, tail, user, query, body);
    if (area === "company") return handleCompanies(request, method, tail, user, query, body);
    if (area === "category") return handleCategories(request, method, tail, user, query, body);
    if (area === "products") return handleProducts(request, method, tail, user, query, body);
    if (area === "quotations") return handleQuotations(request, method, tail, user, query, body);
    if (area === "whatsapp") return handleWhatsApp(request, method, tail, user, body);
    return fail("Route not found.", 404);
  } catch (error) {
    console.error(`[API ERROR] ${request.method} ${request.url}`, error);
    if (error.code === "ER_DUP_ENTRY") {
      return fail("Email, username, or mobile already in use.", 409);
    }
    return fail(error.message || "Something went wrong.", error.status || 500);
  }
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
