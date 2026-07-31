/**
 * Generates the two static index files the office asset loader needs at runtime.
 *
 * The browser cannot list a directory over HTTP, so the set of sprite PNGs and the
 * flattened furniture catalog have to be committed alongside the assets. Re-run this
 * after adding, removing, or renaming anything under frontends/pixel_office/public/assets/office/.
 *
 *   node scripts/build-office-asset-index.mjs
 *
 * Ported from pixel-agents' core/src/assets/{build,manifestUtils}.ts (MIT, Pablo De
 * Lucca) so the generated catalog matches what its server produced.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS_DIR = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
	'..',
	'frontends',
	'pixel_office',
	'public',
	'assets',
	'office',
);

/** Recursively flatten a manifest node, inheriting group-level properties down to leaves. */
function flattenManifest(node, inherited) {
	if (node.type === 'asset') {
		const orientation = node.orientation ?? inherited.orientation;
		const state = node.state ?? inherited.state;
		return [
			{
				id: node.id,
				name: inherited.name,
				label: inherited.name,
				category: inherited.category,
				file: node.file,
				width: node.width,
				height: node.height,
				footprintW: node.footprintW,
				footprintH: node.footprintH,
				isDesk: inherited.category === 'desks',
				canPlaceOnWalls: inherited.canPlaceOnWalls,
				canPlaceOnSurfaces: inherited.canPlaceOnSurfaces,
				backgroundTiles: inherited.backgroundTiles,
				groupId: inherited.groupId,
				...(orientation ? { orientation } : {}),
				...(state ? { state } : {}),
				...(node.mirrorSide ? { mirrorSide: true } : {}),
				...(inherited.rotationScheme ? { rotationScheme: inherited.rotationScheme } : {}),
				...(inherited.animationGroup ? { animationGroup: inherited.animationGroup } : {}),
				...(node.frame !== undefined ? { frame: node.frame } : {}),
			},
		];
	}

	const results = [];
	for (const member of node.members) {
		const childProps = { ...inherited };

		if (node.groupType === 'rotation' && node.rotationScheme) {
			childProps.rotationScheme = node.rotationScheme;
		}
		if (node.groupType === 'state') {
			if (node.orientation) childProps.orientation = node.orientation;
			if (node.state) childProps.state = node.state;
		}
		if (node.groupType === 'animation') {
			const orient = node.orientation ?? inherited.orientation ?? '';
			const st = node.state ?? inherited.state ?? '';
			childProps.animationGroup = `${inherited.groupId}_${orient}_${st}`.toUpperCase();
			if (node.state) childProps.state = node.state;
		}
		if (node.orientation && !childProps.orientation) {
			childProps.orientation = node.orientation;
		}

		results.push(...flattenManifest(member, childProps));
	}
	return results;
}

function buildFurnitureCatalog() {
	const furnitureDir = path.join(ASSETS_DIR, 'furniture');
	if (!fs.existsSync(furnitureDir)) return [];

	const catalog = [];
	const folders = fs
		.readdirSync(furnitureDir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();

	for (const folderName of folders) {
		const manifestPath = path.join(furnitureDir, folderName, 'manifest.json');
		if (!fs.existsSync(manifestPath)) continue;

		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

		if (manifest.type === 'asset') {
			const hasDimensions =
				manifest.width != null &&
				manifest.height != null &&
				manifest.footprintW != null &&
				manifest.footprintH != null;
			if (!hasDimensions) continue;
			const file = manifest.file ?? `${manifest.id}.png`;
			catalog.push({
				id: manifest.id,
				name: manifest.name,
				label: manifest.name,
				category: manifest.category,
				file,
				furniturePath: `furniture/${folderName}/${file}`,
				width: manifest.width,
				height: manifest.height,
				footprintW: manifest.footprintW,
				footprintH: manifest.footprintH,
				isDesk: manifest.category === 'desks',
				canPlaceOnWalls: manifest.canPlaceOnWalls,
				canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
				backgroundTiles: manifest.backgroundTiles,
				groupId: manifest.id,
			});
			continue;
		}

		if (!manifest.members) continue;
		const inherited = {
			groupId: manifest.id,
			name: manifest.name,
			category: manifest.category,
			canPlaceOnWalls: manifest.canPlaceOnWalls,
			canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
			backgroundTiles: manifest.backgroundTiles,
			...(manifest.rotationScheme ? { rotationScheme: manifest.rotationScheme } : {}),
		};
		const assets = flattenManifest(
			{
				type: 'group',
				groupType: manifest.groupType,
				rotationScheme: manifest.rotationScheme,
				members: manifest.members,
			},
			inherited,
		);
		for (const asset of assets) {
			catalog.push({ ...asset, furniturePath: `furniture/${folderName}/${asset.file}` });
		}
	}
	return catalog;
}

function listSorted(subdir, pattern) {
	const dir = path.join(ASSETS_DIR, subdir);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => pattern.test(f))
		.sort((a, b) => {
			const na = Number.parseInt(/(\d+)/.exec(a)?.[1] ?? '0', 10);
			const nb = Number.parseInt(/(\d+)/.exec(b)?.[1] ?? '0', 10);
			return na - nb;
		});
}

/** Pets are one directory each, sorted alphabetically so petType indices stay stable. */
function listPets() {
	const petsDir = path.join(ASSETS_DIR, 'pets');
	if (!fs.existsSync(petsDir)) return [];
	return fs
		.readdirSync(petsDir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort()
		.flatMap((dirName) => {
			const manifestPath = path.join(petsDir, dirName, 'manifest.json');
			if (!fs.existsSync(manifestPath) || !fs.existsSync(path.join(petsDir, dirName, 'pet.png'))) {
				return [];
			}
			const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
			return [{ dir: dirName, name: manifest.name ?? dirName }];
		});
}

function findDefaultLayout() {
	let best = null;
	let bestRev = 0;
	for (const f of fs.readdirSync(ASSETS_DIR)) {
		const m = /^default-layout-(\d+)\.json$/.exec(f);
		if (m) {
			const rev = Number.parseInt(m[1], 10);
			if (rev > bestRev) {
				bestRev = rev;
				best = f;
			}
		}
	}
	if (!best && fs.existsSync(path.join(ASSETS_DIR, 'default-layout.json'))) {
		best = 'default-layout.json';
	}
	return best;
}

const assetIndex = {
	characters: listSorted('characters', /^char_\d+\.png$/i),
	floors: listSorted('floors', /^floor_\d+\.png$/i),
	walls: listSorted('walls', /^wall_\d+\.png$/i),
	carpets: listSorted('carpets', /^carpet_\d+\.png$/i),
	pets: listPets(),
	defaultLayout: findDefaultLayout(),
};
const catalog = buildFurnitureCatalog();

fs.writeFileSync(
	path.join(ASSETS_DIR, 'asset-index.json'),
	`${JSON.stringify(assetIndex, null, 2)}\n`,
);
fs.writeFileSync(
	path.join(ASSETS_DIR, 'furniture-catalog.json'),
	`${JSON.stringify(catalog, null, 2)}\n`,
);

console.log(
	`office asset index: ${assetIndex.characters.length} characters, ${assetIndex.floors.length} floors, ` +
		`${assetIndex.walls.length} wall sets, ${assetIndex.carpets.length} carpets, ${assetIndex.pets.length} pets, ` +
		`${catalog.length} furniture entries`,
);
