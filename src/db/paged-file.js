const Fsp = require('fs').promises
const { exists: doesExist } = require('@xyz/fs/exists')

class PagedFile {
	constructor (location, page_size) {
		this._location = location
		this._page_size = page_size
		this._fd = null
	}

	async open (options) {
		const { truncate = false, create = true } = options
		const exists = await doesExist(this._location)
		if (!exists) {
			if (!create) {
				const error = new Error('not found')
				error.
			}
		}
		this._fd = await Fsp.open(this._location, 'r+')
	}

	async close () {
		await this._fd.close()
	}

	async readPage (index, _page, _offset = 0) {
		const size = this._page_size

		let page
		let offset
		if (_page) {
			page = _page
			offset = _offset
		} else {
			page = Buffer.alloc(size)
			offset = 0
		}

		await this._fd.read(page, offset, size, index * size)
		return page
	}

	async writePage (index, page, offset = 0) {
		const size = this._page_size
		await this._fd.write(page, offset, size, index * size)
	}
}

module.exports = { PagedFile }
