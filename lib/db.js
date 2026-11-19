'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
  users: [],
  subjects: [
    { id: 'anatomie', name: 'Anatomie', color: '#e74c3c' },
    { id: 'fysiologie', name: 'Fysiologie', color: '#e67e22' },
    { id: 'linguistiek', name: 'Linguïstiek', color: '#9b59b6' },
    { id: 'audiologie', name: 'Audiologie', color: '#3498db' },
    { id: 'logopedie', name: 'Logopedie', color: '#16a085' },
    { id: 'pathologie', name: 'Pathologie', color: '#d63384' }
  ],
  documents: [],
  tests: [],
  results: []
};

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf8');
  }
}

function read() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    // merge to ensure new keys exist
    return Object.assign({}, DEFAULT_DB, parsed);
  } catch (err) {
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

function write(db) {
  ensureStore();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// convenience mutator: runs fn(db), then persists
function mutate(fn) {
  const db = read();
  const result = fn(db);
  write(db);
  return result;
}

module.exports = { read, write, mutate, DB_FILE };