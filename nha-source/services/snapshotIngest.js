// services/snapshotIngest.js
// Ingest a JSON snapshot coming from Forge Viewer (client-side getBulkProperties)
// into the existing SQLite schema (elements table).

const { getDb, initSchema } = require('./sqlite');
const mapping = require('./dmMapping');

// ---- Helpers (mostly shared with scripts/migrate-to-sqlite.js) ----
function normalizeKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEmpty(v) {
  return (
    v === null ||
    v === undefined ||
    (typeof v === 'string' && v.trim() === '')
  );
}

function findInFlat(flat, keywords = []) {
  const entries = Object.entries(flat || {});
  if (!entries.length) return null;

  for (const kw of keywords) {
    const kwN = normalizeKey(kw);
    if (!kwN) continue;

    for (const [k, v] of entries) {
      if (isEmpty(v)) continue;
      const kN = normalizeKey(k);
      if (kN.includes(kwN)) return v;
    }
  }
  return null;
}

function inferCategory(typeName, familyName) {
  const s = `${typeName || ''} ${familyName || ''}`.toLowerCase();
  if (/(door|cửa)/i.test(s)) return 'Doors';
  if (/(window|cửa sổ)/i.test(s)) return 'Windows';
  if (/wall|tường/i.test(s)) return 'Walls';
  if (/floor|sàn/i.test(s)) return 'Floors';
  if (/room|phòng/i.test(s)) return 'Rooms';
  return null;
}

function flattenProps(properties) {
  const flat = {};
  if (!Array.isArray(properties)) return flat;

  for (const prop of properties) {
    if (!prop || !prop.displayCategory || !prop.displayName) continue;
    const key = `${prop.displayCategory}.${prop.displayName}`;
    flat[key] = prop.displayValue;
  }

  return flat;
}

function extractGroups(flat, dbId) {
  const type_name = findInFlat(flat, mapping.basic.type_name);
  const family_name = findInFlat(flat, mapping.basic.family_name);

  const omniclassTitle = findInFlat(flat, mapping.omniclass.title);
  const omniclassNumber = findInFlat(flat, mapping.omniclass.number);

  const component_type_raw =
    findInFlat(flat, mapping.basic.component_type) ||
    inferCategory(type_name, family_name) ||
    'Unknown';

  // Prefer OmniClass Title as CATEGORY when available
  const component_type = !isEmpty(omniclassTitle)
    ? String(omniclassTitle).trim()
    : String(component_type_raw).trim();

  return {
    component_id: dbId,
    component_type,
    type_name: type_name ? String(type_name) : null,
    family_name: family_name ? String(family_name) : null,
    is_asset: findInFlat(flat, mapping.basic.is_asset),

    level_number: findInFlat(flat, mapping.location.level_number),
    room_type: findInFlat(flat, mapping.location.room_type),
    room_name: findInFlat(flat, mapping.location.room_name),

    system_type: findInFlat(flat, mapping.system.system_type),
    system_name: findInFlat(flat, mapping.system.system_name),

    manufacturer: findInFlat(flat, mapping.equipment.manufacturer),
    model_name: findInFlat(flat, mapping.equipment.model_name),
    specification: findInFlat(flat, mapping.equipment.specification),

    omniclass_title: omniclassTitle ? String(omniclassTitle) : null,
    omniclass_number: omniclassNumber ? String(omniclassNumber) : null,
  };
}

function transformSnapshotElement(elem, urn, guid) {
  const dbId = Number(elem.dbId);
  const name = elem.name || null;

  const flat = flattenProps(elem.properties || []);
  const groups = extractGroups(flat, dbId);

  return {
    urn,
    guid,
    dbId,
    name,
    ...groups,
    props_flat: JSON.stringify(flat),
    embedding: null,
    embedding_model: null,
  };
}

async function initSnapshot({ urn, guid }) {
  initSchema();
  const db = getDb();
  db.prepare('DELETE FROM elements WHERE urn = ?').run(urn);
  return { ok: true, urn, guid };
}

async function ingestSnapshotChunk({ urn, guid, elements }) {
  initSchema();
  const db = getDb();

  if (!Array.isArray(elements) || elements.length === 0) {
    return { ok: true, inserted: 0 };
  }

  const insertStmt = db.prepare(`
    INSERT INTO elements (
      urn, guid, dbId, name,
      component_id, component_type, type_name, family_name, is_asset,
      level_number, room_type, room_name,
      system_type, system_name,
      manufacturer, model_name, specification,
      omniclass_title, omniclass_number,
      props_flat, embedding, embedding_model
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?
    )
  `);

  const rows = elements.map((e) => transformSnapshotElement(e, urn, guid));

  const insertMany = db.transaction((rs) => {
    for (const r of rs) {
      insertStmt.run(
        r.urn,
        r.guid,
        r.dbId,
        r.name,
        r.component_id,
        r.component_type,
        r.type_name,
        r.family_name,
        r.is_asset,
        r.level_number,
        r.room_type,
        r.room_name,
        r.system_type,
        r.system_name,
        r.manufacturer,
        r.model_name,
        r.specification,
        r.omniclass_title,
        r.omniclass_number,
        r.props_flat,
        r.embedding,
        r.embedding_model
      );
    }
  });

  insertMany(rows);

  return { ok: true, inserted: rows.length };
}

async function finishSnapshot({ urn }) {
  const db = getDb();
  const count = db
    .prepare('SELECT COUNT(*) as count FROM elements WHERE urn = ?')
    .get(urn).count;
  return { ok: true, urn, count };
}

module.exports = {
  initSnapshot,
  ingestSnapshotChunk,
  finishSnapshot,
};
