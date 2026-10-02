// Per-user storage. Each account has its own folder, users/<userId>/, holding kits.json and an images/ folder,
// so one account can never read or change another account's kits.
import { readFile, writeFile, rename, mkdir, rm, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const KIT_ID = /^[a-f0-9-]{36}$/, USER_ID = /^[a-f0-9-]{36}$/, IMAGE_FILE = /^[a-f0-9-]{36}-\d{1,2}-[a-f0-9]{8}\.(jpg|png|webp)$/;
const TYPES = { jpeg: 'jpg', png: 'png', webp: 'webp' };
export const contentType = file => ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[file.split('.').pop()];

export async function openStore(dataDir) {
  const libraries = new Map(), queues = new Map();
  const dir = userId => {
    if (!USER_ID.test(userId)) throw Error('Invalid user.');
    return new URL('users/' + userId + '/', dataDir);
  };

  async function kits(userId) {
    if (!libraries.has(userId)) {
      let list = [];
      try { list = JSON.parse(await readFile(new URL('kits.json', dir(userId)), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      libraries.set(userId, list);
    }
    return libraries.get(userId);
  }

  function save(userId) {
    const next = (queues.get(userId) || Promise.resolve()).catch(() => {}).then(async () => {
      await mkdir(dir(userId), { recursive: true });
      await writeFile(new URL('kits.tmp', dir(userId)), JSON.stringify(libraries.get(userId) || []));
      await rename(new URL('kits.tmp', dir(userId)), new URL('kits.json', dir(userId)));
    });
    queues.set(userId, next);
    return next;
  }

  const imagePath = (userId, file) => new URL('images/' + file, dir(userId));
  const fileOf = url => typeof url === 'string' && url.startsWith('/api/images/') ? url.split('/').pop() : null;
  async function removeImage(userId, url) {
    const file = fileOf(url);
    if (file && IMAGE_FILE.test(file)) await rm(imagePath(userId, file), { force: true });
  }

  // Saved memory palaces: [{id, name, places}], in palaces.json beside the kits.
  const routes = new Map();
  async function palaces(userId) {
    if (!routes.has(userId)) {
      let list = [];
      try { list = JSON.parse(await readFile(new URL('palaces.json', dir(userId)), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      routes.set(userId, list);
    }
    return routes.get(userId);
  }

  // What the learner says they already know: {knows: {major, pegs, pao}}, each true, false or absent (not said).
  const profiles = new Map();
  async function profile(userId) {
    if (!profiles.has(userId)) {
      let p = { knows: {} };
      try { p = JSON.parse(await readFile(new URL('profile.json', dir(userId)), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      profiles.set(userId, p);
    }
    return profiles.get(userId);
  }

  return {
    kits, save, dropImage: removeImage, palaces, profile,

    async saveProfile(userId, p) {
      profiles.set(userId, p);
      await mkdir(dir(userId), { recursive: true });
      await writeFile(new URL('profile.tmp', dir(userId)), JSON.stringify(p));
      await rename(new URL('profile.tmp', dir(userId)), new URL('profile.json', dir(userId)));
    },

    async savePalaces(userId, list) {
      routes.set(userId, list);
      await mkdir(dir(userId), { recursive: true });
      await writeFile(new URL('palaces.tmp', dir(userId)), JSON.stringify(list));
      await rename(new URL('palaces.tmp', dir(userId)), new URL('palaces.json', dir(userId)));
    },

    // The learner's own face photo for a names-and-faces kit, kept with the kit's images under slot 99.
    async savePhoto(userId, kit, source) {
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(source);
      if (!m || !KIT_ID.test(kit.id)) throw Error('Invalid photo.');
      const file = kit.id + '-99-' + randomBytes(4).toString('hex') + '.' + TYPES[m[1]];
      await mkdir(new URL('images/', dir(userId)), { recursive: true });
      await writeFile(imagePath(userId, file), Buffer.from(m[2], 'base64'));
      return '/api/images/' + file;
    },

    async add(userId, kit) { (await kits(userId)).unshift(kit); await save(userId); },

    async remove(userId, kit) {
      const list = await kits(userId);
      libraries.set(userId, list.filter(k => k !== kit));
      for (const s of kit.scenes) await removeImage(userId, s.image);
      await removeImage(userId, kit.photo);
      await save(userId);
    },

    // Stores a data: URL as a file and returns the URL the studio loads it from. Other URLs (https) are kept as they are.
    async saveImage(userId, kit, index, source) {
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(source);
      await removeImage(userId, kit.scenes[index].image);
      if (!m) return source;
      if (!KIT_ID.test(kit.id)) throw Error('Invalid kit.');
      const file = kit.id + '-' + index + '-' + randomBytes(4).toString('hex') + '.' + TYPES[m[1]];
      await mkdir(new URL('images/', dir(userId)), { recursive: true });
      await writeFile(imagePath(userId, file), Buffer.from(m[2], 'base64'));
      return '/api/images/' + file;
    },

    // Returns the image bytes, or null when the name is malformed or the file is not in this user's folder.
    async readImage(userId, file) {
      if (!IMAGE_FILE.test(file)) return null;
      try { return await readFile(imagePath(userId, file)); } catch { return null; }
    },

    // Moves a library saved before accounts existed (dataDir/kits.json, images inline) into this user's folder.
    async adoptLegacy(userId) {
      const legacy = new URL('kits.json', dataDir);
      let old;
      try { old = JSON.parse(await readFile(legacy, 'utf8')); } catch { return 0; }
      if (!Array.isArray(old) || !old.length) return 0;
      const list = await kits(userId);
      for (const kit of old) {
        if (!KIT_ID.test(kit.id || '')) continue;
        for (let i = 0; i < kit.scenes.length; i++) if (kit.scenes[i].image) {
          const inline = kit.scenes[i].image;
          kit.scenes[i].image = null;
          kit.scenes[i].image = await this.saveImage(userId, kit, i, inline);
        }
        list.push(kit);
      }
      await save(userId);
      await rename(legacy, new URL('kits.legacy.json', dataDir));
      return old.length;
    },

    async imageCount(userId) { try { return (await readdir(new URL('images/', dir(userId)))).length; } catch { return 0; } },
  };
}
