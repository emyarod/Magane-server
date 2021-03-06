const utils = require('../../utils/Util');
const Route = require('../../structures/Route');
const path = require('path');
const axios = require('axios');
const jetpack = require('fs-jetpack');
const { server } = require('../../config');
const db = require('knex')(server.database);
// const LINELink = 'http://dl.stickershop.line.naver.jp/products/0/0/1/<packid>/android/stickers.zip';
// const APNGLink = 'https://stickershop.line-scdn.net/stickershop/v1/sticker/<stickerid>/IOS/sticker_animation@2x.png';

class PackPOST extends Route {
	constructor() {
		super('/api/pack/line/:id', 'post');
	}

	async run(req, res) {
		const { id } = req.params;
		const { overwrite } = req.headers;

		if (!id) {
			return res.status(400).json({
				code: 400,
				message: 'No pack id provided.'
			});
		}

		const pack = {
			id,
			uploadPath: path.join(__dirname, '..', '..', '..', 'packs', id)
		};

		const exists = await db.table('packs').where({ lineId: id }).first();
		if (exists) {
			if (!overwrite) return res.status(403).json({ message: 'Pack already exists' });
			await db.table('packs').where({ lineId: id }).del();
			await db.table('stickers').where({ packId: id }).del();
			await jetpack.removeAsync(pack.uploadPath);
		}

		// Create folder
		await jetpack.dir(pack.uploadPath);
		this._getMetadata(pack);

		return res.status(200).json({ message: 'Pack added.' });
	}

	async _getMetadata(pack) {
		try {
			const response = await axios.get(`http://dl.stickershop.line.naver.jp/products/0/0/1/${pack.id}/android/productInfo.meta`);
			pack.name = response.data.title.en || response.data.title.ja;
			pack.stickers = response.data.stickers;
			pack.animated = response.data.hasAnimation;
			this._getFiles(pack);
		} catch (error) {
			console.error(error);
		}
	}

	async _getFiles(pack) {
		for (const sticker of pack.stickers) {
			let url = `http://dl.stickershop.line.naver.jp/stickershop/v1/sticker/${sticker.id}/android/sticker.png`;
			if (pack.animated) url = `https://sdl-stickershop.line.naver.jp/products/0/0/1/${pack.id}/android/animation/${sticker.id}.png`;

			try {
				const response = await axios.get(url, { responseType: 'arraybuffer' }); // eslint-disable-line no-await-in-loop
				await jetpack.write(path.join(pack.uploadPath, '_temp', `${sticker.id}.png`), response.data); // eslint-disable-line no-await-in-loop
				await jetpack.dir(path.join(pack.uploadPath, '_temp', '_temp')); // eslint-disable-line no-await-in-loop
			} catch (error) {
				console.error(error);
			}
		}
		this._processFiles(pack);
	}

	async _processFiles(pack) {
		let firstFile = null;
		jetpack.find(path.join(pack.uploadPath, '_temp'), { matching: '*.png' }).forEach(async file => {
			if (!firstFile) firstFile = file;
			try {
				if (!pack.animated) await utils.generateThumbnail(pack, file);
				else utils.generateAnimatedThumbnail(pack, file);
			} catch (error) {
				console.error(error);
			}
		});

		await utils.generateTabThumbnail(pack, firstFile);
		this._saveToDatabase(pack);
	}

	async _saveToDatabase(pack) {
		await db.table('packs').insert({
			name: pack.name,
			lineId: pack.id,
			animated: pack.animated,
			count: pack.stickers.length
		});

		for (const sticker of pack.stickers) {
			await db.table('stickers').insert({ // eslint-disable-line no-await-in-loop
				packId: pack.id,
				lineId: sticker.id,
				file: pack.animated ? `${sticker.id}.gif` : `${sticker.id}.png`
			});
		}

		console.log(`< Successfully added pack ${pack.name} (ID: ${pack.id}) >`);

		setTimeout(async () => {
			try {
				await jetpack.removeAsync(path.join(pack.uploadPath, '_temp'));
			} catch (error) {
				console.error(error);
			}
		}, 30000);
	}
}

module.exports = PackPOST;
