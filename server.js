const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const DEFAULT_STORE = { tournaments: [], likes: {} };

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_STORE, null, 2));
  }
}

function readStore() {
  try {
    ensureDataFile();
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      tournaments: Array.isArray(parsed.tournaments) ? parsed.tournaments : [],
      likes: parsed.likes && typeof parsed.likes === 'object' ? parsed.likes : {},
    };
  } catch (error) {
    console.error('Failed to read data store:', error);
    return { ...DEFAULT_STORE };
  }
}

function writeStore(data) {
  ensureDataFile();
  const sanitized = {
    tournaments: Array.isArray(data.tournaments) ? data.tournaments : [],
    likes: data.likes && typeof data.likes === 'object' ? data.likes : {},
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(sanitized, null, 2));
  return sanitized;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(payload));
}

function serveStatic(res, pathname) {
  const safePath = path.normalize(path.join(ROOT_DIR, pathname.replace(/^\//, '')));
  if (!safePath.startsWith(ROOT_DIR)) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }
  const target = fs.existsSync(safePath) && fs.statSync(safePath).isFile() ? safePath : path.join(ROOT_DIR, 'index.html');
  const ext = path.extname(target).toLowerCase();
  const contentType = ext === '.html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
  const stream = fs.createReadStream(target);
  res.writeHead(200, { 'Content-Type': contentType });
  stream.pipe(res);
}

function handleBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve(null);
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  const parsed = new URL(url, `http://${req.headers.host}`);
  const pathname = parsed.pathname;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (pathname === '/api/tournaments') {
    if (method === 'GET') {
      const store = readStore();
      return sendJson(res, 200, store.tournaments);
    }
    if (method === 'POST') {
      try {
        const payload = await handleBody(req);
        if (!Array.isArray(payload)) {
          return sendJson(res, 400, { error: 'Body must be an array of tournaments' });
        }
        const store = readStore();
        const updated = writeStore({ ...store, tournaments: payload });
        return sendJson(res, 200, { tournaments: updated.tournaments });
      } catch (error) {
        console.error('Failed to save tournaments', error);
        return sendJson(res, 500, { error: 'Failed to save tournaments' });
      }
    }
  }

  if (pathname === '/api/likes') {
    if (method === 'GET') {
      const userId = parsed.searchParams.get('userId');
      const store = readStore();
      const likes = userId && Array.isArray(store.likes?.[userId]) ? store.likes[userId] : [];
      return sendJson(res, 200, likes);
    }
    if (method === 'POST') {
      try {
        const payload = await handleBody(req);
        const { userId, tournamentId, liked } = payload || {};
        if (!userId || !tournamentId || typeof liked !== 'boolean') {
          return sendJson(res, 400, { error: 'userId, tournamentId, and liked are required' });
        }
        const store = readStore();
        const userLikes = new Set(Array.isArray(store.likes?.[userId]) ? store.likes[userId] : []);
        if (liked) {
          userLikes.add(tournamentId);
        } else {
          userLikes.delete(tournamentId);
        }
        const updatedLikes = { ...store.likes, [userId]: Array.from(userLikes) };
        const updated = writeStore({ ...store, likes: updatedLikes });
        return sendJson(res, 200, { likes: updated.likes[userId] });
      } catch (error) {
        console.error('Failed to update likes', error);
        return sendJson(res, 500, { error: 'Failed to update likes' });
      }
    }
  }

  serveStatic(res, pathname === '/' ? '/index.html' : pathname);
});

server.listen(PORT, () => {
  console.log(`Rematch server running on http://localhost:${PORT}`);
});
