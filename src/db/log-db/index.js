const Fs = require('fs')
const Fsp = Fs.promises
const Path = require('path')
const { exists: doesExist } = require('../../exists')
const Constants = require('../constants')

const PB = Constants.POINTER_BYTES

const LOCK_FILE_NAME = 'lock'
const DATA_FILE_NAME = 'data'
const INDEX_FILE_NAME = 'index'

class LogDB {
	constructor (location) {
		this._location = location
		this._location_lock = Path.join(location, LOCK_FILE_NAME)
		this._location_data = Path.join(location, DATA_FILE_NAME)
		this._location_index = Path.join(location, INDEX_FILE_NAME)

		this._state = Constants.STATE.CLOSED

		this._data_length = null
		this._index_length = null

		this._fd_data_write = null
		this._fd_index_write = null
		this._fd_index_read = null

		this._pending = []
		this._writing = null
	}

	get location () { return this._location }

	get state () { return this._state }

	get dataBytes () { return this._data_length }
	get indexBytes () { return this._index_length }
	get bytes () { return this.dataBytes + this.indexBytes }
	get length () { return this._index_length / PB - 1 }

	async open (options = {}) {
		const {
			truncate = false,
			create = true,
			validate = true,
			fix = false,
		} = options

		if (this._state !== Constants.STATE.CLOSED) {
			const error = new Error('Cannot call open from this state')
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		this._state = Constants.STATE.OPENING

		let exists = true
			&& await doesExist(this._location)
			&& await doesExist(this._location_index)
			&& await doesExist(this._location_data)

		if (!exists && !create) {
			const error = new Error('not found')
			error.code = Constants.ERROR.MISSING
			error.path = this._location
			throw error
		}

		await Fsp.mkdir(this._location, { recursive: true })

		for (;;) {
			try {
				await Fsp.appendFile(this._location_lock, Constants.PID, { flag: 'ax' })
				break
			} catch (x) {
				let contents
				try {
					contents = await Fsp.readFile(this._location_lock)
				} catch (y) {
					continue
				}

				const error = new Error('lock file exists')
				error.code = Constants.ERROR.LOCKED
				error.contents = contents
				throw error
			}
		}

		if (exists && truncate) {
			const dir = await Fsp.opendir(this._location)
			for await (const { name } of dir) {
				if (name === LOCK_FILE_NAME) { continue }
				await Fsp.unlink(Path.join(this._location, name))
			}

			exists = false
		}

		await this._openFds()

		const buffer = Buffer.alloc(PB)

		if (!exists) {
			buffer.fill(0)
			await this._fd_index_write.appendFile(buffer)
			await this._fd_index_write.datasync()
			this._index_length += PB
		} else if (validate) {
			let index_offset = 0
			let last_data_pointer = 0

			try {
				if (this._index_length < PB) {
					const error = new Error('zero index missing')
					throw error
				}

				await this._fd_index_read.read(buffer, 0, PB, index_offset)
				if (Number(buffer.readBigInt64BE(0)) !== 0) {
					const error = new Error('index does not start at zero')
					throw error
				}

				index_offset += PB

				while (index_offset < this._index_length) {
					await this._fd_index_read.read(buffer, 0, PB, index_offset)
					const data_pointer = Number(buffer.readBigInt64BE(0))

					if (data_pointer < last_data_pointer) {
						const error = new Error('corrupted index')
						const key = index_offset % PB
						error.key1 = key - 1
						error.value1 = last_data_pointer
						error.key2 = key
						error.value2 = data_pointer
						throw error
					}

					if (data_pointer > this._data_length) {
						const error = new Error('missing data')
						error.key = index_offset % PB
						error.value = data_pointer
						error.data_size = this._data_length
						throw error
					}

					index_offset += PB
					last_data_pointer = data_pointer
				}

				if (index_offset !== this._index_length) {
					const error = new Error('odd bytes in index')
					error.index_actual_size = this._index_length
					error.index_expected_size = index_offset

					index_offset -= PB
					throw error
				}
			} catch (error) {
				error.code = Constants.ERROR.CORRUPTED
				if (!fix) {
					try {
						await Fsp.unlink(this._location_lock)
					} catch (err) { }
					throw error
				}

				console.warn(error)

				await this._closeFds()
				await Promise.all([
					Fsp.truncate(this._location_data, last_data_pointer),
					Fsp.truncate(this._location_index, index_offset),
				])
				await this._openFds()

				if (this._index_length === 0) {
					buffer.fill(0)
					await this._fd_index_write.appendFile(buffer)
					await this._fd_index_write.datasync()
					this._index_length += PB
				}
			}
		}

		this._state = Constants.STATE.OPENED
	}

	async close () {
		if (this._state !== Constants.STATE.OPENED) {
			const error = new Error('Cannot call close from this state')
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		this._state = Constants.STATE.CLOSING

		await this.flush()
		await Promise.all([
			this._closeFds(),
			Fsp.unlink(this._location_lock),
		])

		this._state = Constants.STATE.CLOSED

		this._data_length = null
		this._index_length = null

		this._fd_data_write = null
		this._fd_index_write = null
		this._fd_index_read = null

		this._pending = []
	}

	async _openFds () {
		await Promise.all([
			(async () => {
				this._fd_data_write = await Fsp.open(this._location_data, 'a')
				const stats = await this._fd_data_write.stat()
				this._data_length = stats.size
			})(),
			(async () => {
				this._fd_index_write = await Fsp.open(this._location_index, 'a')
				const stats = await this._fd_index_write.stat()
				this._index_length = stats.size
				this._fd_index_read = await Fsp.open(this._location_index, 'r')
			})(),
		])
	}

	async _closeFds () {
		await Promise.all([
			this._fd_data_write.close(),
			this._fd_index_write.close(),
			this._fd_index_read.close(),
		])
	}

	async append (buffer) {
		try {
			await new Promise((resolve, reject) => {
				const callback = (error) => {
					error ? reject(error) : resolve()
				}
				this._pending.push([ buffer, callback ])
				this._write()
			})
		} catch (error) {
			try {
				await Fsp.unlink(this._location_lock)
			} catch (err) {}
			throw error
		}
	}

	async _write () {
		let resolve
		this._writing = new Promise((_resolve) => { resolve = _resolve })

		while (this._pending.length > 0) {
			const [ data_buffer, callback ] = this._pending.shift()
			this._data_length += data_buffer.length
			this._index_length += PB
			const index_buffer = Buffer.alloc(PB)
			index_buffer.writeBigInt64BE(BigInt(this._data_length))
			try {
				await Promise.all([
					this._fd_data_write.appendFile(data_buffer).then(() => this._fd_data_write.datasync()),
					this._fd_index_write.appendFile(index_buffer).then(() => this._fd_index_write.datasync()),
				])
				callback()
			} catch (error) {
				callback(error)
				this.close()
				break
			}
		}

		this._writing = null
		resolve()
	}

	async flush () {
		await this._writing
	}

	async get (index) {
		const { length } = this
		if (index < 0 || index >= length) {
			const error = new Error('out of bounds')
			error.code = Constants.ERROR.OUT_OF_BOUNDS
			error.index = index
			error.min = 0
			error.max = length - 1
			throw error
		}

		try {
			const index_buffer = Buffer.alloc(PB * 2)
			await this._fd_index_read.read(index_buffer, 0, PB * 2, index * PB)
			const start = Number(index_buffer.readBigInt64BE(0))
			const end = Number(index_buffer.readBigInt64BE(PB)) - 1

			return Fs.createReadStream(this._location_data, { start, end })
		} catch (error) {
			try {
				await Fsp.unlink(this._location_lock)
			} catch (err) {}
			throw error
		}
	}

	* keys (options = {}) {
		const {
			lt, lte, gt, gte,
			reverse, limit,
		} = options

		const [ before_start, _start, before_end, _end ] = reverse
			? [ lt, lte, gte, gt ]
			: [ gt, gte, lte, lt ]
		const start
			= _start !== undefined ? _start
			: before_start !== undefined ? before_start + 1
			: 0
		const end
			= _end !== undefined ? _end
			: before_end !== undefined ? before_end + 1
			: limit !== undefined ? start + limit
			: this.length
		const inc = reverse ? -1 : 1

		for (let i = start; i < end; i += inc) {
			yield i
		}
	}

	async * entries (options = {}) {
		for await (const key of this.keys(options)) {
			yield [ key, await this.get(key) ]
		}
	}

	async * values (options = {}) {
		for await (const key of this.keys(options)) {
			yield await this.get(key)
		}
	}
}

module.exports = { LogDB }
