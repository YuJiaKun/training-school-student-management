const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createDatabase } = require('./db');
const { createApp, DEFAULT_AUTH_ACCOUNTS, DEFAULT_SESSION_MAX_AGE_SECONDS } = require('./app');

const DEFAULT_CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function createServerApp({
  app,
  clientDistPath = DEFAULT_CLIENT_DIST,
  cookieSecure = false,
  sessionMaxAgeSeconds = DEFAULT_SESSION_MAX_AGE_SECONDS,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES
}) {
  const cookieOptions = { secure: cookieSecure, maxAgeSeconds: sessionMaxAgeSeconds };
  const bodyOptions = { maxBytes: maxBodyBytes };
  const uploadBodyOptions = { maxBytes: maxUploadBytes };

  return {
    renderClientShell() {
      return readClientIndex(clientDistPath) || renderFallbackShell();
    },

    listen(port = 0) {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const sessionToken = getSessionTokenFromRequest(req);
        const session = getSessionFromRequest(req, app);

        try {
          if (req.method === 'GET' && url.pathname === '/health') {
            sendJson(res, 200, { status: 'ok' });
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/login') {
            await handleApiLogin(req, res, app, cookieOptions, bodyOptions);
            return;
          }

          if (req.method === 'POST' && url.pathname === '/login') {
            await handleLegacyLogin(req, res, app, cookieOptions, bodyOptions);
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/logout') {
            app.logout(sessionToken);
            res.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'set-cookie': clearSessionCookie(cookieOptions)
            });
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/logout') {
            app.logout(sessionToken);
            res.writeHead(302, {
              location: '/',
              'set-cookie': clearSessionCookie(cookieOptions)
            });
            res.end();
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/me') {
            if (!session) {
              sendJson(res, 401, { error: 'unauthorized' });
              return;
            }
            sendJson(res, 200, { user: sessionToUser(session) });
            return;
          }

          if (url.pathname.startsWith('/api/') && !session) {
            sendJson(res, 401, { error: 'unauthorized' });
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/teachers') {
            sendJson(res, 200, app.listTeachers());
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/classes') {
            if (!authorize(res, session, ['admin', 'teacher'])) return;
            sendJson(res, 200, app.listClasses());
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/student-workspace') {
            if (!authorize(res, session, ['student'])) return;
            try {
              sendJson(res, 200, app.getStudentWorkspace(session));
            } catch (error) {
              sendJson(res, error.message === 'student account not bound' ? 403 : 404, { error: error.message });
            }
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/dashboard/stats') {
            if (!authorize(res, session, ['admin'])) return;
            sendJson(res, 200, app.getDashboardStats());
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/homework-analytics') {
            if (!authorize(res, session, ['admin', 'teacher'])) return;
            sendJson(res, 200, app.getHomeworkAnalytics(readHomeworkAssignmentFilters(url)));
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/students/import/template.csv') {
            if (!authorize(res, session, ['admin'])) return;
            sendDownload(res, 200, Buffer.from(app.exportStudentImportTemplate(), 'utf8'), 'text/csv; charset=utf-8', '学生导入模板.csv');
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/students') {
            if (!authorize(res, session, ['admin'])) return;
            sendJson(res, 200, app.listStudents(readStudentFilters(url)));
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/students/import/preview') {
            if (!authorize(res, session, ['admin'])) return;
            await handleJson(req, res, 200, (body) => app.previewStudentImport(body), bodyOptions);
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/students/import/commit') {
            if (!authorize(res, session, ['admin'])) return;
            await mutateJson(req, res, 201, (body) => app.importStudents(body), app, bodyOptions);
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/students/accounts/generate') {
            if (!authorize(res, session, ['admin'])) return;
            await mutateJson(req, res, 201, (body) => app.generateStudentAccounts(body), app, bodyOptions);
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/students/accounts/reset') {
            if (!authorize(res, session, ['admin'])) return;
            await mutateJson(req, res, 200, (body) => app.resetStudentAccountPasswords(body), app, bodyOptions);
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/students') {
            if (!authorize(res, session, ['admin'])) return;
            await mutateJson(req, res, 201, (body) => ({ student: app.createStudent(body) }), app, bodyOptions);
            return;
          }

          const studentMatch = url.pathname.match(/^\/api\/students\/(\d+)$/);
          if (studentMatch && req.method === 'PATCH') {
            if (!authorize(res, session, ['admin'])) return;
            await mutateJson(req, res, 200, (body) => ({ student: app.updateStudent(Number(studentMatch[1]), body) }), app, bodyOptions);
            return;
          }

          const archiveMatch = url.pathname.match(/^\/api\/students\/(\d+)\/archive$/);
          if (archiveMatch && req.method === 'POST') {
            if (!authorize(res, session, ['admin'])) return;
            mutate(res, 200, () => ({ student: app.archiveStudent(Number(archiveMatch[1])) }), app);
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/homework-assignments') {
            if (!authorize(res, session, ['admin', 'teacher'])) return;
            sendJson(res, 200, app.listHomeworkAssignments(readHomeworkAssignmentFilters(url)));
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/homework-assignments') {
            if (!authorize(res, session, ['admin', 'teacher'])) return;
            await mutateJson(req, res, 201, (body) => app.createHomeworkAssignment(body, session), app, bodyOptions);
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/homework') {
            if (!authorize(res, session, ['admin', 'teacher'])) return;
            sendJson(res, 200, app.listHomeworkRecords(readHomeworkFilters(url)));
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/homework') {
            if (!authorize(res, session, ['admin'])) return;
            await mutateJson(req, res, 201, (body) => ({ record: app.addHomeworkRecord(body) }), app, bodyOptions);
            return;
          }

          const homeworkSubmissionMatch = url.pathname.match(/^\/api\/homework\/(\d+)\/submission$/);
          if (homeworkSubmissionMatch && req.method === 'POST') {
            if (!authorize(res, session, ['student'])) return;
            await handleHomeworkSubmission(req, res, app, Number(homeworkSubmissionMatch[1]), session, uploadBodyOptions);
            return;
          }

          const homeworkFileMatch = url.pathname.match(/^\/api\/homework\/(\d+)\/file$/);
          if (homeworkFileMatch && req.method === 'GET') {
            if (!authorize(res, session, ['admin', 'teacher', 'student'])) return;
            try {
              const file = app.getHomeworkFile(Number(homeworkFileMatch[1]), session);
              sendDownload(res, 200, file.body, file.contentType, file.fileName);
            } catch (error) {
              sendJson(res, error.statusCode || 400, { error: error.message });
            }
            return;
          }

          const homeworkMatch = url.pathname.match(/^\/api\/homework\/(\d+)$/);
          if (homeworkMatch && req.method === 'PATCH') {
            if (!authorize(res, session, ['admin'])) return;
            await mutateJson(req, res, 200, (body) => ({ record: app.updateHomeworkRecord(Number(homeworkMatch[1]), body) }), app, bodyOptions);
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/interviews') {
            if (!authorize(res, session, ['admin'])) return;
            sendJson(res, 200, app.listInterviewRecords(readInterviewFilters(url)));
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/interviews') {
            if (!authorize(res, session, ['admin'])) return;
            await mutateJson(req, res, 201, (body) => ({ record: app.addInterviewRecord(body) }), app, bodyOptions);
            return;
          }

          const interviewMatch = url.pathname.match(/^\/api\/interviews\/(\d+)$/);
          if (interviewMatch && req.method === 'PATCH') {
            if (!authorize(res, session, ['admin'])) return;
            await mutateJson(req, res, 200, (body) => ({ record: app.updateInterviewRecord(Number(interviewMatch[1]), body) }), app, bodyOptions);
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/schedules/timeline') {
            if (!authorize(res, session, ['admin', 'teacher'])) return;
            const filters = { weekStart: url.searchParams.get('weekStart') || currentWeekStart() };
            if (session.role === 'teacher') filters.teacherId = session.teacherId;
            sendJson(res, 200, app.listInterviewScheduleTimeline(filters));
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/schedules') {
            const filters = readScheduleFilters(url);
            if (!authorizeScheduleList(res, session, filters)) return;
            sendJson(res, 200, app.listInterviewSchedules(filters));
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/schedules') {
            const body = await readBody(req, bodyOptions);
            if (!authorizeScheduleCreate(res, session, body)) return;
            mutate(res, 201, () => ({
              schedule: session.role === 'admin'
                ? app.createAdminInterviewSchedule(body, { username: session.username })
                : app.requestInterviewSchedule(body)
            }), app);
            return;
          }

          const scheduleApproveMatch = url.pathname.match(/^\/api\/schedules\/(\d+)\/approve$/);
          if (scheduleApproveMatch && req.method === 'POST') {
            if (!authorize(res, session, ['admin'])) return;
            await mutateJson(req, res, 200, (body) => ({ schedule: app.approveInterviewSchedule(Number(scheduleApproveMatch[1]), body) }), app, bodyOptions);
            return;
          }

          const scheduleAcceptMatch = url.pathname.match(/^\/api\/schedules\/(\d+)\/accept$/);
          if (scheduleAcceptMatch && req.method === 'POST') {
            if (!authorizeScheduleAction(res, session, app, Number(scheduleAcceptMatch[1]), ['admin', 'teacher'])) return;
            await mutateJson(req, res, 200, (body) => ({ schedule: app.acceptInterviewSchedule(Number(scheduleAcceptMatch[1]), body) }), app, bodyOptions);
            return;
          }

          const scheduleRejectMatch = url.pathname.match(/^\/api\/schedules\/(\d+)\/reject$/);
          if (scheduleRejectMatch && req.method === 'POST') {
            if (!authorizeScheduleAction(res, session, app, Number(scheduleRejectMatch[1]), ['admin', 'teacher'])) return;
            mutate(res, 200, () => ({ schedule: app.rejectInterviewSchedule(Number(scheduleRejectMatch[1])) }), app);
            return;
          }

          const scheduleCancelMatch = url.pathname.match(/^\/api\/schedules\/(\d+)\/cancel$/);
          if (scheduleCancelMatch && req.method === 'POST') {
            if (!authorizeScheduleAction(res, session, app, Number(scheduleCancelMatch[1]), ['admin', 'teacher'])) return;
            mutate(res, 200, () => ({ schedule: app.cancelInterviewSchedule(Number(scheduleCancelMatch[1])) }), app);
            return;
          }

          const scheduleCompleteMatch = url.pathname.match(/^\/api\/schedules\/(\d+)\/complete$/);
          if (scheduleCompleteMatch && req.method === 'POST') {
            if (!authorizeScheduleAction(res, session, app, Number(scheduleCompleteMatch[1]), ['admin', 'teacher'])) return;
            mutate(res, 200, () => ({ schedule: app.completeInterviewSchedule(Number(scheduleCompleteMatch[1])) }), app);
            return;
          }

          const scheduleMatch = url.pathname.match(/^\/api\/schedules\/(\d+)$/);
          if (scheduleMatch && req.method === 'PATCH') {
            if (!authorize(res, session, ['admin'])) return;
            await mutateJson(req, res, 200, (body) => ({ schedule: app.updateInterviewSchedule(Number(scheduleMatch[1]), body) }), app, bodyOptions);
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/export/students') {
            if (!authorize(res, session, ['admin'])) return;
            sendText(res, 200, app.exportStudents(readStudentFilters(url)), 'text/csv; charset=utf-8');
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/export/student-accounts') {
            if (!authorize(res, session, ['admin'])) return;
            sendText(res, 200, app.exportStudentAccounts(readStudentFilters(url)), 'text/csv; charset=utf-8');
            return;
          }

          const homeworkStudentZipMatch = url.pathname.match(/^\/api\/export\/homework\/student\/(\d+)\.zip$/);
          if (homeworkStudentZipMatch && req.method === 'GET') {
            if (!authorize(res, session, ['admin', 'teacher'])) return;
            try {
              const zip = app.exportHomeworkStudentZip(Number(homeworkStudentZipMatch[1]), readHomeworkFilters(url));
              sendDownload(res, 200, zip.body, zip.contentType, zip.fileName);
            } catch (error) {
              sendJson(res, error.statusCode || 400, { error: error.message });
            }
            return;
          }

          const homeworkZipMatch = url.pathname.match(/^\/api\/export\/homework\/(\d+)\.zip$/);
          if (homeworkZipMatch && req.method === 'GET') {
            if (!authorize(res, session, ['admin', 'teacher'])) return;
            try {
              const zip = app.exportHomeworkAssignmentZip(Number(homeworkZipMatch[1]));
              sendDownload(res, 200, zip.body, zip.contentType, zip.fileName);
            } catch (error) {
              sendJson(res, error.statusCode || 400, { error: error.message });
            }
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/export/homework') {
            if (!authorize(res, session, ['admin', 'teacher'])) return;
            sendText(res, 200, app.exportHomeworkRecords(readHomeworkFilters(url)), 'text/csv; charset=utf-8');
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/export/interviews') {
            if (!authorize(res, session, ['admin'])) return;
            sendText(res, 200, app.exportInterviewRecords(readInterviewFilters(url)), 'text/csv; charset=utf-8');
            return;
          }

          if (url.pathname.startsWith('/api/')) {
            sendJson(res, 404, { error: 'not found' });
            return;
          }

          if (req.method === 'GET') {
            serveClientAssetOrShell(res, clientDistPath, url.pathname);
            return;
          }

          sendJson(res, 404, { error: 'not found' });
        } catch (error) {
          sendJson(res, error.statusCode || 500, { error: error.message });
        }
      });

      return server.listen(port);
    }
  };
}

