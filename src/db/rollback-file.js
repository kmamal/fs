const { PagedFile } = require('./paged-file')

const POINTER_BYTES = 8

class RollbackFile {
	constructor (location, page_size) {
		this._data_file = new PagedFile(location, page_size)
		this._journal_file = new PagedFile(`${location}-journal`, POINTER_BYTES)
	}

	async open (flags = 'w+') {
		this._data_file
		this._fd = await Fsp.open(this._location, flags)
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

module.exports = { RollbackFile }
