// routes/models.js
const express = require('express');
const router = express.Router();

const { getObjects, getManifest, getMetadata } = require('../services/aps');
const { initSnapshot, ingestSnapshotChunk, finishSnapshot } = require('../services/snapshotIngest');
const { extractModelToSqlite } = require('../services/extract');

/**
 * GET /api/models
 * List objects in APS bucket (and their base64 URNs).
 */
router.get('/', async (req, res, next) => {
  try {
    const objs = await getObjects();
    // Expect shape: [{ name, urn }]
    res.json(objs);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/models/:urn/status
 * Check Model Derivative manifest status.
 *
 * NOTE: the frontend expects a flat {status, progress, messages} payload.
 */
router.get('/:urn/status', async (req, res, next) => {
  try {
    const urn = req.params.urn;
    const manifest = await getManifest(urn);

    // Model Derivative typically returns status: success | inprogress | failed
    const status = (manifest && manifest.status) ? String(manifest.status).toLowerCase() : 'unknown';
    const progress = manifest && manifest.progress ? manifest.progress : null;

    const messages = [];
    const derivatives = (manifest && manifest.derivatives) ? manifest.derivatives : [];
    for (const d of derivatives) {
      const msgs = d && d.messages ? d.messages : [];
      for (const m of msgs) messages.push(m);
    }

    res.json({ urn, status, progress, messages, manifest });
  } catch (err) {
    // If manifest doesn't exist yet -> treat as not translated
    const httpStatus = err?.response?.status;
    if (httpStatus == 404) {
      return res.json({ urn: req.params.urn, status: 'n/a', progress: null, messages: [], manifest: null });
    }
    next(err);
  }
});


/**
 * GET /api/models/:urn/metadata
 * Get metadata and guid(s).
 */
router.get('/:urn/metadata', async (req, res, next) => {
  try {
    const urn = req.params.urn;
    const metadata = await getMetadata(urn);
    res.json({ urn, metadata });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/models/:urn/extract
 * Phase 1 (APS -> MongoDB): extract properties and store into Mongo.
 */
router.post('/:urn/extract', async (req, res, next) => {
  try {
    const urn = req.params.urn;
    const out = await extractModelToSqlite(urn);
    res.json(out);
  } catch (err) {
    next(err);
  }
});



/**
 * POST /api/models/:urn/snapshot/init
 * Clear existing SQLite data for this URN (replace strategy).
 */
router.post('/:urn/snapshot/init', async (req, res, next) => {
  try {
    const urn = req.params.urn;
    const guid = (req.body && req.body.guid) || 'viewer-snapshot';
    const out = await initSnapshot({ urn, guid });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/models/:urn/snapshot/chunk
 * Body: { guid, elements: [{dbId,name,properties:[{displayCategory,displayName,displayValue,type,units}]}] }
 */
router.post('/:urn/snapshot/chunk', async (req, res, next) => {
  try {
    const urn = req.params.urn;
    const guid = (req.body && req.body.guid) || 'viewer-snapshot';
    const elements = (req.body && req.body.elements) || [];
    const out = await ingestSnapshotChunk({ urn, guid, elements });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/models/:urn/snapshot/finish
 * Finalize and return count.
 */
router.post('/:urn/snapshot/finish', async (req, res, next) => {
  try {
    const urn = req.params.urn;
    const out = await finishSnapshot({ urn });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
