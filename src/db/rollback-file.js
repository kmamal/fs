const Fsp = require('fs').promises
const Path = require('path')
const { PagedFile } = require('./paged-file')
const { Sequential } = require('./sequential')
const Constants = require('./constants')

const PB = Constants.POINTER_BYTES

const LOCK_FILE_NAME = 'lock'
const DATA_FILE_NAME = 'data'
const JOURNAL_FILE_NAME = 'journal'

class RollbackFile {
	constructor (location, page_size) {
		this._location = location
		this._location_lock = Path.join(location, LOCK_FILE_NAME)
		this._location_data = Path.join(location, DATA_FILE_NAME)
		this._location_journal = Path.join(location, JOURNAL_FILE_NAME)

		this._data_file = new PagedFile(this._location_data, page_size)
		this._journal_page_size = page_size + PB
		this._journal_file = new PagedFile(this._location_journal, this._journal_page_size)
		this._journal_page = Buffer.alloc(this._journal_page_size)
		this._journaled_pages = new Set()

		this._sequnce = new Sequential()
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

		await Promise.all([
			this._data_file.open(options),
			this._journal_file.open(options),
		])

		// Rollback
		const { size: journal_size } = await this._journal_file.fd().stat()
		if (journal_size > 0) {
			const journal_pages = journal_size / this._journal_page_size
			const promises = new Array(journal_pages)

			for (let i = 0; i < journal_pages; i++) {
				await this._data_file.readPage(i, this._journal_page, PB)
				const data_page_index = Number(this._journal_page.readBigUInt64BE())
				const promise = this._data_file.writePage(data_page_index, this._journal_page)
				promises.push(promise)
			}

			await Promise.all(promises)
			this.checkpoint()
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

		await this.checkpoint()
		await Promise.all(
			this._data_file.close(),
			this._journal_file.close(),
		)

		this._state = Constants.STATE.CLOSED
	}

	readPage (index, page, offset) {
		if (this._state !== Constants.STATE.OPEN) {
			const error = new Error("Cannot call readPage from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		return this._data_file.readPage(index, page, offset)
	}

	writePage (index, page, offset) {
		if (this._state !== Constants.STATE.OPEN) {
			const error = new Error("Cannot call writePage from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		await this._sequnce.push(async () => {
			if (!this._journaled_pages.has(index)) {
				this._journaled_pages.add(index)

				await this._data_file.readPage(index, this._journal_page, PB)
				this._journal_page.writeBigUInt64BE(BigInt(index))
				await this._journal_file.writePage(this._journaled_pages.size, this._journal_page)
				await this._journal_file.fd().datasync()
			}

			await this.writePageUnsafe(index, page, offset)
		})
	}

	async writePageUnsafe (index, page, offset) {
		await this._data_file.writePage(index, page, offset)
	}

	checkpoint () {
		if (this._state !== Constants.STATE.OPEN) {
			const error = new Error("Cannot call checkpoint from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		await this._sequnce.push(() => {
			this._journaled_pages.clear()
			await this._data_file.fd().datasync()
			await this._journal_file.fd().truncate()
		})
	}

	async flush (callback) {
		if (this._state !== Constants.STATE.OPEN && this._state !== Constants.STATE.CLOSING) {
			const error = new Error("Cannot call flush from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		await this._sequnce.push(callback)
	}
}

module.exports = { RollbackFile }
