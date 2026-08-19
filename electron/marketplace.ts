import * as fs from 'fs';
import * as path from 'path';
import { httpGet } from './http';
import { getLatestPluginInfo } from './plugins';
import type { ServerPayload } from './types';

export interface MarketplacePlugin {
  slug: string;
  name: string;
  description: string;
  author: string;
  category: string;
  downloads: number;
  version?: string;
  url?: string;
}

interface DbPlugin {
  slug: string;
  name: string;
  description_ru: string;
  description_en: string;
  author: string;
  category: string;
  downloads: number;
}

// встроенный каталог — не дёргаем uMod API, просто отдаём статичный список
const MARKETPLACE_DB: DbPlugin[] = [
  { slug: 'image-library', name: 'ImageLibrary', author: 'MJSU', category: 'Libraries', downloads: 1800000, description_ru: 'Библиотека изображений и иконок для других плагинов.', description_en: 'Image and icon library used by many other plugins.' },
  { slug: 'nteleportation', name: 'NTeleportation', author: 'VisEntities', category: 'Teleport', downloads: 2200000, description_ru: 'Телепортация: дома, точки, телепорт к игроку и по запросу.', description_en: 'Teleportation: homes, points, player teleport and TPR requests.' },
  { slug: 'kits', name: 'Kits', author: 'Nogrod', category: 'Kits', downloads: 1900000, description_ru: 'Выдача наборов (китов) игрокам с таймерами и правами.', description_en: 'Give players starter kits with cooldowns and permissions.' },
  { slug: 'clans', name: 'Clans', author: 'MisterPikachu', category: 'Clans', downloads: 1400000, description_ru: 'Универсальные кланы с поддержкой альянсов.', description_en: 'Universal clans with alliance support.' },
  { slug: 'noescape', name: 'NoEscape', author: 'VisEntities', category: 'Raiding', downloads: 1100000, description_ru: 'Ограничение на выход из игры во время рейда.', description_en: 'Prevents combat logging during raids.' },
  { slug: 'betterchat', name: 'BetterChat', author: 'LaserHydra', category: 'Chat', downloads: 1300000, description_ru: 'Кастомизируемый чат с форматами и клановыми каналами.', description_en: 'Customizable chat with formats and clan channels.' },
  { slug: 'gathermanager', name: 'GatherManager', author: 'VisEntities', category: 'Gathering', downloads: 1500000, description_ru: 'Множители сбора ресурсов и лимиты добычи.', description_en: 'Gathering multipliers and resource caps.' },
  { slug: 'furnacesplitter', name: 'FurnaceSplitter', author: 'Nogrod', category: 'QoL', downloads: 1000000, description_ru: 'Автоматическое разделение стека при загрузке в печь.', description_en: 'Automatically splits stacks when loading furnaces.' },
  { slug: 'vanish', name: 'Vanish', author: 'CosaNostra', category: 'Admin', downloads: 900000, description_ru: 'Невидимость администратора: исчезновение и наблюдение.', description_en: 'Admin vanish: become invisible and spectate players.' },
  { slug: 'skins', name: 'Skins', author: 'MJSU', category: 'Cosmetics', downloads: 1200000, description_ru: 'Смена скинов предметов и оружия.', description_en: 'Change item and weapon skins.' },
  { slug: 'zlevelsremastered', name: 'ZLevelsRemastered', author: 'ignignokt84', category: 'RPG', downloads: 950000, description_ru: 'РПГ-система уровней: опыт, прокачка и навыки.', description_en: 'RPG leveling system: XP, progression and skills.' },
  { slug: 'anticheat', name: 'AntiCheat', author: 'Collector', category: 'Administration', downloads: 800000, description_ru: 'Обнаружение подозрительного поведения и читов.', description_en: 'Detects suspicious behavior and cheats.' },
  { slug: 'eventmanager', name: 'EventManager', author: 'CosaNostra', category: 'Events', downloads: 850000, description_ru: 'Проведение игровых событий: битвы, награды, арены.', description_en: 'Game events: battles, rewards and arenas.' },
  { slug: 'stacksizecontroller', name: 'StackSizeController', author: 'VisEntities', category: 'QoL', downloads: 980000, description_ru: 'Настройка размера стеков для всех предметов.', description_en: 'Configure stack sizes for every item.' },
  { slug: 'removertool', name: 'RemoverTool', author: 'VisEntities', category: 'Building', downloads: 1100000, description_ru: 'Удаление построек: стены, блоки, целые зоны.', description_en: 'Remove buildings, blocks and entire areas.' },
  { slug: 'backpacks', name: 'Backpacks', author: 'VisEntities', category: 'QoL', downloads: 880000, description_ru: 'Рюкзаки с увеличенным инвентарём.', description_en: 'Backpacks with extra inventory space.' },
  { slug: 'serverrewards', name: 'ServerRewards', author: 'Xom8ous', category: 'Rewards', downloads: 760000, description_ru: 'Баллы за время игры и магазин наград.', description_en: 'Playtime points and a reward shop.' },
  { slug: 'playtimetracker', name: 'PlaytimeTracker', author: 'k1lly0u', category: 'Administration', downloads: 700000, description_ru: 'Учёт времени игры игроков и рейтинги.', description_en: 'Track player playtime and leaderboards.' },
  { slug: 'economics', name: 'Economics', author: 'Nogrod', category: 'Economy', downloads: 920000, description_ru: 'Экономическая система: баланс и переводы.', description_en: 'Economy system: balances and transfers.' },
  { slug: 'trade', name: 'Trade', author: 'Nogrod', category: 'Economy', downloads: 820000, description_ru: 'Обмен предметами между игроками через GUI.', description_en: 'GUI-based item trading between players.' },
  { slug: 'friends', name: 'Friends', author: 'Nogrod', category: 'Social', downloads: 740000, description_ru: 'Список друзей: доступ к постройкам и ТП.', description_en: 'Friends list: building access and teleport.' },
  { slug: 'autodoors', name: 'AutoDoors', author: 'Wulf', category: 'QoL', downloads: 790000, description_ru: 'Автоматическое открытие дверей для владельца.', description_en: 'Auto-open doors for authorized players.' },
  { slug: 'deathnotes', name: 'DeathNotes', author: 'Collector', category: 'Informational', downloads: 860000, description_ru: 'Уведомления о смертях: кто и чем убил.', description_en: 'Death notifications: who and what killed.' },
  { slug: 'zonemanager', name: 'ZoneManager', author: 'Nogrod', category: 'Building', downloads: 940000, description_ru: 'Зоны с особыми правилами: PvP, безопасные, запреты.', description_en: 'Zones with rules: PvP, safe zones, restrictions.' },
  { slug: 'simplestatus', name: 'SimpleStatus', author: 'k1lly0u', category: 'Informational', downloads: 720000, description_ru: 'Информация о сервере: тикрейт, онлайна, аптайм.', description_en: 'Server info: tickrate, online count, uptime.' },
  { slug: 'copypaste', name: 'CopyPaste', author: 'misticos', category: 'Building', downloads: 890000, description_ru: 'Копирование и вставка построек (для событий).', description_en: 'Copy and paste buildings (for events).' },
  { slug: 'quicksmelt', name: 'QuickSmelt', author: 'MJSU', category: 'QoL', downloads: 680000, description_ru: 'Быстрая плавка ресурсов в печах.', description_en: 'Quickly smelt resources in furnaces.' },
  { slug: 'notifier', name: 'Notifier', author: 'Skrallex', category: 'Informational', downloads: 710000, description_ru: 'Всплывающие уведомления для игроков.', description_en: 'Popup notifications for players.' },
  { slug: 'guiannouncements', name: 'GUIAnnouncements', author: 'k1lly0u', category: 'Informational', downloads: 750000, description_ru: 'Анонсы сервера прямо в GUI.', description_en: 'Server announcements in the GUI.' },
  { slug: 'craftingcontroller', name: 'CraftingController', author: 'Nogrod', category: 'Crafting', downloads: 730000, description_ru: 'Настройка крафта: скорость, ограничения, отключение.', description_en: 'Crafting control: speed, limits and toggles.' },
];

