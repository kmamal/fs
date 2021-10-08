const Fsp = require('fs').promises
const { PagedFile } = require('./paged-file')
const Constants = require('./constants')

class PageListFile {
	constructor (location, page_size, header_offset) {
		this._file = new PagedFile(location, page_size)
		this._header_offset = header_offset
		this._buffer = Buffer.allocUnsafe(page_size)
	}

	async open (options) {
		if (this._state !== Constants.STATE.CLOSED) {
			const error = new Error("Cannot call open from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		await Fsp.mkdir(this._location, { recursive: true })
		this._lock_file.acquire()

		this._state = Constants.STATE.OPENING

		await this._file.open(options)

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

		await this._file.close()

		this._state = Constants.STATE.CLOSED
	}

	readPage (...args) { return this._file.readPage(...args) }
	writePage (...args) { this._file.writePage(...args) }

	allocPage (page, offset) {
		this._file.readPage(0, this._buffer)
		const first = this._readPointer(this._buffer)
		let index = first

		if (first === 0) {
			const { size } = await this._file.fd().stat()
			index = size / this._page_size
			this._file.writePage(index, this._buffer)
		}

		const buffer = this._file.readPage(index, page, offset)

		if (first !== 0) {
			const next = this._readPointer(buffer)
			this._writePointer(this._buffer, next)
			this._file.writePage(0, this._buffer)
		}

		return { index, buffer }
	}

	freePage (index) {
		this._file.readPage(0, this._buffer)
		const next = this._readPointer(this._buffer)
		this._writePointer(this._buffer, index)
		this._file.writePage(0, this._buffer)

		this._file.readPage(index, this._buffer)
		this._writePointer(this._buffer, next)
		this._file.writePage(index, this._buffer)
	}

	_readFirst (b) { return Number(b.readBigUInt64BE(this._header_offset)) }
	_writeFirst (b, next) { return b.writeBigUInt64BE(BigInt(next), this._header_offset) }

	_readPointer (b) { return Number(b.readBigUInt64BE()) }
	_writePointer (b, next) { return b.writeBigUInt64BE(BigInt(next)) }
}

module.exports = { PageListFile }
