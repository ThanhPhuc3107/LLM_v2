// public/snapshot.js
// Client-side snapshot: pull properties from the *currently opened model in Viewer*
// and ingest them into SQLite via /api/models/:urn/snapshot/* endpoints.

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getAllDbIds(viewer) {
  return new Promise((resolve, reject) => {
    viewer.getObjectTree((tree) => {
      try {
        const rootId = tree.getRootId();
        const ids = [];
        tree.enumNodeChildren(
          rootId,
          (dbId) => {
            // Skip root
            if (dbId !== rootId) ids.push(dbId);
          },
          true
        );
        resolve(ids);
      } catch (e) {
        reject(e);
      }
    });
  });
}

function bulkProps(viewer, dbIds) {
  return new Promise((resolve, reject) => {
    viewer.model.getBulkProperties(
      dbIds,
      { ignoreHidden: true },
      (result) => resolve(result || []),
      (err) => reject(err)
    );
  });
}

export async function snapshotToServer(viewer, urn, {
  guid = 'viewer-snapshot',
  batchSize = 200,
  throttleMs = 0,
  onProgress = null,
} = {}) {
  if (!viewer || !viewer.model) {
    throw new Error('Viewer/model not ready');
  }
  if (!urn) {
    throw new Error('Missing URN');
  }

  const dbIds = await getAllDbIds(viewer);
  const total = dbIds.length;

  // Init (clear old data for this URN)
  const initResp = await fetch(`/api/models/${urn}/snapshot/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guid }),
  });
  if (!initResp.ok) throw new Error(await initResp.text());

  let done = 0;

  for (let i = 0; i < dbIds.length; i += batchSize) {
    const chunkIds = dbIds.slice(i, i + batchSize);
    const res = await bulkProps(viewer, chunkIds);

    const elements = res.map((r) => ({
      dbId: r.dbId,
      name: r.name || null,
      properties: Array.isArray(r.properties)
        ? r.properties.map((p) => ({
            displayCategory: p.displayCategory || null,
            displayName: p.displayName || null,
            displayValue: p.displayValue,
            type: p.type,
            units: p.units || null,
          }))
        : [],
    }));

    const chunkResp = await fetch(`/api/models/${urn}/snapshot/chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guid, elements }),
    });
    if (!chunkResp.ok) throw new Error(await chunkResp.text());

    done += chunkIds.length;
    if (onProgress) onProgress({ done, total });
    if (throttleMs) await sleep(throttleMs);
  }

  const finResp = await fetch(`/api/models/${urn}/snapshot/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guid }),
  });
  if (!finResp.ok) throw new Error(await finResp.text());
  return await finResp.json();
}