const RUST_GAMES = new Set(['rust', 'universal']);

let topCache: { at: number; items: MarketplacePlugin[] } | null = null;
const TOP_TTL_MS = 6 * 3600_000; // обновляем не чаще раза в 6 часов

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapItem(item: SearchItem): MarketplacePlugin {
  const rawVersion = item.latest_release_version ?? '';
  return {
    slug: item.slug ?? '',
    name: item.name || item.title || 'Unknown',
    description: item.description || '',
    author: item.author || 'Unknown',
    category: item.category_tags || 'Plugin',
    downloads: item.downloads ?? 0,
    version: rawVersion ? `v${rawVersion.replace(/^v/i, '')}` : undefined,
    url: item.url || `https://umod.org/plugins/${item.slug ?? ''}`,
  };
}

async function fetchUmodTop(): Promise<MarketplacePlugin[]> {
  const seen = new Set<string>();
  const out: MarketplacePlugin[] = [];
  for (let page = 1; page <= 3; page++) {
    if (page > 1) await sleep(150);
    const res = await httpGet(
      `https://umod.org/plugins/search.json?q=&sort=downloads&page=${page}`
    );
    if (res.status !== 200) break; // в т.ч. 429 — вернём то, что уже собрали
    const body = JSON.parse(res.body.toString('utf8')) as { data?: SearchItem[] };
    const list = body.data ?? [];
    if (list.length === 0) break;
    for (const item of list) {
      if (!item.slug || seen.has(item.slug)) continue;
      if (!item.games_detail?.some((g) => g.slug && RUST_GAMES.has(g.slug))) continue;
      seen.add(item.slug);
      out.push(mapItem(item));
    }
    if (out.length >= 30) break;
  }
  return out.slice(0, 30);
}