async function handleApiLogin(req, res, app, cookieOptions, bodyOptions) {
  try {
    const body = await readBody(req, bodyOptions);
    const login = app.login({ username: body.username, password: body.password });
    const session = app.getSession(login.token);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': sessionCookie(login.token, cookieOptions)
    });
    res.end(JSON.stringify({ user: sessionToUser(session) }));
  } catch (error) {
    sendJson(res, loginErrorStatus(error), { error: error.message });
  }
}

async function handleLegacyLogin(req, res, app, cookieOptions, bodyOptions) {
  try {
    const body = await readBody(req, bodyOptions);
    const login = app.login({ username: body.username, password: body.password });
    res.writeHead(302, {
      location: '/dashboard',
      'set-cookie': sessionCookie(login.token, cookieOptions)
    });
    res.end();
  } catch (error) {
    sendJson(res, loginErrorStatus(error), { error: error.message });
  }
}

async function mutateJson(req, res, statusCode, handler, app, bodyOptions) {
  try {
    const body = await readBody(req, bodyOptions);
    const payload = handler(body);
    persist(app);
    sendJson(res, statusCode, payload);
  } catch (error) {
    sendJson(res, error.statusCode || 400, errorPayload(error));
  }
}

async function handleJson(req, res, statusCode, handler, bodyOptions) {
  try {
    const body = await readBody(req, bodyOptions);
    sendJson(res, statusCode, handler(body));
  } catch (error) {
    sendJson(res, error.statusCode || 400, errorPayload(error));
  }
}

