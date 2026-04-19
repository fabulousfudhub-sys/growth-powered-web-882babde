import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

const JWT_SECRET =
  Deno.env.get("JWT_SECRET") || "atapoly-cbt-secret-key-change-in-production";

async function verifyJWT(token: string) {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC", key,
      Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
      enc.encode(`${h}.${p}`),
    );
    if (!valid) return null;
    const payload = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch { return null; }
}

async function signJWT(payload: any) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=/g, "");
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const body = btoa(JSON.stringify({ ...payload, exp, iat: Math.floor(Date.now() / 1000) })).replace(/=/g, "");
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${body}`));
  const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return `${header}.${body}.${sigStr}`;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabase() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function maskLicenseKey(licenseKey: string | null | undefined) {
  if (!licenseKey) return null;
  if (licenseKey.length <= 8) return "****";
  return `${licenseKey.slice(0, 4)}****${licenseKey.slice(-4)}`;
}

function readLicenseStatus(settings: Record<string, any> | null | undefined) {
  const cache = settings?.licenseCache as
    | { licenseKey?: string; expiresAt?: string | null; lastChecked?: string | null }
    | undefined;

  if (!cache?.licenseKey) {
    return {
      active: false,
      expired: false,
      expiresAt: null,
      licenseKey: null,
      lastChecked: null,
    };
  }

  if (!cache.expiresAt) {
    return {
      active: true,
      expired: false,
      expiresAt: null,
      licenseKey: maskLicenseKey(cache.licenseKey),
      lastChecked: cache.lastChecked || null,
    };
  }

  const expired = new Date(cache.expiresAt).getTime() <= Date.now();
  return {
    active: !expired,
    expired,
    expiresAt: cache.expiresAt,
    licenseKey: maskLicenseKey(cache.licenseKey),
    lastChecked: cache.lastChecked || null,
  };
}

async function getStoredSettings(sb: ReturnType<typeof getSupabase>) {
  const { data } = await sb.from("site_settings").select("settings").eq("id", 1).single();
  return ((data?.settings as Record<string, any> | null) || {}) as Record<string, any>;
}

async function saveStoredSettings(sb: ReturnType<typeof getSupabase>, settings: Record<string, any>) {
  await sb.from("site_settings").upsert(
    { id: 1, settings, updated_at: new Date().toISOString() },
    { onConflict: "id" },
  );
}

function sanitizeSettings(settings: Record<string, any>) {
  const { licenseCache, ...rest } = settings || {};
  return rest;
}

async function validateLicenseKeyRecord(sb: ReturnType<typeof getSupabase>, licenseKey: string) {
  const { data, error } = await sb.from("license_keys")
    .select("license_key, active, expires_at")
    .eq("license_key", licenseKey)
    .maybeSingle();

  if (error) {
    console.error("[license] validation error", error);
    return { ok: false as const, status: 500, error: "Failed to validate license key" };
  }

  if (!data) {
    return { ok: false as const, status: 400, error: "License key not found" };
  }

  if (!data.active) {
    return { ok: false as const, status: 400, error: "License key has been revoked" };
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return { ok: false as const, status: 400, error: "License key has expired" };
  }

  return {
    ok: true as const,
    expiresAt: data.expires_at || null,
    licenseKey: data.license_key,
  };
}

async function handleLicense(method: string, path: string, body: any, user?: any) {
  const sb = getSupabase();

  if (method === "GET" && path === "/api/license/public-status") {
    const settings = await getStoredSettings(sb);
    const status = readLicenseStatus(settings);
    return json({
      active: status.active,
      expired: status.expired,
      expiresAt: status.expiresAt,
      licenseKey: status.licenseKey,
    });
  }

  if (method === "POST" && path === "/api/license/public-activate") {
    const key = typeof body?.licenseKey === "string" ? body.licenseKey.trim() : "";
    if (key.length < 4) return json({ error: "Invalid license key" }, 400);

    const validation = await validateLicenseKeyRecord(sb, key);
    if (!validation.ok) return json({ error: validation.error }, validation.status);

    const settings = await getStoredSettings(sb);
    settings.licenseCache = {
      licenseKey: validation.licenseKey,
      expiresAt: validation.expiresAt,
      lastChecked: new Date().toISOString(),
    };
    await saveStoredSettings(sb, settings);
    return json({ success: true, message: "License activated successfully" });
  }

  if (path.startsWith("/api/license/")) {
    if (!user) return json({ error: "Unauthorized" }, 401);
    if (user.role !== "super_admin") return json({ error: "Forbidden" }, 403);

    if (method === "GET" && path === "/api/license/status") {
      const settings = await getStoredSettings(sb);
      const status = readLicenseStatus(settings);
      return json(status);
    }

    if (method === "POST" && path === "/api/license/activate") {
      const key = typeof body?.licenseKey === "string" ? body.licenseKey.trim() : "";
      if (key.length < 4) return json({ error: "Invalid license key" }, 400);

      const validation = await validateLicenseKeyRecord(sb, key);
      if (!validation.ok) return json({ error: validation.error }, validation.status);

      const settings = await getStoredSettings(sb);
      settings.licenseCache = {
        licenseKey: validation.licenseKey,
        expiresAt: validation.expiresAt,
        lastChecked: new Date().toISOString(),
      };
      await saveStoredSettings(sb, settings);
      return json({ success: true, message: "License activated successfully" });
    }

    if (method === "POST" && path === "/api/license/deactivate") {
      const settings = await getStoredSettings(sb);
      delete settings.licenseCache;
      await saveStoredSettings(sb, settings);
      return json({ success: true, message: "License deactivated" });
    }
  }

  return null;
}

// ───────────────────────── AUTH ROUTES ─────────────────────────

async function handleStaffLogin(body: any) {
  const { email, password } = body;
  if (!email || !password) return json({ error: "Email and password required" }, 400);
  const sb = getSupabase();

  const { data: users } = await sb.from("users")
    .select("id, name, email, role, password_hash, level, department_id")
    .eq("email", email).neq("role", "student").limit(1);

  if (!users?.length) return json({ error: "Invalid credentials" }, 401);
  const user = users[0];

  const { data: valid } = await sb.rpc("check_password", { _password: password, _hash: user.password_hash });
  if (!valid) return json({ error: "Invalid credentials" }, 401);

  await sb.from("users").update({ last_login: new Date().toISOString() }).eq("id", user.id);

  let department: string | null = null;
  if (user.department_id) {
    const { data: d } = await sb.from("departments").select("name").eq("id", user.department_id).single();
    department = d?.name || null;
  }

  const token = await signJWT({ id: user.id, role: user.role, name: user.name });
  return json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, department, level: user.level },
  });
}

async function handleMe(user: any) {
  const sb = getSupabase();
  const { data: u } = await sb.from("users")
    .select("id, name, email, role, reg_number, level, department_id")
    .eq("id", user.id).single();
  if (!u) return json({ error: "User not found" }, 404);

  let department: string | null = null;
  if (u.department_id) {
    const { data: d } = await sb.from("departments").select("name").eq("id", u.department_id).single();
    department = d?.name || null;
  }

  return json({
    user: { id: u.id, name: u.name, email: u.email, role: u.role, regNumber: u.reg_number, department, level: u.level },
  });
}

// ───────────────────────── ADMIN CRUD ─────────────────────────

async function handleUsers(method: string, path: string, body: any, user: any) {
  const sb = getSupabase();
  const idMatch = path.match(/\/users\/([^/]+)$/);

  if (method === "GET" && !idMatch) {
    const { data } = await sb.from("users")
      .select("id, name, email, role, reg_number, level, last_login, department_id")
      .order("created_at", { ascending: false });

    const deptIds = [...new Set((data || []).map((u: any) => u.department_id).filter(Boolean))];
    let deptMap: Record<string, string> = {};
    if (deptIds.length) {
      const { data: depts } = await sb.from("departments").select("id, name").in("id", deptIds);
      (depts || []).forEach((d: any) => { deptMap[d.id] = d.name; });
    }

    return json((data || []).map((r: any) => ({
      id: r.id, name: r.name, email: r.email, role: r.role,
      regNumber: r.reg_number, level: r.level, lastLogin: r.last_login,
      department: deptMap[r.department_id] || null,
    })));
  }

  if (method === "POST" && !idMatch) {
    const { name, email, password, role, regNumber, departmentId, level } = body;
    const { data: hash } = await sb.rpc("hash_password", { _password: password || "changeme123" });
    const { data, error } = await sb.from("users").insert({
      name, email: email || null, password_hash: hash, role,
      reg_number: regNumber || null, department_id: departmentId || null, level: level || null,
    }).select("id").single();
    if (error) return json({ error: error.code === "23505" ? "User already exists" : error.message }, error.code === "23505" ? 409 : 500);
    return json({ id: data.id }, 201);
  }

  if (method === "PUT" && idMatch) {
    const id = idMatch[1];
    const { name, email, role, regNumber, departmentId, level, password } = body;
    const updates: any = { name, email: email || null, role, reg_number: regNumber || null, department_id: departmentId || null, level: level || null };
    if (password) {
      const { data: hash } = await sb.rpc("hash_password", { _password: password });
      updates.password_hash = hash;
    }
    await sb.from("users").update(updates).eq("id", id);
    return json({ success: true });
  }

  if (method === "DELETE" && idMatch) {
    await sb.from("users").delete().eq("id", idMatch[1]);
    return json({ success: true });
  }
  return null;
}

async function handleSchools(method: string, path: string, body: any) {
  const sb = getSupabase();
  const idMatch = path.match(/\/schools\/([^/]+)$/);

  if (method === "GET" && !idMatch) {
    const { data } = await sb.from("schools").select("id, name").order("name");
    return json(data || []);
  }
  if (method === "POST" && !idMatch) {
    const { data, error } = await sb.from("schools").insert({ name: body.name }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    return json({ id: data.id }, 201);
  }
  if (method === "PUT" && idMatch) {
    await sb.from("schools").update({ name: body.name }).eq("id", idMatch[1]);
    return json({ success: true });
  }
  if (method === "DELETE" && idMatch) {
    await sb.from("schools").delete().eq("id", idMatch[1]);
    return json({ success: true });
  }
  return null;
}

async function handleDepartments(method: string, path: string, body: any, url: URL) {
  const sb = getSupabase();
  const idMatch = path.match(/\/departments\/([^/]+)$/);

  if (method === "GET" && !idMatch) {
    const schoolId = url.searchParams.get("schoolId");
    let q = sb.from("departments").select("id, name, school_id, programmes, levels, examiner_id");
    if (schoolId) q = q.eq("school_id", schoolId);
    const { data } = await q.order("name");

    const schoolIds = [...new Set((data || []).map((d: any) => d.school_id))];
    let schoolMap: Record<string, string> = {};
    if (schoolIds.length) {
      const { data: schools } = await sb.from("schools").select("id, name").in("id", schoolIds);
      (schools || []).forEach((s: any) => { schoolMap[s.id] = s.name; });
    }

    return json((data || []).map((d: any) => ({
      id: d.id, name: d.name, school: schoolMap[d.school_id] || "", school_id: d.school_id,
      programmes: d.programmes || [], levels: d.levels || [], examinerId: d.examiner_id,
    })));
  }
  if (method === "POST" && !idMatch) {
    const { name, schoolId, programmes, levels } = body;
    const { data, error } = await sb.from("departments").insert({
      name, school_id: schoolId, programmes: programmes || [], levels: levels || [],
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    return json({ id: data.id }, 201);
  }
  if (method === "PUT" && idMatch) {
    const { name, schoolId, programmes, levels, examinerId } = body;
    await sb.from("departments").update({
      name, school_id: schoolId, programmes: programmes || [], levels: levels || [],
      examiner_id: examinerId || null,
    }).eq("id", idMatch[1]);
    return json({ success: true });
  }
  if (method === "DELETE" && idMatch) {
    await sb.from("departments").delete().eq("id", idMatch[1]);
    return json({ success: true });
  }
  return null;
}

async function handleCourses(method: string, path: string, body: any, url: URL) {
  const sb = getSupabase();
  const idMatch = path.match(/\/courses\/([^/]+)$/);

  if (method === "GET" && !idMatch) {
    const departmentId = url.searchParams.get("departmentId");
    let q = sb.from("courses").select("id, code, title, department_id, school_id, programme, level, instructor_id");
    if (departmentId) q = q.eq("department_id", departmentId);
    const { data } = await q.order("code");

    const deptIds = [...new Set((data || []).map((c: any) => c.department_id))];
    const schoolIds = [...new Set((data || []).map((c: any) => c.school_id))];
    const instrIds = [...new Set((data || []).map((c: any) => c.instructor_id).filter(Boolean))];

    let deptMap: Record<string, string> = {}, schoolMap: Record<string, string> = {}, instrMap: Record<string, string> = {};
    if (deptIds.length) { const { data: d } = await sb.from("departments").select("id, name").in("id", deptIds); (d || []).forEach((x: any) => { deptMap[x.id] = x.name; }); }
    if (schoolIds.length) { const { data: s } = await sb.from("schools").select("id, name").in("id", schoolIds); (s || []).forEach((x: any) => { schoolMap[x.id] = x.name; }); }
    if (instrIds.length) { const { data: u } = await sb.from("users").select("id, name").in("id", instrIds); (u || []).forEach((x: any) => { instrMap[x.id] = x.name; }); }

    return json((data || []).map((c: any) => ({
      id: c.id, code: c.code, title: c.title,
      department: deptMap[c.department_id] || "", school: schoolMap[c.school_id] || "",
      programme: c.programme, level: c.level,
      instructor: instrMap[c.instructor_id] || "", instructorId: c.instructor_id,
    })));
  }
  if (method === "POST" && !idMatch) {
    const { code, title, departmentId, programme, level, instructorId } = body;
    if (!departmentId) return json({ error: "departmentId is required" }, 400);
    const { data: dept } = await sb.from("departments").select("school_id").eq("id", departmentId).single();
    if (!dept) return json({ error: "Invalid departmentId" }, 400);
    const { data, error } = await sb.from("courses").insert({
      code, title, department_id: departmentId, school_id: dept.school_id,
      programme: programme || null, level: level || null, instructor_id: instructorId || null,
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    return json({ id: data.id }, 201);
  }
  if (method === "PUT" && idMatch) {
    const { code, title, departmentId, schoolId, programme, level, instructorId } = body;
    let finalSchoolId = schoolId;
    if (!finalSchoolId && departmentId) {
      const { data: dept } = await sb.from("departments").select("school_id").eq("id", departmentId).single();
      if (dept) finalSchoolId = dept.school_id;
    }
    await sb.from("courses").update({
      code, title, department_id: departmentId, school_id: finalSchoolId,
      programme: programme || null, level: level || null, instructor_id: instructorId || null,
    }).eq("id", idMatch[1]);
    return json({ success: true });
  }
  if (method === "DELETE" && idMatch) {
    await sb.from("courses").delete().eq("id", idMatch[1]);
    return json({ success: true });
  }
  return null;
}

// ───────────────────────── EXAMS ─────────────────────────

async function handleExams(method: string, path: string, body: any, user: any, url: URL) {
  const sb = getSupabase();

  // List exams
  if (method === "GET" && path === "/api/exams") {
    const department = url.searchParams.get("department");
    let q = sb.from("exams").select("*, courses(code, title), departments(name), schools(name)");
    const { data } = await q.order("created_at", { ascending: false });

    const examIds = (data || []).map((e: any) => e.id);
    let pinCounts: Record<string, number> = {};
    if (examIds.length) {
      // Get pin counts in batches
      for (const eid of examIds) {
        const { count } = await sb.from("exam_pins").select("*", { count: "exact", head: true }).eq("exam_id", eid);
        pinCounts[eid] = count || 0;
      }
    }

    let filtered = data || [];
    if (department) {
      filtered = filtered.filter((e: any) => e.departments?.name === department);
    }

    return json(filtered.map((r: any) => ({
      id: r.id, title: r.title, course: r.courses?.code, courseTitle: r.courses?.title,
      department: r.departments?.name, school: r.schools?.name,
      programme: r.programme, level: r.level, duration: r.duration,
      totalQuestions: r.total_questions, questionsToAnswer: r.questions_to_answer,
      totalMarks: parseFloat(r.total_marks), startDate: r.start_date, endDate: r.end_date,
      status: r.status, instructions: r.instructions,
      enrolledStudents: pinCounts[r.id] || 0,
      createdBy: r.created_by, pinMode: r.pin_mode, sharedPin: r.shared_pin,
    })));
  }

  // Single exam
  const singleMatch = path.match(/^\/api\/exams\/([^/]+)$/);
  if (method === "GET" && singleMatch) {
    const { data: r } = await sb.from("exams")
      .select("*, courses(code, title), departments(name), schools(name)")
      .eq("id", singleMatch[1]).single();
    if (!r) return json({ error: "Exam not found" }, 404);
    const { count } = await sb.from("exam_pins").select("*", { count: "exact", head: true }).eq("exam_id", r.id);
    return json({
      id: r.id, title: r.title, course: r.courses?.code, courseTitle: r.courses?.title,
      department: r.departments?.name, school: r.schools?.name,
      programme: r.programme, level: r.level, duration: r.duration,
      totalQuestions: r.total_questions, questionsToAnswer: r.questions_to_answer,
      totalMarks: parseFloat(r.total_marks), startDate: r.start_date, endDate: r.end_date,
      status: r.status, instructions: r.instructions,
      enrolledStudents: count || 0, createdBy: r.created_by, pinMode: r.pin_mode, sharedPin: r.shared_pin,
    });
  }

  // Create exam
  if (method === "POST" && path === "/api/exams") {
    const { title, courseId, departmentId, programme, level, duration,
      totalQuestions, questionsToAnswer, totalMarks, startDate, endDate,
      instructions, carryoverStudentIds, pinMode } = body;
    if (!title || !courseId || !departmentId) return json({ error: "title, courseId, departmentId required" }, 400);

    const { data: course } = await sb.from("courses").select("school_id").eq("id", courseId).single();
    if (!course) return json({ error: "Invalid courseId" }, 400);

    const { data: exam, error } = await sb.from("exams").insert({
      title, course_id: courseId, department_id: departmentId, school_id: course.school_id,
      programme: programme || null, level: level || null,
      duration: duration || 45, total_questions: totalQuestions || 20,
      questions_to_answer: questionsToAnswer || 20, total_marks: totalMarks || 40,
      start_date: startDate || null, end_date: endDate || null,
      instructions: instructions || null, pin_mode: pinMode || "individual", created_by: user.id,
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);

    // Assign questions
    const { data: bankQ } = await sb.from("questions").select("id").eq("course_id", courseId).limit(totalQuestions || 20);
    const shuffled = (bankQ || []).sort(() => Math.random() - 0.5);
    if (shuffled.length > 0) {
      await sb.from("exam_questions").insert(
        shuffled.map((q: any, i: number) => ({ exam_id: exam.id, question_id: q.id, sort_order: i + 1 }))
      );
    }

    // Carryover students
    if (carryoverStudentIds?.length) {
      for (const sid of carryoverStudentIds) {
        const pin = String(Math.floor(10000000 + Math.random() * 90000000));
        await sb.from("exam_pins").upsert({ exam_id: exam.id, student_id: sid, pin }, { onConflict: "exam_id,student_id" });
      }
    }

    return json({ id: exam.id, questionsAssigned: shuffled.length }, 201);
  }

  // Update exam
  if (method === "PUT" && singleMatch) {
    const { title, courseId, departmentId, schoolId, programme, level, duration,
      totalQuestions, questionsToAnswer, totalMarks, startDate, endDate, instructions, status } = body;
    let finalSchoolId = schoolId;
    if (!finalSchoolId && departmentId) {
      const { data: dept } = await sb.from("departments").select("school_id").eq("id", departmentId).single();
      if (dept) finalSchoolId = dept.school_id;
    }
    const updates: any = {
      title, course_id: courseId, department_id: departmentId, school_id: finalSchoolId,
      programme: programme || null, level: level || null, duration, total_questions: totalQuestions,
      questions_to_answer: questionsToAnswer, total_marks: totalMarks,
      start_date: startDate || null, end_date: endDate || null, instructions: instructions || null,
    };
    if (status) updates.status = status;
    await sb.from("exams").update(updates).eq("id", singleMatch[1]);
    return json({ success: true });
  }

  // Delete exam
  if (method === "DELETE" && singleMatch) {
    await sb.from("exams").delete().eq("id", singleMatch[1]);
    return json({ success: true });
  }

  // Status update
  const statusMatch = path.match(/^\/api\/exams\/([^/]+)\/status$/);
  if (method === "PATCH" && statusMatch) {
    const newStatus = body.status;
    await sb.from("exams").update({ status: newStatus }).eq("id", statusMatch[1]);
    if (newStatus === "completed") {
      const { data: attempts } = await sb.from("exam_attempts").select("id").eq("exam_id", statusMatch[1]).eq("status", "in_progress");
      for (const a of (attempts || [])) {
        await autoSubmitAttemptCloud(sb, a.id);
      }
    }
    return json({ success: true, autoSubmitted: newStatus === "completed" });
  }

  // Generate PINs
  const pinGenMatch = path.match(/^\/api\/exams\/([^/]+)\/generate-pins$/);
  if (method === "POST" && pinGenMatch) {
    const examId = pinGenMatch[1];
    const mode = body.mode || "individual";
    const { data: exam } = await sb.from("exams").select("*").eq("id", examId).single();
    if (!exam) return json({ error: "Exam not found" }, 404);

    if (mode === "shared") {
      const sharedPin = String(Math.floor(10000000 + Math.random() * 90000000));
      await sb.from("exams").update({ pin_mode: "shared", shared_pin: sharedPin }).eq("id", examId);
      return json({ pins: [{ studentName: "All Eligible Students", matricNumber: "—", pin: sharedPin }], count: 1, mode: "shared" });
    }

    // Individual mode - get eligible students
    let q = sb.from("users").select("id, name, reg_number").eq("role", "student").eq("department_id", exam.department_id);
    if (exam.level) q = q.eq("level", exam.level);
    const { data: students } = await q;

    // Also get carryover students
    const { data: carryoverPins } = await sb.from("exam_pins").select("student_id").eq("exam_id", examId);
    const carryoverIds = new Set((carryoverPins || []).map((p: any) => p.student_id));
    const allStudentIds = new Set((students || []).map((s: any) => s.id));
    const extraIds = [...carryoverIds].filter(id => !allStudentIds.has(id));

    let extraStudents: any[] = [];
    if (extraIds.length) {
      const { data } = await sb.from("users").select("id, name, reg_number").in("id", extraIds);
      extraStudents = data || [];
    }

    const allStudents = [...(students || []), ...extraStudents];
    if (!allStudents.length) return json({ pins: [], count: 0, message: "No eligible students" });

    const pins: any[] = [];
    for (const s of allStudents) {
      const pin = String(Math.floor(10000000 + Math.random() * 90000000));
      await sb.from("exam_pins").upsert(
        { exam_id: examId, student_id: s.id, pin, used: false },
        { onConflict: "exam_id,student_id" }
      );
      pins.push({ studentName: s.name, matricNumber: s.reg_number, pin });
    }
    await sb.from("exams").update({ pin_mode: "individual", shared_pin: null }).eq("id", examId);
    return json({ pins, count: pins.length, mode: "individual" });
  }

  // Get PINs
  const pinsMatch = path.match(/^\/api\/exams\/([^/]+)\/pins$/);
  if (method === "GET" && pinsMatch) {
    const { data } = await sb.from("exam_pins").select("pin, student_id, used").eq("exam_id", pinsMatch[1]);
    const studentIds = (data || []).map((p: any) => p.student_id);
    let studentMap: Record<string, any> = {};
    if (studentIds.length) {
      const { data: users } = await sb.from("users").select("id, name, reg_number").in("id", studentIds);
      (users || []).forEach((u: any) => { studentMap[u.id] = u; });
    }
    return json((data || []).map((p: any) => ({
      pin: p.pin, studentName: studentMap[p.student_id]?.name || "", matricNumber: studentMap[p.student_id]?.reg_number || "", used: p.used,
    })));
  }

  // Assign questions
  const assignMatch = path.match(/^\/api\/exams\/([^/]+)\/assign-questions$/);
  if (method === "POST" && assignMatch) {
    const examId = assignMatch[1];
    const { data: exam } = await sb.from("exams").select("*").eq("id", examId).single();
    if (!exam) return json({ error: "Exam not found" }, 404);
    await sb.from("exam_questions").delete().eq("exam_id", examId);
    const { data: q } = await sb.from("questions").select("id").eq("course_id", exam.course_id).limit(exam.total_questions);
    const shuffled = (q || []).sort(() => Math.random() - 0.5);
    if (shuffled.length) {
      await sb.from("exam_questions").insert(shuffled.map((x: any, i: number) => ({ exam_id: examId, question_id: x.id, sort_order: i + 1 })));
    }
    return json({ success: true, assigned: shuffled.length });
  }

  // Carryover students
  const carryMatch = path.match(/^\/api\/exams\/([^/]+)\/carryover-students$/);
  if (method === "POST" && carryMatch) {
    const { studentIds } = body;
    if (!studentIds?.length) return json({ error: "studentIds required" }, 400);
    let added = 0;
    for (const sid of studentIds) {
      const pin = String(Math.floor(10000000 + Math.random() * 90000000));
      const { error } = await sb.from("exam_pins").upsert({ exam_id: carryMatch[1], student_id: sid, pin }, { onConflict: "exam_id,student_id" });
      if (!error) added++;
    }
    return json({ success: true, added });
  }

  // Monitoring
  const monitorMatch = path.match(/^\/api\/exams\/([^/]+)\/monitoring$/);
  if (method === "GET" && monitorMatch) {
    const { data: exam } = await sb.from("exams").select("*, courses(code)").eq("id", monitorMatch[1]).single();
    if (!exam) return json({ error: "Exam not found" }, 404);
    const { data: attempts } = await sb.from("exam_attempts")
      .select("id, student_id, started_at, status, submitted_at, score, users(name, reg_number)")
      .eq("exam_id", monitorMatch[1]);

    const now = Date.now();
    const students = (attempts || []).map((a: any) => {
      let remainingSeconds = 0;
      if (a.status === "in_progress" && a.started_at) {
        const elapsed = Math.floor((now - new Date(a.started_at).getTime()) / 1000);
        remainingSeconds = Math.max(0, exam.duration * 60 - elapsed);
      }
      return {
        attemptId: a.id, studentId: a.student_id, studentName: a.users?.name,
        regNumber: a.users?.reg_number, status: a.status, startedAt: a.started_at,
        submittedAt: a.submitted_at, score: a.score, remainingSeconds,
      };
    });

    return json({
      examId: exam.id, examTitle: exam.title, course: exam.courses?.code,
      duration: exam.duration, totalQuestions: exam.questions_to_answer,
      totalEnrolled: students.length, students,
    });
  }

  // Reset attempt
  const resetMatch = path.match(/^\/api\/exams\/([^/]+)\/reset-attempt$/);
  if (method === "POST" && resetMatch) {
    const { studentId } = body;
    if (!studentId) return json({ error: "studentId required" }, 400);
    const { data: attempts } = await sb.from("exam_attempts").select("id").eq("exam_id", resetMatch[1]).eq("student_id", studentId);
    const ids = (attempts || []).map((a: any) => a.id);
    if (ids.length) {
      await sb.from("answers").delete().in("attempt_id", ids);
      await sb.from("exam_attempts").delete().in("id", ids);
    }
    await sb.from("exam_pins").update({ used: false, used_at: null }).eq("exam_id", resetMatch[1]).eq("student_id", studentId);
    return json({ success: true });
  }

  return null;
}

async function autoSubmitAttemptCloud(sb: any, attemptId: string) {
  const { data: attempt } = await sb.from("exam_attempts")
    .select("*, exams(total_marks, questions_to_answer)")
    .eq("id", attemptId).eq("status", "in_progress").single();
  if (!attempt) return;

  const { data: answers } = await sb.from("answers")
    .select("question_id, answer, questions(correct_answer, type)")
    .eq("attempt_id", attemptId);

  let correct = 0;
  const marksPerQ = parseFloat(attempt.exams.total_marks) / attempt.exams.questions_to_answer;
  for (const sa of (answers || [])) {
    if (sa.questions.type === "essay" || sa.questions.type === "short_answer") continue;
    const ca = sa.questions.correct_answer;
    if (typeof ca === "string" && sa.answer?.toLowerCase() === ca.toLowerCase()) correct++;
    else if (Array.isArray(ca) && ca.map((a: string) => a.toLowerCase()).includes(sa.answer?.toLowerCase())) correct++;
  }

  await sb.from("exam_attempts").update({
    submitted_at: new Date().toISOString(), score: correct * marksPerQ,
    total_marks: attempt.exams.total_marks, status: "submitted",
  }).eq("id", attemptId);
}

// ───────────────────────── QUESTIONS ─────────────────────────

async function handleQuestions(method: string, path: string, body: any, user: any, url: URL) {
  const sb = getSupabase();

  // Get questions for exam (student)
  const examMatch = path.match(/^\/api\/questions\/exam\/([^/]+)$/);
  if (method === "GET" && examMatch) {
    const { data } = await sb.from("exam_questions")
      .select("question_id, sort_order, questions(id, type, text, options, difficulty)")
      .eq("exam_id", examMatch[1]).order("sort_order");
    const questions = (data || []).map((eq: any) => eq.questions).filter(Boolean);
    // Shuffle
    const shuffled = questions.sort(() => Math.random() - 0.5);
    return json(shuffled.map((q: any) => ({
      id: q.id, type: q.type, text: q.text,
      options: Array.isArray(q.options) ? q.options.sort(() => Math.random() - 0.5) : q.options,
      difficulty: q.difficulty,
    })));
  }

  // Question bank
  if (method === "GET" && path === "/api/questions/bank") {
    const courseId = url.searchParams.get("courseId");
    const createdBy = url.searchParams.get("createdBy");
    let q = sb.from("questions").select("id, type, text, options, correct_answer, difficulty, course_id, created_by");
    if (courseId) q = q.eq("course_id", courseId);
    if (createdBy) q = q.eq("created_by", createdBy);
    const { data } = await q.order("created_at", { ascending: false });

    const courseIds = [...new Set((data || []).map((q: any) => q.course_id))];
    let courseMap: Record<string, string> = {};
    if (courseIds.length) {
      const { data: courses } = await sb.from("courses").select("id, code").in("id", courseIds);
      (courses || []).forEach((c: any) => { courseMap[c.id] = c.code; });
    }

    return json((data || []).map((q: any) => ({
      id: q.id, type: q.type, text: q.text, options: q.options,
      correctAnswer: q.correct_answer, difficulty: q.difficulty,
      course: courseMap[q.course_id] || "", createdBy: q.created_by,
    })));
  }

  // Create question
  const idMatch = path.match(/^\/api\/questions\/([^/]+)$/);
  if (method === "POST" && path === "/api/questions") {
    const { type, text, options, correctAnswer, difficulty, courseId } = body;
    const { data, error } = await sb.from("questions").insert({
      type, text, options: options || null, correct_answer: correctAnswer || null,
      difficulty: difficulty || "medium", course_id: courseId, created_by: user.id,
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    return json({ id: data.id }, 201);
  }

  if (method === "PUT" && idMatch) {
    const { type, text, options, correctAnswer, difficulty, courseId } = body;
    await sb.from("questions").update({
      type, text, options: options || null, correct_answer: correctAnswer || null,
      difficulty, course_id: courseId,
    }).eq("id", idMatch[1]);
    return json({ success: true });
  }

  if (method === "DELETE" && idMatch) {
    await sb.from("questions").delete().eq("id", idMatch[1]);
    return json({ success: true });
  }

  return null;
}

// ───────────────────────── ANSWERS ─────────────────────────

async function handleAnswers(method: string, path: string, body: any, user: any) {
  const sb = getSupabase();

  if (method === "POST" && path === "/api/answers/save-batch") {
    const { attemptId, answers } = body;
    if (!attemptId || !answers?.length) return json({ error: "Missing data" }, 400);
    for (const { questionId, answer } of answers) {
      await sb.from("answers").upsert({
        attempt_id: attemptId, question_id: questionId, answer: answer || "",
        saved_at: new Date().toISOString(), synced: false,
      }, { onConflict: "attempt_id,question_id" });
    }
    return json({ saved: true, count: answers.length });
  }

  if (method === "POST" && path === "/api/answers/save") {
    const { attemptId, questionId, answer } = body;
    await sb.from("answers").upsert({
      attempt_id: attemptId, question_id: questionId, answer: answer || "",
      saved_at: new Date().toISOString(), synced: false,
    }, { onConflict: "attempt_id,question_id" });
    return json({ saved: true });
  }

  const attemptMatch = path.match(/^\/api\/answers\/attempt\/([^/]+)$/);
  if (method === "GET" && attemptMatch) {
    const { data } = await sb.from("answers").select("question_id, answer").eq("attempt_id", attemptMatch[1]);
    const answers: Record<string, string> = {};
    (data || []).forEach((r: any) => { answers[r.question_id] = r.answer; });
    return json(answers);
  }

  const beginMatch = path.match(/^\/api\/answers\/attempt\/([^/]+)\/begin$/);
  if (method === "POST" && beginMatch) {
    const { data } = await sb.from("exam_attempts")
      .select("started_at").eq("id", beginMatch[1]).eq("student_id", user.id).eq("status", "in_progress").single();
    if (!data) return json({ error: "Attempt not found" }, 404);
    if (!data.started_at) {
      const now = new Date().toISOString();
      await sb.from("exam_attempts").update({ started_at: now }).eq("id", beginMatch[1]);
      return json({ startedAt: now });
    }
    return json({ startedAt: data.started_at });
  }

  const stateMatch = path.match(/^\/api\/answers\/attempt\/([^/]+)\/state$/);
  if (method === "GET" && stateMatch) {
    const { data: attempt } = await sb.from("exam_attempts")
      .select("started_at, status, current_question, exams(duration)")
      .eq("id", stateMatch[1]).eq("student_id", user.id).single();
    if (!attempt) return json({ error: "Not found" }, 404);
    const { data: ans } = await sb.from("answers").select("question_id, answer").eq("attempt_id", stateMatch[1]);
    const answers: Record<string, string> = {};
    (ans || []).forEach((r: any) => { answers[r.question_id] = r.answer; });
    return json({
      startedAt: attempt.started_at, status: attempt.status,
      currentQuestion: attempt.current_question || 0,
      duration: (attempt as any).exams?.duration, answers,
    });
  }

  const cqMatch = path.match(/^\/api\/answers\/attempt\/([^/]+)\/current-question$/);
  if (method === "PATCH" && cqMatch) {
    await sb.from("exam_attempts").update({ current_question: body.currentQuestion || 0 })
      .eq("id", cqMatch[1]).eq("student_id", user.id);
    return json({ saved: true });
  }

  if (method === "POST" && path === "/api/answers/submit") {
    const { attemptId } = body;
    if (!attemptId) return json({ error: "Missing attemptId" }, 400);
    const result = await autoSubmitAttemptCloud(getSupabase(), attemptId);
    const { data: a } = await sb.from("exam_attempts").select("score, total_marks").eq("id", attemptId).single();
    return json({ score: parseFloat(a?.score || "0"), total: parseFloat(a?.total_marks || "0") });
  }

  return null;
}

// ───────────────────────── ADMIN EXTRAS ─────────────────────────

async function handleAdminExtras(method: string, path: string, body: any, user: any, url: URL) {
  const sb = getSupabase();

  if (method === "GET" && path === "/api/admin/dashboard") {
    const { count: studentCount } = await sb.from("users").select("*", { count: "exact", head: true }).eq("role", "student");
    const { data: exams } = await sb.from("exams").select("status");
    const examStats: Record<string, number> = {};
    (exams || []).forEach((e: any) => { examStats[e.status] = (examStats[e.status] || 0) + 1; });
    const { count: courseCount } = await sb.from("courses").select("*", { count: "exact", head: true });
    const { count: deptCount } = await sb.from("departments").select("*", { count: "exact", head: true });
    const { count: schoolCount } = await sb.from("schools").select("*", { count: "exact", head: true });
    const { count: questionCount } = await sb.from("questions").select("*", { count: "exact", head: true });

    const { data: attemptStats } = await sb.from("exam_attempts")
      .select("score, total_marks").in("status", ["submitted", "graded"]);
    const total = (attemptStats || []).length;
    const avgScore = total > 0 ? (attemptStats || []).reduce((s: number, a: any) => s + parseFloat(a.score || 0), 0) / total : 0;
    const passed = (attemptStats || []).filter((a: any) => parseFloat(a.score || 0) >= parseFloat(a.total_marks || 1) * 0.5).length;

    return json({
      totalStudents: studentCount || 0,
      totalExams: Object.values(examStats).reduce((a, b) => a + b, 0),
      activeExams: examStats.active || 0, completedExams: examStats.completed || 0,
      totalQuestions: questionCount || 0, totalCourses: courseCount || 0,
      totalDepartments: deptCount || 0, totalSchools: schoolCount || 0,
      averageScore: parseFloat(avgScore.toFixed(1)), passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
    });
  }

  if (method === "GET" && path === "/api/admin/results") {
    const examId = url.searchParams.get("examId");
    let q = sb.from("exam_attempts")
      .select("id, exam_id, student_id, started_at, submitted_at, score, total_marks, status, users(name, reg_number), exams(title, course_id, courses(code))")
      .in("status", ["submitted", "graded"]);
    if (examId) q = q.eq("exam_id", examId);
    const { data } = await q.order("submitted_at", { ascending: false });

    // Fetch essay scores for each attempt
    const attemptIds = (data || []).map((a: any) => a.id);
    let essayScoreMap: Record<string, number> = {};
    if (attemptIds.length) {
      const { data: essayData } = await sb.from("answers")
        .select("attempt_id, essay_score")
        .in("attempt_id", attemptIds)
        .not("essay_score", "is", null);
      (essayData || []).forEach((a: any) => {
        essayScoreMap[a.attempt_id] = (essayScoreMap[a.attempt_id] || 0) + parseFloat(a.essay_score || 0);
      });
    }

    return json((data || []).map((r: any) => ({
      id: r.id, examId: r.exam_id, studentId: r.student_id,
      studentName: r.users?.name, regNumber: r.users?.reg_number,
      examTitle: r.exams?.title, courseCode: r.exams?.courses?.code,
      startedAt: r.started_at, submittedAt: r.submitted_at,
      score: r.score ? parseFloat(r.score) : undefined,
      totalMarks: r.total_marks ? parseFloat(r.total_marks) : undefined,
      essayScore: essayScoreMap[r.id] || 0,
      status: r.status, answers: {}, flaggedQuestions: [],
    })));
  }

  if (method === "GET" && path.match(/^\/api\/admin\/essay-answers\/([^/]+)$/)) {
    const attemptId = path.match(/\/essay-answers\/([^/]+)$/)![1];
    const { data } = await sb.from("answers")
      .select("question_id, answer, essay_score, essay_feedback, questions(text, type, correct_answer)")
      .eq("attempt_id", attemptId);
    const essays = (data || []).filter((a: any) => a.questions?.type === "essay" || a.questions?.type === "short_answer");
    return json(essays.map((r: any) => ({
      questionId: r.question_id, questionText: r.questions?.text, answer: r.answer,
      type: r.questions?.type, correctAnswer: r.questions?.correct_answer,
      essayScore: r.essay_score != null ? parseFloat(r.essay_score) : undefined,
      essayFeedback: r.essay_feedback || undefined,
    })));
  }

  if (method === "POST" && path === "/api/admin/grade-essay") {
    const { attemptId, questionId, score, feedback } = body;
    await sb.from("answers").update({ essay_score: score, essay_feedback: feedback || null })
      .eq("attempt_id", attemptId).eq("question_id", questionId);
    await sb.from("exam_attempts").update({ status: "graded" }).eq("id", attemptId);
    return json({ success: true });
  }

  if (method === "GET" && path === "/api/admin/audit-log") {
    const { data } = await sb.from("audit_log").select("*").order("created_at", { ascending: false }).limit(500);
    return json((data || []).map((r: any) => ({
      id: r.id, timestamp: r.created_at, user: r.user_name, role: r.role,
      action: r.action, category: r.category, details: r.details, ip: r.ip_address,
    })));
  }

  if (method === "GET" && path === "/api/admin/search-students") {
    const q = url.searchParams.get("q");
    if (!q) return json([]);
    const { data } = await sb.from("users").select("id, name, reg_number, level, department_id")
      .eq("role", "student").or(`reg_number.ilike.%${q}%,name.ilike.%${q}%`).limit(20);

    const deptIds = [...new Set((data || []).map((u: any) => u.department_id).filter(Boolean))];
    let deptMap: Record<string, string> = {};
    if (deptIds.length) {
      const { data: depts } = await sb.from("departments").select("id, name").in("id", deptIds);
      (depts || []).forEach((d: any) => { deptMap[d.id] = d.name; });
    }

    return json((data || []).map((r: any) => ({
      id: r.id, name: r.name, regNumber: r.reg_number, level: r.level,
      department: deptMap[r.department_id] || "",
    })));
  }

  const forceMatch = path.match(/^\/api\/admin\/force-submit\/([^/]+)$/);
  if (method === "POST" && forceMatch) {
    await autoSubmitAttemptCloud(sb, forceMatch[1]);
    const { data: a } = await sb.from("exam_attempts").select("score, total_marks").eq("id", forceMatch[1]).single();
    return json({ success: true, score: parseFloat(a?.score || "0"), total: parseFloat(a?.total_marks || "0") });
  }

  if (method === "GET" && path === "/api/admin/network-clients") {
    return json({ clients: [], total: 0 });
  }

  return null;
}

// ───────────────────────── SETTINGS ─────────────────────────

async function handleSettings(method: string, path: string, body: any) {
  const sb = getSupabase();

  if (method === "GET" && path === "/api/settings") {
    const settings = await getStoredSettings(sb);
    return json(sanitizeSettings(settings));
  }

  if (method === "PUT" && path === "/api/settings") {
    const { settings } = body;
    if (!settings) return json({ error: "Invalid settings" }, 400);
    await sb.from("site_settings").upsert({ id: 1, settings, updated_at: new Date().toISOString() }, { onConflict: "id" });
    return json({ success: true });
  }

  if (method === "GET" && path === "/api/settings/system-status") {
    const { data } = await sb.from("site_settings").select("settings").eq("id", 1).single();
    const s = data?.settings || {};
    return json({ locked: (s as any).systemLocked || false, deactivated: (s as any).systemDeactivated || false });
  }

  if (method === "POST" && path === "/api/settings/system-lock") {
    const { data } = await sb.from("site_settings").select("settings").eq("id", 1).single();
    const current = (data?.settings || {}) as any;
    current.systemLocked = !!body.locked;
    await sb.from("site_settings").upsert({ id: 1, settings: current, updated_at: new Date().toISOString() }, { onConflict: "id" });
    return json({ success: true, locked: !!body.locked });
  }

  if (method === "POST" && path === "/api/settings/system-active") {
    const { data } = await sb.from("site_settings").select("settings").eq("id", 1).single();
    const current = (data?.settings || {}) as any;
    current.systemDeactivated = !body.active;
    await sb.from("site_settings").upsert({ id: 1, settings: current, updated_at: new Date().toISOString() }, { onConflict: "id" });
    return json({ success: true, deactivated: !body.active });
  }

  return null;
}

// ───────────────────────── IMPORT ─────────────────────────

async function handleImport(method: string, path: string, body: any, user: any) {
  const sb = getSupabase();

  if (method === "POST" && path === "/api/import/students") {
    const { students } = body;
    if (!students?.length) return json({ error: "No data" }, 400);
    const results = { created: 0, skipped: 0, errors: [] as string[] };
    const { data: defaultHash } = await sb.rpc("hash_password", { _password: "changeme123" });

    for (const s of students) {
      if (!s.name || !s.regNumber) { results.skipped++; continue; }
      let departmentId = null;
      if (s.department) {
        const { data: depts } = await sb.from("departments").select("id").ilike("name", s.department.trim()).limit(1);
        if (depts?.length) departmentId = depts[0].id;
      }
      const { error } = await sb.from("users").upsert({
        name: s.name.trim(), email: s.email?.trim() || null, password_hash: defaultHash,
        role: "student", reg_number: s.regNumber.trim(), department_id: departmentId, level: s.level?.trim() || null,
      }, { onConflict: "reg_number", ignoreDuplicates: true });
      if (error) { results.skipped++; results.errors.push(error.message); }
      else results.created++;
    }
    return json({ success: true, ...results });
  }

  if (method === "POST" && path === "/api/import/questions") {
    const { questions } = body;
    if (!questions?.length) return json({ error: "No data" }, 400);
    const results = { created: 0, skipped: 0, errors: [] as string[] };
    const { data: courses } = await sb.from("courses").select("id, code");
    const courseMap: Record<string, string> = {};
    (courses || []).forEach((c: any) => { courseMap[c.code.toLowerCase()] = c.id; });

    for (const q of questions) {
      if (!q.text || !q.type) { results.skipped++; continue; }
      const courseId = courseMap[(q.course || "").toLowerCase()];
      if (!courseId) { results.skipped++; results.errors.push(`Course "${q.course}" not found`); continue; }
      let options = null;
      if (q.type === "mcq") {
        options = [q.option_a, q.option_b, q.option_c, q.option_d, q.option_e].filter((o: any) => o?.trim());
      }
      const { error } = await sb.from("questions").insert({
        type: q.type, text: q.text, options, correct_answer: q.correct_answer || null,
        difficulty: q.difficulty || "medium", course_id: courseId, created_by: user.id,
      });
      if (error) { results.skipped++; results.errors.push(error.message); }
      else results.created++;
    }
    return json({ success: true, ...results });
  }

  return null;
}

// ───────────────────────── STUDENT AUTH ─────────────────────────

async function handleStudentLogin(body: any) {
  const { matricNumber, examPin } = body;
  if (!matricNumber || !examPin) return json({ error: "Reg. Number and PIN required" }, 400);
  const sb = getSupabase();

  const { data: students } = await sb.from("users")
    .select("id, name, reg_number, department_id, level")
    .eq("reg_number", matricNumber).eq("role", "student").limit(1);
  if (!students?.length) return json({ error: "Invalid Reg. Number" }, 401);
  const student = students[0];

  // Check existing in-progress attempt
  const { data: existing } = await sb.from("exam_attempts")
    .select("id, exam_id, started_at, exams(title, duration, total_questions, questions_to_answer, total_marks, instructions, status, programme, level, end_date, course_id, department_id, school_id, courses(code), departments(name), schools(name))")
    .eq("student_id", student.id).eq("status", "in_progress")
    .order("created_at", { ascending: false }).limit(1);

  if (existing?.length) {
    const a = existing[0];
    const exam = a.exams as any;
    if (a.started_at) {
      const elapsed = Date.now() - new Date(a.started_at).getTime();
      const endDate = exam.end_date ? new Date(exam.end_date).getTime() : null;
      if (elapsed >= exam.duration * 60 * 1000 || (endDate && Date.now() >= endDate)) {
        await autoSubmitAttemptCloud(sb, a.id);
        return json({ error: "Your exam time has elapsed" }, 401);
      }
    }
    const token = await signJWT({ id: student.id, role: "student", name: student.name });
    return json({
      token, user: { id: student.id, name: student.name, regNumber: student.reg_number, role: "student" },
      exam: {
        id: a.exam_id, title: exam.title, course: exam.courses?.code,
        department: exam.departments?.name, school: exam.schools?.name,
        programme: exam.programme, level: exam.level,
        duration: exam.duration, totalQuestions: exam.total_questions,
        questionsToAnswer: exam.questions_to_answer, totalMarks: parseFloat(exam.total_marks),
        startDate: null, endDate: exam.end_date, instructions: exam.instructions,
        status: exam.status, createdBy: null, enrolledStudents: 0,
      },
      attemptId: a.id, startedAt: a.started_at, resumed: true,
    });
  }

  // Check shared PIN
  const { data: sharedExams } = await sb.from("exams")
    .select("id, title, duration, total_questions, questions_to_answer, total_marks, instructions, status, programme, level, end_date, courses(code), departments(name), schools(name)")
    .eq("pin_mode", "shared").eq("shared_pin", examPin).eq("status", "active")
    .eq("department_id", student.department_id);

  let examData: any = null;
  let isShared = false;

  if (sharedExams?.length) {
    const e = sharedExams[0];
    if (!e.level || e.level === student.level) {
      // Check if already taken
      const { data: prev } = await sb.from("exam_attempts").select("id, status").eq("exam_id", e.id).eq("student_id", student.id);
      if (prev?.length && prev[0].status !== "in_progress") return json({ error: "You have already taken this exam" }, 401);
      examData = e;
      isShared = true;
    }
  }

  if (!examData) {
    // Individual PIN
    const { data: pins } = await sb.from("exam_pins")
      .select("id, exam_id, exams(title, duration, total_questions, questions_to_answer, total_marks, instructions, status, programme, level, end_date, courses(code), departments(name), schools(name))")
      .eq("student_id", student.id).eq("pin", examPin).eq("used", false);
    const validPins = (pins || []).filter((p: any) => p.exams?.status === "active");
    if (!validPins.length) return json({ error: "Invalid or used exam PIN" }, 401);
    const pin = validPins[0];
    examData = pin.exams;
    examData.id = pin.exam_id;
    // Mark used
    await sb.from("exam_pins").update({ used: true, used_at: new Date().toISOString() }).eq("id", pin.id);
  }

  await sb.from("users").update({ last_login: new Date().toISOString() }).eq("id", student.id);

  // Create attempt
  const examId = examData.id || (isShared ? sharedExams![0].id : null);
  const { data: attempt } = await sb.from("exam_attempts").upsert({
    exam_id: examId, student_id: student.id, started_at: null, status: "in_progress",
  }, { onConflict: "exam_id,student_id" }).select("id, started_at").single();

  const token = await signJWT({ id: student.id, role: "student", name: student.name });
  return json({
    token, user: { id: student.id, name: student.name, regNumber: student.reg_number, role: "student" },
    exam: {
      id: examId, title: examData.title, course: examData.courses?.code,
      department: examData.departments?.name, school: examData.schools?.name,
      programme: examData.programme, level: examData.level,
      duration: examData.duration, totalQuestions: examData.total_questions,
      questionsToAnswer: examData.questions_to_answer, totalMarks: parseFloat(examData.total_marks),
      startDate: null, endDate: examData.end_date, instructions: examData.instructions,
      status: examData.status, createdBy: null, enrolledStudents: 0,
    },
    attemptId: attempt?.id, startedAt: attempt?.started_at,
  });
}

async function handleAttemptStatus(user: any, attemptId: string) {
  const sb = getSupabase();
  const { data } = await sb.from("exam_attempts")
    .select("status, score, total_marks, submitted_at, exams(status)")
    .eq("id", attemptId).eq("student_id", user.id).single();
  if (!data) return json({ error: "Not found" }, 404);
  return json({ status: data.status, score: data.score, total_marks: data.total_marks, exam_status: (data as any).exams?.status });
}

// ───────────────────────── MAIN ROUTER ─────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api-gateway/, "");
    const method = req.method;

    let body: any = {};
    if (method !== "GET") { try { body = await req.json(); } catch {} }

    // PUBLIC routes (no auth)
    if (method === "POST" && path === "/api/auth/staff/login") return await handleStaffLogin(body);
    if (method === "POST" && path === "/api/auth/student/login") return await handleStudentLogin(body);
    if (path.startsWith("/api/license/public-")) {
      const r = await handleLicense(method, path, body);
      return r ?? json({ error: "Not found" }, 404);
    }
    if (method === "GET" && path === "/api/settings") {
      const r = await handleSettings("GET", path, body);
      return r ?? json({ error: "Not found" }, 404);
    }
    if (method === "GET" && path === "/api/settings/system-status") {
      const r = await handleSettings("GET", path, body);
      return r ?? json({ error: "Not found" }, 404);
    }

    // AUTH required
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "No token" }, 401);
    const user = await verifyJWT(auth.slice(7));
    if (!user) return json({ error: "Invalid token" }, 401);

    if (path.startsWith("/api/license/")) {
      const r = await handleLicense(method, path, body, user);
      return r ?? json({ error: "Not found" }, 404);
    }

    // Auth routes
    if (method === "GET" && path === "/api/auth/me") return await handleMe(user);
    const attemptStatusMatch = path.match(/^\/api\/auth\/attempt-status\/([^/]+)$/);
    if (method === "GET" && attemptStatusMatch) return await handleAttemptStatus(user, attemptStatusMatch[1]);

    // Admin routes
    if (path.startsWith("/api/admin/users")) { const r = await handleUsers(method, path, body, user); if (r) return r; }
    if (path.startsWith("/api/admin/schools")) { const r = await handleSchools(method, path, body); if (r) return r; }
    if (path.startsWith("/api/admin/departments")) { const r = await handleDepartments(method, path, body, url); if (r) return r; }
    if (path.startsWith("/api/admin/courses")) { const r = await handleCourses(method, path, body, url); if (r) return r; }

    // Admin extras
    const adminExtra = await handleAdminExtras(method, path, body, user, url);
    if (adminExtra) return adminExtra;

    // Exams
    if (path.startsWith("/api/exams")) { const r = await handleExams(method, path, body, user, url); if (r) return r; }

    // Questions
    if (path.startsWith("/api/questions")) { const r = await handleQuestions(method, path, body, user, url); if (r) return r; }

    // Answers
    if (path.startsWith("/api/answers")) { const r = await handleAnswers(method, path, body, user); if (r) return r; }

    // Settings (auth'd)
    if (path.startsWith("/api/settings")) { const r = await handleSettings(method, path, body); if (r) return r; }

    // Import
    if (path.startsWith("/api/import")) { const r = await handleImport(method, path, body, user); if (r) return r; }

    // Sync status (return empty for cloud mode)
    if (path === "/api/sync/status") return json({ mode: "cloud", pendingSync: 0, lastSync: null });

    return json({ error: `Route not found: ${method} ${path}` }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "Server error" }, 500);
  }
});