export async function getMarketplaceList(lang: string): Promise<MarketplacePlugin[]> {
  if (topCache && Date.now() - topCache.at < TOP_TTL_MS) return topCache.items;
  try {
    const items = await fetchUmodTop();
    if (items.length > 0) {
      topCache = { at: Date.now(), items };
      return items;
    }
  } catch {
  }
  return MARKETPLACE_DB.map((p) => ({
    slug: p.slug,
    name: p.name,
    description: lang === 'en' ? p.description_en : p.description_ru,
    author: p.author,
    category: p.category,
    downloads: p.downloads,
    url: `https://umod.org/plugins/${p.slug}`,
  }));
}

interface SearchItem {
  slug?: string;
  name?: string;
  title?: string;
  author?: string;
  description?: string;
  downloads?: number;
  category_tags?: string;
  latest_release_version?: string;
  url?: string;
  tags_all?: string;
  games_detail?: Array<{ slug?: string }>;
}

function slugifyQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function searchMarketplace(query: string): Promise<MarketplacePlugin[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: MarketplacePlugin[] = [];
  const seen = new Set<string>();
  try {
    for (let page = 1; page <= 5; page++) {
      if (page > 1) await sleep(150);
      const res = await httpGet(
        `https://umod.org/plugins/search.json?q=&sort=downloads&page=${page}`
      );
      if (res.status !== 200) break; // в т.ч. 429 — вернём найденное
      const body = JSON.parse(res.body.toString('utf8')) as { data?: SearchItem[] };
      const list = body.data ?? [];
      if (list.length === 0) break;
      for (const item of list) {
        if (!item.slug || seen.has(item.slug)) continue;
        seen.add(item.slug);
        if (!item.games_detail?.some((g) => g.slug && RUST_GAMES.has(g.slug))) continue;
        const haystack =
          `${item.name} ${item.title ?? ''} ${item.tags_all ?? ''} ${item.author ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) continue;
        out.push(mapItem(item));
        if (out.length >= 24) break;
      }
      if (out.length >= 24) break;
    }

    if (out.length === 0) {
      const slug = slugifyQuery(q);
      if (slug) {
        const res = await httpGet(`https://umod.org/plugins/${slug}.json`);
        if (res.status === 200) {
          const item = JSON.parse(res.body.toString('utf8')) as SearchItem;
          if (item?.slug && !seen.has(item.slug)) {
            seen.add(item.slug);
            if (item.games_detail?.some((g) => g.slug && RUST_GAMES.has(g.slug))) {
              out.push(mapItem(item));
            }
          }
        }
      }
    }
    return out.slice(0, 24);
  } catch {
    return [];
  }
}

export interface InstallResult {
  ok: boolean;
  message?: string;
  error?: string;
}

export async function installMarketplacePlugin(
  server: ServerPayload,
  slug: string
): Promise<InstallResult> {
  if (!server.installPath) {
    return { ok: false, error: 'Server install path is not configured.' };
  }
  try {
    const info = await getLatestPluginInfo(slug);
    if (!info) return { ok: false, error: `Plugin "${slug}" not found on uMod.` };

    const res = await httpGet(info.downloadUrl);
    if (res.status !== 200) {
      return { ok: false, error: `uMod responded with HTTP ${res.status}.` };
    }
    if (res.body.length < 100) {
      return { ok: false, error: 'Downloaded file looks invalid — installation aborted.' };
    }

    const pluginsDir = path.join(server.installPath, 'server', server.identity, 'oxide', 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });

    const downloadFileName = path.basename(new URL(info.downloadUrl).pathname);
    const fileName = downloadFileName.endsWith('.cs') ? downloadFileName : `${slug}.cs`;
    const targetPath = path.join(pluginsDir, fileName);
    fs.writeFileSync(targetPath, res.body);

    return { ok: true, message: `Plugin "${fileName}" installed to the plugins folder.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