async function handleHomeworkSubmission(req, res, app, recordId, session, bodyOptions) {
  try {
    const form = await readMultipartForm(req, bodyOptions);
    if (!form.file) throw new Error('homework file is required');
    const record = app.submitHomeworkFile(recordId, {
      studentId: session.studentId,
      fileName: form.file.fileName,
      contentType: form.file.contentType,
      content: form.file.content,
      remark: form.fields.remark || ''
    });
    persist(app);
    sendJson(res, 200, { record });
  } catch (error) {
    sendJson(res, error.statusCode || 400, { error: error.message });
  }
}

function mutate(res, statusCode, handler, app) {
  try {
    const payload = handler();
    persist(app);
    sendJson(res, statusCode, payload);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function authorize(res, session, roles) {
  if (roles.includes(session.role)) return true;
  sendJson(res, 403, { error: 'forbidden' });
  return false;
}

function authorizeScheduleList(res, session, filters) {
  if (session.role === 'admin') return true;

  if (session.role === 'teacher') {
    if (!session.teacherId) {
      sendJson(res, 403, { error: 'forbidden' });
      return false;
    }
    if (filters.teacherId && Number(filters.teacherId) !== Number(session.teacherId)) {
      sendJson(res, 403, { error: 'forbidden' });
      return false;
    }
    filters.teacherId = String(session.teacherId);
    return true;
  }

  if (session.role === 'student') {
    if (!session.studentId) {
      sendJson(res, 403, { error: 'student account not bound' });
      return false;
    }
    if (filters.studentId && Number(filters.studentId) !== Number(session.studentId)) {
      sendJson(res, 403, { error: 'forbidden' });
      return false;
    }
    filters.studentId = String(session.studentId);
    return true;
  }

  sendJson(res, 403, { error: 'forbidden' });
  return false;
}

function authorizeScheduleCreate(res, session, body) {
  if (session.role === 'admin') return true;
  if (session.role !== 'student') {
    sendJson(res, 403, { error: 'forbidden' });
    return false;
  }
  if (!session.studentId) {
    sendJson(res, 403, { error: 'student account not bound' });
    return false;
  }
  if (Number(body.studentId) !== Number(session.studentId)) {
    sendJson(res, 403, { error: 'forbidden' });
    return false;
  }
  return true;
}

function authorizeScheduleAction(res, session, app, scheduleId, roles) {
  if (!authorize(res, session, roles)) return false;
  if (session.role !== 'teacher') return true;

  const schedule = app.listInterviewSchedules().items.find((item) => item.id === scheduleId);
  if (!schedule || Number(schedule.teacherId) !== Number(session.teacherId)) {
    sendJson(res, 403, { error: 'forbidden' });
    return false;
  }

  return true;
}

function persist(app) {
  if (typeof app.saveDatabase === 'function') app.saveDatabase();
}

function loginErrorStatus(error) {
  if (error.statusCode) return error.statusCode;
  if (error.code === 'LOGIN_RATE_LIMITED') return 429;
  return 401;
}

function errorPayload(error) {
  const payload = { error: error.message };
  if (error.preview) payload.preview = error.preview;
  return payload;
}

function readStudentFilters(url) {
  return {
    status: url.searchParams.get('status') || undefined,
    accountStatus: url.searchParams.get('accountStatus') || undefined,
    keyword: url.searchParams.get('keyword') || undefined,
    className: url.searchParams.get('className') || undefined,
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined
  };
}

function readHomeworkAssignmentFilters(url) {
  return {
    className: url.searchParams.get('className') || undefined,
    keyword: url.searchParams.get('keyword') || undefined
  };
}

function readHomeworkFilters(url) {
  return {
    studentId: url.searchParams.get('studentId') || undefined,
    assignmentId: url.searchParams.get('assignmentId') || undefined,
    className: url.searchParams.get('className') || undefined,
    submitStatus: url.searchParams.get('submitStatus') || undefined,
    keyword: url.searchParams.get('keyword') || undefined
  };
}

function readInterviewFilters(url) {
  return {
    studentId: url.searchParams.get('studentId') || undefined,
    companyName: url.searchParams.get('companyName') || undefined,
    result: url.searchParams.get('result') || undefined
  };
}

function readScheduleFilters(url) {
  return {
    teacherId: url.searchParams.get('teacherId') || undefined,
    studentId: url.searchParams.get('studentId') || undefined,
    status: url.searchParams.get('status') || undefined,
    from: url.searchParams.get('from') || undefined,
    to: url.searchParams.get('to') || undefined
  };
}

function serveClientAssetOrShell(res, clientDistPath, requestPath) {
  const index = readClientIndex(clientDistPath);
  if (!index) {
    sendText(res, 200, renderFallbackShell(), 'text/html; charset=utf-8');
    return;
  }

  const filePath = resolveClientPath(clientDistPath, requestPath);
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }

  sendText(res, 200, index, 'text/html; charset=utf-8');
}

function readClientIndex(clientDistPath) {
  const indexPath = path.join(clientDistPath, 'index.html');
  if (!fs.existsSync(indexPath)) return null;
  return fs.readFileSync(indexPath, 'utf8');
}

function resolveClientPath(clientDistPath, requestPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const relativePath = decodedPath.replace(/^\/+/, '') || 'index.html';
  const resolved = path.resolve(clientDistPath, relativePath);
  const root = path.resolve(clientDistPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

function sendFile(res, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';
  sendText(res, 200, fs.readFileSync(filePath), contentType);
}

function renderFallbackShell() {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>培训机构学生管理系统</title></head><body><div id="root">前端资源尚未构建，请先运行 npm run build。</div></body></html>';
}

function getSessionFromRequest(req, app) {
  const token = getSessionTokenFromRequest(req);
  if (!token) return null;
  return app.getSession(token);
}

function getSessionTokenFromRequest(req) {
  const cookie = parseCookies(req.headers.cookie || '');
  return cookie.session || null;
}

function parseCookies(header) {
  const result = {};
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) continue;
    result[rawKey] = decodeURIComponent(rawValue.join('='));
  }
  return result;
}

function sessionToUser(session) {
  return {
    username: session.username,
    role: session.role,
    teacherId: session.teacherId || null,
    studentId: session.studentId || null
  };
}

function sessionCookie(token, options = {}) {
  const parts = [
    `session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Number(options.maxAgeSeconds || DEFAULT_SESSION_MAX_AGE_SECONDS)}`
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie(options = {}) {
  const parts = ['session=', 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function readBody(req, options = {}) {
  return readRawBody(req, options).then((raw) => {
    const contentType = (req.headers['content-type'] || '').split(';')[0].trim();
    if (!raw.length) return {};
    if (contentType === 'application/x-www-form-urlencoded') {
      return Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
    }
    if (contentType && contentType !== 'application/json') {
      const error = new Error('unsupported content type');
      error.statusCode = 415;
      throw error;
    }
    return JSON.parse(raw.toString('utf8'));
  });
}

function readRawBody(req, options = {}) {
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BODY_BYTES);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('request body too large');
        error.statusCode = 413;
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

async function readMultipartForm(req, options = {}) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    const error = new Error('unsupported content type');
    error.statusCode = 415;
    throw error;
  }

  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const raw = await readRawBody(req, options);
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  let file = null;
  let position = raw.indexOf(delimiter);

  while (position !== -1) {
    const nextPosition = raw.indexOf(delimiter, position + delimiter.length);
    if (nextPosition === -1) break;
    let part = raw.slice(position + delimiter.length, nextPosition);
    position = nextPosition;

    if (part.subarray(0, 2).toString() === '--') continue;
    if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
    if (part.subarray(part.length - 2).toString() === '\r\n') part = part.subarray(0, part.length - 2);

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;
    const headerText = part.subarray(0, headerEnd).toString('utf8');
    const content = part.subarray(headerEnd + 4);
    const headers = parsePartHeaders(headerText);
    const disposition = headers['content-disposition'] || '';
    const name = readHeaderParameter(disposition, 'name');
    const fileName = readHeaderParameter(disposition, 'filename');
    if (!name) continue;

    if (fileName) {
      file = {
        name,
        fileName,
        contentType: headers['content-type'] || 'application/octet-stream',
        content
      };
    } else {
      fields[name] = content.toString('utf8');
    }
  }

  return { fields, file };
}

function parsePartHeaders(text) {
  const headers = {};
  for (const line of text.split('\r\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function readHeaderParameter(headerValue, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = headerValue.match(new RegExp(`${escaped}="([^"]*)"`, 'i'));
  return match ? match[1] : '';
}

function sendJson(res, statusCode, payload) {
  sendText(res, statusCode, JSON.stringify(payload), 'application/json; charset=utf-8');
}

function sendDownload(res, statusCode, payload, contentType, fileName) {
  res.writeHead(statusCode, {
    'content-type': contentType,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
  });
  res.end(payload);
}

function sendText(res, statusCode, payload, contentType) {
  res.writeHead(statusCode, { 'content-type': contentType });
  res.end(payload);
}

function currentWeekStart() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  return monday.toISOString().slice(0, 10);
}

if (require.main === module) {
  let server;
  try {
    const port = Number(process.env.PORT || 4000);
    const filePath = process.env.DATA_FILE || './data/data.json';
    const sessionMaxAgeSeconds = Number(process.env.SESSION_MAX_AGE_SECONDS || DEFAULT_SESSION_MAX_AGE_SECONDS);
    const db = createDatabase({ filePath });
    const app = createApp({
      db,
      authAccounts: readAuthAccountsFromEnv(process.env),
      sessionMaxAgeSeconds
    });
    server = createServerApp({
      app,
      cookieSecure: process.env.COOKIE_SECURE === undefined
        ? process.env.NODE_ENV === 'production'
        : readBoolean(process.env.COOKIE_SECURE),
      sessionMaxAgeSeconds
    }).listen(port);

    server.on('listening', () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      console.log(`学生管理系统已启动：http://127.0.0.1:${actualPort}`);
      console.log(`数据文件：${filePath}`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`端口 ${port} 已被占用。学生管理系统建议使用 PORT=4000；不要使用 3000（老网站）或 3001（Gitea）。`);
      } else {
        console.error(`启动失败：${error.message}`);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error(`启动失败：${error.message}`);
    process.exit(1);
  }
}

function readAuthAccountsFromEnv(env) {
  if (!env.AUTH_ACCOUNTS) {
    if (env.NODE_ENV === 'production') {
      throw new Error('生产环境必须配置 AUTH_ACCOUNTS');
    }
    return DEFAULT_AUTH_ACCOUNTS;
  }

  const parsed = JSON.parse(env.AUTH_ACCOUNTS);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('AUTH_ACCOUNTS 必须是非空 JSON 数组');
  }
  return parsed;
}

function readBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

module.exports = { createServerApp, readAuthAccountsFromEnv };
