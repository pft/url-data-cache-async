const crypto = require("crypto");
const osPaths = require("os-paths");
const fsp = require("fs/promises");
const path = require("path");

module.exports = function (application = "default") {
  // Helper to generate hash without external 'shasum' dependency
  function getHash(str) {
    return crypto.createHash("sha1").update(str).digest("hex");
  }

  function calculateLocations(link) {
    const paths = osPaths(application);
    const url = new URL(link);
    const cas = getHash(url.toString());

    const hostPath = url.hostname.replace(/[^a-zA-Z0-9-]/g, "_");
    const basePath = path.resolve(paths.cache, "cached", hostPath);

    return {
      basePath,
      dataPath: path.join(basePath, `${cas}${path.extname(url.pathname)}`),
      metaPath: path.join(basePath, `${cas}.json`),
    };
  }

  async function info(url) {
    const locs = calculateLocations(url);
    try {
      // Check data file and read meta in parallel
      const [metaRaw] = await Promise.all([
        fsp.readFile(locs.metaPath, "utf8"),
        fsp.access(locs.dataPath, fsp.constants.R_OK),
      ]);

      const { expiration } = JSON.parse(metaRaw);
      const expired = Date.now() > new Date(expiration).getTime();

      return { ...locs, url, expired, exists: true };
    } catch {
      return { ...locs, url, expired: "n/a", exists: false };
    }
  }

  async function put(url, data, duration = 0) {
    const { basePath, dataPath, metaPath } = calculateLocations(url);
    const expiration = new Date(Date.now() + duration * 1000).toISOString();

    await fsp.mkdir(basePath, { recursive: true });

    // Write meta and data in parallel
    await Promise.all([
      fsp.writeFile(metaPath, JSON.stringify({ expiration, url }, null, 2)),
      fsp.writeFile(dataPath, data),
    ]);
  }

  async function drop(url) {
    const { basePath, dataPath, metaPath } = calculateLocations(url);

    // 'force: true' prevents errors if files don't exist
    await Promise.all([
      fsp.rm(dataPath, { force: true }),
      fsp.rm(metaPath, { force: true }),
    ]);

    // Cleanup directory if empty
    try {
      const entries = await fsp.readdir(basePath);
      if (entries.length === 0) {
        await fsp.rm(basePath, { recursive: true, force: true });
      }
    } catch {
      // Ignore if directory was already deleted or isn't accessible
    }
  }

  return { drop, info, put };
};
