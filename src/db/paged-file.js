const Fsp = require('fs').promises
const { exists: doesExist } = require('../../exists')
const { Sequential } = require('./sequential')
const Constants = require('../constants')

class PagedFile {
	constructor (location, page_size) {
		this._location = location
		this._page_size = page_size
		this._fd = null

		this._sequence = new Sequential()
	}

	fd () { return this._fd }

	async open (options) {
		const { truncate = false, create = true } = options

		if (this._state !== Constants.STATE.CLOSED) {
			const error = new Error("Cannot call open from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		this._state = Constants.STATE.OPENING

		const exists = await doesExist(this._location)

		if (!exists && !create) {
			const error = new Error("not found")
			error.code = Constants.ERROR.MISSING
			error.path = this._location
			throw error
		}

		if (!exists || truncate) {
			this._fd = await Fsp.open(this._location, 'w+')
		} else {
			this._fd = await Fsp.open(this._location, 'r+')
		}

		this._state = Constants.STATE.OPEN
	}

	async close () {
		if (this._state !== Constants.STATE.OPEN) {
			const error = new Error("Cannot call close from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		this._state = Constants.STATE.CLOSING

		await this.flush()
		await this._fd.close()
		this._fd = null

		this._state = Constants.STATE.CLOSED
	}

	async readPage (index, _page, _offset = 0) {
		if (this._state !== Constants.STATE.OPEN) {
			const error = new Error("Cannot call get from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		const size = this._page_size

		let page
		let offset
		if (_page) {
			page = _page
			offset = _offset
		} else {
			page = Buffer.allocUnsafe(size)
			offset = 0
		}

		try {
			await this._fd.read(page, offset, size, index * size)
		} catch (error) {
			try { await this.close() } catch (_) {}
			throw error
		}

		return page
	}

	async writePage (index, page, offset = 0) {
		if (this._state !== Constants.STATE.OPEN) {
			const error = new Error("Cannot call writePage from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		const size = this._page_size

		try {
			await this._sequence.push(async () => {
				await this._fd.write(page, offset, size, index * size)
			})
		} catch (error) {
			try { await this.close() } catch (_) {}
			throw error
		}
	}

	async flush (callback) {
		if (this._state !== Constants.STATE.OPEN && this._state !== Constants.STATE.CLOSING) {
			const error = new Error("Cannot call flush from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		try {
			await this._sequence.push(callback)
		} catch (error) {
			try { await this.close() } catch (_) {}
			throw error
		}
	}
}

module.exports = { PagedFile }
